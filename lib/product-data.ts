import type Database from 'better-sqlite3'

export interface ProductDataInput {
  barcode: string | null
  variant: string | null
  cogm: number | null
  cogs: number | null
  country_of_origin: string | null
  hs_code: string | null
}

export interface SheetRow extends ProductDataInput {
  sku: string
  discontinued: boolean
}

export interface ImportDataResult {
  updated: number
  not_in_dashboard: number
  discontinued: number
  duplicate_barcodes: { barcode: string; skus: string[] }[]
  active_without_barcode: string[]
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const input = text.replace(/^﻿/, '')
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}

// "€ 1.234,50" -> 1234.5. Empty, "-" and € 0,00 all mean the cost is unknown, not free.
export function parseEuro(value: string): number | null {
  const n = parseFloat(value.replace(/[€\s.]/g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

const blankToNull = (v: string | undefined) => v?.trim() || null

export function parseProductSheet(text: string): SheetRow[] | null {
  const [header, ...rows] = parseCsv(text)
  if (!header) return null
  const names = header.map(h => h.trim().toLowerCase())
  const col = (prefix: string) => names.findIndex(n => n.startsWith(prefix))
  const sku = col('sku')
  const barcode = col('barcode')
  if (sku < 0 || barcode < 0) return null
  const variants = names.flatMap((n, i) => (n === 'variant' ? [i] : []))
  const [cogm, cogs, country, hs] = [col('cogm'), col('cogs'), col('country of origin'), col('hs-code')]

  return rows.filter(r => r[sku]?.trim()).map(r => {
    const countryValue = blankToNull(r[country])
    const barcodeValue = blankToNull(r[barcode])
    return {
      sku: r[sku].trim(),
      discontinued: r.some(c => c.trim().toLowerCase() === 'uitverkocht'),
      barcode: barcodeValue,
      variant: variants.map(i => r[i]?.trim()).filter(Boolean).join(' / ') || null,
      cogm: parseEuro(r[cogm] ?? ''),
      cogs: parseEuro(r[cogs] ?? ''),
      country_of_origin: countryValue === 'NL' ? 'NLD' : countryValue,
      hs_code: blankToNull(r[hs]),
    }
  })
}

// Only products the dashboard knows are filled; sheet rows without a match are old products.
// Blank sheet cells keep what is stored, so importing again never wipes manual edits.
export function importProductData(db: Database.Database, rows: SheetRow[]): ImportDataResult {
  const update = db.prepare(`
    UPDATE products SET
      barcode = COALESCE(?, barcode), variant = COALESCE(?, variant), cogm = COALESCE(?, cogm),
      cogs = COALESCE(?, cogs), country_of_origin = COALESCE(?, country_of_origin), hs_code = COALESCE(?, hs_code)
    WHERE sku = ?
  `)
  const result: ImportDataResult = { updated: 0, not_in_dashboard: 0, discontinued: 0, duplicate_barcodes: [], active_without_barcode: [] }
  const byBarcode = new Map<string, string[]>()

  db.transaction(() => {
    for (const r of rows) {
      if (r.discontinued) { result.discontinued++; continue }
      const changes = update.run(r.barcode, r.variant, r.cogm, r.cogs, r.country_of_origin, r.hs_code, r.sku).changes
      if (changes === 0) { result.not_in_dashboard++; continue }
      result.updated++
      if (r.barcode) byBarcode.set(r.barcode, [...(byBarcode.get(r.barcode) ?? []), r.sku])
    }
  })()

  result.duplicate_barcodes = [...byBarcode].filter(([, skus]) => skus.length > 1).map(([barcode, skus]) => ({ barcode, skus }))
  // Bundles (A+B) and temporary SKUs have no barcode of their own
  result.active_without_barcode = (db.prepare(`
    SELECT sku FROM products
    WHERE active = 1 AND archived = 0 AND barcode IS NULL AND sku NOT LIKE '%+%' AND sku NOT LIKE 'TEMP%'
    ORDER BY sku
  `).all() as { sku: string }[]).map(r => r.sku)
  return result
}

function optionalNumber(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export function validateProductData(body: unknown): ProductDataInput | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : null)
  const cogm = optionalNumber(b.cogm)
  const cogs = optionalNumber(b.cogs)
  if (cogm === undefined || cogs === undefined) return null
  return {
    barcode: text(b.barcode, 32),
    variant: text(b.variant, 200),
    cogm,
    cogs,
    country_of_origin: text(b.country_of_origin, 32),
    hs_code: text(b.hs_code, 32),
  }
}

export function updateProductData(db: Database.Database, id: number, data: ProductDataInput): boolean {
  return db.prepare('UPDATE products SET barcode = ?, variant = ?, cogm = ?, cogs = ?, country_of_origin = ?, hs_code = ? WHERE id = ?')
    .run(data.barcode, data.variant, data.cogm, data.cogs, data.country_of_origin, data.hs_code, id).changes > 0
}
