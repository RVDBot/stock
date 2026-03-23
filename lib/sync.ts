import { getDb } from '@/lib/db'
import { fetchAllProducts, fetchOrders, splitCompositeSku, getWooCredentials } from '@/lib/woocommerce'
import { log } from '@/lib/logger'

function getSetting(key: string): string {
  const db = getDb()
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value || ''
}

function setSetting(key: string, value: string) {
  const db = getDb()
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(key, value, value)
}

export async function syncProducts() {
  const db = getDb()
  const products = await fetchAllProducts()
  const today = new Date().toISOString().slice(0, 10)

  const upsertProduct = db.prepare(`
    INSERT INTO products (woo_product_id, sku, name, current_stock, price, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(sku) DO UPDATE SET
      woo_product_id = ?, name = ?, current_stock = ?, price = ?, updated_at = CURRENT_TIMESTAMP
  `)

  const upsertSnapshot = db.prepare(`
    INSERT INTO stock_snapshots (product_id, date, stock_level)
    VALUES (?, ?, ?)
    ON CONFLICT(product_id, date) DO UPDATE SET stock_level = ?
  `)

  // Deduplicate SKUs: if a SKU appears in multiple products (e.g. standalone + as part of
  // a composite/variable), prefer the one that manages its own stock. If multiple manage
  // stock, take the highest value.
  const skuMap = new Map<string, typeof products[0]>()
  const skuDuplicates = new Map<string, typeof products[0][]>()
  for (const p of products) {
    if (!p.sku) continue

    // Track all occurrences for debugging
    if (!skuDuplicates.has(p.sku)) skuDuplicates.set(p.sku, [])
    skuDuplicates.get(p.sku)!.push(p)

    const existing = skuMap.get(p.sku)
    if (!existing) {
      skuMap.set(p.sku, p)
    } else {
      const existingManages = existing.manage_stock
      const newManages = p.manage_stock
      // Prefer the product that manages its own stock
      if (newManages && !existingManages) {
        skuMap.set(p.sku, p)
      } else if (newManages === existingManages) {
        // Both manage or both don't: take the higher stock
        if ((p.stock_quantity ?? 0) > (existing.stock_quantity ?? 0)) {
          skuMap.set(p.sku, p)
        }
      }
    }
  }

  // Log duplicate SKUs for debugging
  for (const [sku, entries] of skuDuplicates) {
    if (entries.length > 1) {
      const chosen = skuMap.get(sku)!
      log('info', `SKU ${sku} komt ${entries.length}x voor: ${entries.map(e => `[id=${e.id}, stock=${e.stock_quantity}, manage=${e.manage_stock}, name="${e.name}"]`).join(', ')} → gekozen: id=${chosen.id} stock=${chosen.stock_quantity}`)
    }
  }

  let synced = 0
  db.transaction(() => {
    for (const p of skuMap.values()) {
      const stock = p.stock_quantity ?? 0
      const price = parseFloat(p.price) || 0
      upsertProduct.run(p.id, p.sku, p.name, stock, price, p.id, p.name, stock, price)

      const row = db.prepare('SELECT id FROM products WHERE sku = ?').get(p.sku) as { id: number }
      upsertSnapshot.run(row.id, today, stock, stock)
      synced++
    }
  })()

  log('info', `Sync: ${synced} producten bijgewerkt`)
  return synced
}

export async function syncRecentOrders() {
  const db = getDb()
  const yesterday = new Date(Date.now() - 86400000).toISOString()
  const orders = await fetchOrders(yesterday)
  return processOrders(db, orders)
}

interface WooOrderForProcessing {
  id: number
  date_created: string
  line_items: { product_id: number; sku: string; quantity: number }[]
}

function processOrders(db: ReturnType<typeof getDb>, orders: WooOrderForProcessing[]) {
  const upsertSales = db.prepare(`
    INSERT INTO sales_history (product_id, date, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT(product_id, date) DO UPDATE SET quantity = quantity + ?
  `)

  let processed = 0
  db.transaction(() => {
    for (const order of orders) {
      const date = order.date_created.slice(0, 10)
      for (const item of order.line_items) {
        const skus = splitCompositeSku(item.sku || '')
        for (const sku of skus) {
          const product = db.prepare('SELECT id FROM products WHERE sku = ?').get(sku) as { id: number } | undefined
          if (!product) continue
          upsertSales.run(product.id, date, item.quantity, item.quantity)
          processed++
        }
      }
    }
  })()

  log('info', `Orders: ${processed} verkoopregels verwerkt uit ${orders.length} orders`)
  return processed
}

export async function importHistoricalOrders(onProgress?: (pct: number, msg: string) => void) {
  const db = getDb()
  const { url, key, secret } = getWooCredentials()
  const threeYearsAgo = new Date()
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3)

  let page = 1
  const perPage = 100
  const allOrders: WooOrderForProcessing[] = []

  const firstParams = new URLSearchParams({
    per_page: String(perPage), page: '1',
    status: 'completed,processing', after: threeYearsAgo.toISOString(),
  })
  const firstRes = await fetch(`${url}/wp-json/wc/v3/orders?${firstParams}`, {
    headers: { 'Authorization': 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64') },
  })
  if (!firstRes.ok) throw new Error(`WooCommerce API fout: ${firstRes.status}`)
  const totalPages = parseInt(firstRes.headers.get('x-wp-totalpages') || '1', 10)
  const firstData = await firstRes.json()
  allOrders.push(...firstData)
  if (onProgress) onProgress(Math.round((1 / totalPages) * 100), `Pagina 1/${totalPages}`)

  for (page = 2; page <= totalPages; page++) {
    await new Promise(r => setTimeout(r, 200))
    const params = new URLSearchParams({
      per_page: String(perPage), page: String(page),
      status: 'completed,processing', after: threeYearsAgo.toISOString(),
    })
    const res = await fetch(`${url}/wp-json/wc/v3/orders?${params}`, {
      headers: { 'Authorization': 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64') },
    })
    if (!res.ok) {
      log('warn', `Historische import: pagina ${page} mislukt (${res.status}), doorgaan...`)
      continue
    }
    const data = await res.json()
    allOrders.push(...data)
    if (onProgress) onProgress(Math.round((page / totalPages) * 100), `Pagina ${page}/${totalPages}`)
  }

  log('info', `Historische import: ${allOrders.length} orders opgehaald uit ${totalPages} pagina's`)
  return processOrders(db, allOrders)
}

export interface PeakWeek {
  weekStart: string
  totalSales: number
  avgWeeklySales: number
  ratio: number
}

export function analyzeHistoricalPeaks(): PeakWeek[] {
  const db = getDb()
  const weeks = db.prepare(`
    SELECT strftime('%Y-W%W', date) as week,
           MIN(date) as week_start,
           SUM(quantity) as total_sales
    FROM sales_history
    GROUP BY week
    ORDER BY week
  `).all() as { week: string; week_start: string; total_sales: number }[]

  if (weeks.length === 0) return []

  const avgWeekly = weeks.reduce((s, w) => s + w.total_sales, 0) / weeks.length
  return weeks
    .filter(w => w.total_sales > avgWeekly * 2)
    .map(w => ({
      weekStart: w.week_start,
      totalSales: w.total_sales,
      avgWeeklySales: Math.round(avgWeekly),
      ratio: Math.round((w.total_sales / avgWeekly) * 10) / 10,
    }))
    .sort((a, b) => b.ratio - a.ratio)
}

export async function runDailySync(type: 'manual' | 'automated' = 'manual') {
  try {
    setSetting('last_sync_status', 'running')
    setSetting('last_sync_type', type)
    await syncProducts()
    await syncRecentOrders()
    setSetting('last_sync_at', new Date().toISOString())
    setSetting('last_sync_status', 'success')
    log('info', `Sync voltooid (${type})`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    setSetting('last_sync_status', `error: ${msg}`)
    log('error', `Sync fout: ${msg}`)
    throw e
  }
}
