import type Database from 'better-sqlite3'
import type { FulfilmentMail, FulfilmentMailLine } from '@/lib/order-types'

const HEADERS = ['SKU', 'Naam', 'Variant', 'Barcode', 'HS-code', 'Land van herkomst', 'Aantal']

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const formatDate = (d: string) => new Date(d).toLocaleDateString('nl-NL')

// Variation names are "Parent — Options"; the sheet's variant wins, the name is the fallback
function splitName(name: string): { name: string; variant: string | null } {
  const at = name.indexOf(' — ')
  return at < 0 ? { name, variant: null } : { name: name.slice(0, at), variant: name.slice(at + 3) }
}

const describe = (l: FulfilmentMailLine) => [l.sku, [l.name, l.variant && `(${l.variant})`].filter(Boolean).join(' ')].filter(Boolean).join(' – ')
const cells = (l: FulfilmentMailLine) => [l.sku ?? '', l.name, l.variant ?? '', l.barcode ?? '', l.hs_code ?? '', l.country_of_origin ?? '', String(l.quantity)]

export function buildFulfilmentMail(db: Database.Database, orderId: number): FulfilmentMail | null {
  const order = db.prepare('SELECT expected_arrival FROM orders WHERE id = ?').get(orderId) as { expected_arrival: string | null } | undefined
  if (!order) return null

  const rows = db.prepare(`
    SELECT po.product_id, po.quantity, po.supplier_code, po.supplier_description,
           p.sku, p.name, p.variant, p.barcode, p.hs_code, p.country_of_origin
    FROM purchase_orders po
    LEFT JOIN products p ON p.id = po.product_id
    WHERE po.order_id = ?
    ORDER BY po.id
  `).all(orderId) as {
    product_id: number | null; quantity: number; supplier_code: string | null; supplier_description: string | null
    sku: string | null; name: string | null; variant: string | null; barcode: string | null; hs_code: string | null; country_of_origin: string | null
  }[]

  // The dashboard doesn't know deliveries from before it existed, so stock or sales also prove it arrived once
  const seenBefore = db.prepare(`
    SELECT 1 FROM products p WHERE p.id = @id AND (
      p.current_stock > 0
      OR EXISTS (SELECT 1 FROM purchase_orders po JOIN orders o ON o.id = po.order_id WHERE po.product_id = p.id AND o.status = 'received' AND o.id != @orderId)
      OR EXISTS (SELECT 1 FROM stock_snapshots s WHERE s.product_id = p.id AND s.stock_level > 0)
      OR EXISTS (SELECT 1 FROM sales_history h WHERE h.product_id = p.id AND h.quantity > 0)
    )
  `)

  const lines: FulfilmentMailLine[] = rows.map(r => {
    if (r.product_id === null) {
      return { sku: null, name: r.supplier_description || r.supplier_code || '', variant: null, barcode: null, hs_code: null, country_of_origin: null, quantity: r.quantity, is_new: true }
    }
    const split = splitName(r.name ?? '')
    return {
      sku: r.sku,
      name: split.name,
      variant: r.variant || split.variant,
      barcode: r.barcode,
      hs_code: r.hs_code,
      country_of_origin: r.country_of_origin,
      quantity: r.quantity,
      is_new: !seenBefore.get({ id: r.product_id, orderId }),
    }
  })

  const arrival = order.expected_arrival ? formatDate(order.expected_arrival) : null
  const newLines = lines.filter(l => l.is_new)
  const newIntro = newLines.length === 1 ? 'Er zit 1 nieuw product in:' : `Er zitten ${newLines.length} nieuwe producten in:`
  const intro = arrival ? `Er komt een bestelling aan, verwachte aankomst ${arrival}.` : 'Er komt een bestelling aan.'

  const text = [
    'Hi Peter,', '', intro, '',
    ...(newLines.length > 0 ? [newIntro, ...newLines.map(l => `- ${describe(l)}`), ''] : []),
    HEADERS.join('\t'),
    ...lines.map(l => cells(l).join('\t')),
  ].join('\n')

  const th = 'border:1px solid #ccc;padding:6px 10px;text-align:left;background:#f2f2f2;'
  const td = 'border:1px solid #ccc;padding:6px 10px;text-align:left;'
  const html = [
    '<p>Hi Peter,</p>',
    `<p>${escapeHtml(intro)}</p>`,
    ...(newLines.length > 0 ? [`<p>${escapeHtml(newIntro)}</p>`, `<ul>${newLines.map(l => `<li>${escapeHtml(describe(l))}</li>`).join('')}</ul>`] : []),
    '<table style="border-collapse:collapse;font-size:14px;">',
    `<thead><tr>${HEADERS.map(h => `<th style="${th}">${h}</th>`).join('')}</tr></thead>`,
    `<tbody>${lines.map(l => `<tr>${cells(l).map(c => `<td style="${td}">${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`,
    '</table>',
  ].join('')

  return {
    subject: arrival ? `Inkomende bestelling – verwachte aankomst ${arrival}` : 'Inkomende bestelling',
    html,
    text,
    missing_barcodes: lines.filter(l => l.sku && !l.barcode).map(l => l.sku as string),
  }
}
