import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'
import { fetchAllProducts, fetchOrders, splitCompositeSku, type WooOrder } from '@/lib/woocommerce'
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
  const allProducts = await fetchAllProducts()
  // Only published products belong in the dashboard; drafts, private, pending etc. get archived
  const products = allProducts.filter(p => p.status === 'publish')
  const unpublished = allProducts.filter(p => p.status !== 'publish')
  const today = new Date().toISOString().slice(0, 10)

  const upsertProduct = db.prepare(`
    INSERT INTO products (woo_product_id, sku, name, current_stock, price, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(sku) DO UPDATE SET
      woo_product_id = ?, name = ?, current_stock = ?, price = ?, archived = 0, updated_at = CURRENT_TIMESTAMP
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

  // Handle composite SKUs (A+B, A+B+C, etc.):
  // - Each part that exists as standalone → already tracked, skip it
  // - Each part that does NOT exist as standalone → this composite IS that product
  // - If ALL parts exist as standalone → hide composite entirely
  // - If NO parts exist as standalone → keep composite with original SKU (fallback)
  const standaloneSKUs = new Set<string>()
  for (const sku of skuMap.keys()) {
    if (!sku.includes('+')) standaloneSKUs.add(sku)
  }

  const compositesToRemove: string[] = []
  const compositesToRemap: { oldSku: string; newSku: string; product: typeof products[0] }[] = []
  for (const [sku, product] of skuMap) {
    if (!sku.includes('+')) continue
    const parts = sku.split('+').map(s => s.trim())
    const missingParts = parts.filter(part => !standaloneSKUs.has(part))

    if (missingParts.length === 0) {
      // All parts exist as standalone — composite is a bundle, hide it
      compositesToRemove.push(sku)
      log('info', `Samengesteld product ${sku} verborgen: alle delen bestaan als apart product`)
    } else if (missingParts.length < parts.length) {
      // Some parts exist standalone, some don't — each missing part becomes a product
      compositesToRemove.push(sku)
      for (const missingSku of missingParts) {
        compositesToRemap.push({ oldSku: sku, newSku: missingSku, product: { ...product, sku: missingSku } })
        log('info', `Samengesteld product ${sku} → ${missingSku} (niet als apart product gevonden)`)
      }
    }
    // else: no parts exist standalone → keep composite with original SKU (no action needed)
  }
  for (const sku of compositesToRemove) skuMap.delete(sku)
  for (const { newSku, product } of compositesToRemap) {
    // Only add if not already present (standalone version takes priority)
    if (!skuMap.has(newSku)) {
      skuMap.set(newSku, product)
    }
  }

  let synced = 0
  db.transaction(() => {
    const syncedSkus = JSON.stringify([...skuMap.keys()])
    const unarchived = db.prepare('SELECT sku FROM products WHERE archived = 1 AND sku IN (SELECT value FROM json_each(?))')
      .all(syncedSkus) as { sku: string }[]

    for (const p of skuMap.values()) {
      const stock = p.stock_quantity ?? 0
      const price = parseFloat(p.price) || 0

      // Find existing records that could conflict
      const existingBySku = db.prepare('SELECT id, woo_product_id FROM products WHERE sku = ?').get(p.sku) as { id: number; woo_product_id: number } | undefined
      // Prefer the row that already has this SKU: remapped composite parts share one woo id
      const existingByWooId = db.prepare('SELECT id, sku FROM products WHERE woo_product_id = ? ORDER BY (sku = ?) DESC LIMIT 1').get(p.id, p.sku) as { id: number; sku: string } | undefined

      // Only treat it as a SKU change when the old SKU is no longer live; otherwise it's a sibling part
      if (existingByWooId && existingByWooId.sku !== p.sku && !skuMap.has(existingByWooId.sku)) {
        // This woo_product_id exists with a different SKU (SKU changed in WooCommerce)
        if (existingBySku && existingBySku.id !== existingByWooId.id) {
          // Another record already has the target SKU — merge: move its references to our record, then reassign
          const oldId = existingBySku.id
          const keepId = existingByWooId.id
          db.prepare('UPDATE stock_snapshots SET product_id = ? WHERE product_id = ? AND date NOT IN (SELECT date FROM stock_snapshots WHERE product_id = ?)').run(keepId, oldId, keepId)
          db.prepare('DELETE FROM stock_snapshots WHERE product_id = ?').run(oldId)
          db.prepare('UPDATE sales_history SET product_id = ? WHERE product_id = ? AND date NOT IN (SELECT date FROM sales_history WHERE product_id = ?)').run(keepId, oldId, keepId)
          db.prepare('DELETE FROM sales_history WHERE product_id = ?').run(oldId)
          db.prepare('UPDATE purchase_orders SET product_id = ? WHERE product_id = ?').run(keepId, oldId)
          db.prepare('UPDATE supplier_product_aliases SET product_id = ? WHERE product_id = ?').run(keepId, oldId)
          db.prepare(`
            UPDATE products SET
              barcode = COALESCE(products.barcode, o.barcode), variant = COALESCE(products.variant, o.variant), cogm = COALESCE(products.cogm, o.cogm),
              cogs = COALESCE(products.cogs, o.cogs), country_of_origin = COALESCE(products.country_of_origin, o.country_of_origin), hs_code = COALESCE(products.hs_code, o.hs_code)
            FROM (SELECT * FROM products WHERE id = ?) AS o
            WHERE products.id = ?
          `).run(oldId, keepId)
          db.prepare('DELETE FROM products WHERE id = ?').run(oldId)
          log('info', `Product ${oldId} (sku=${p.sku}) samengevoegd met ${keepId} (woo_id=${p.id})`)
        }
        // Update the SKU on our existing record
        db.prepare('UPDATE products SET sku = ? WHERE id = ?').run(p.sku, existingByWooId.id)
        log('info', `SKU gewijzigd: "${existingByWooId.sku}" → "${p.sku}" (woo_id=${p.id})`)
      } else if (!existingByWooId && existingBySku) {
        // New woo_product_id claiming an existing SKU — update the existing record's woo_product_id
        db.prepare('UPDATE products SET woo_product_id = ? WHERE id = ?').run(p.id, existingBySku.id)
      }

      upsertProduct.run(p.id, p.sku, p.name, stock, price, p.id, p.name, stock, price)

      const row = db.prepare('SELECT id FROM products WHERE sku = ?').get(p.sku) as { id: number }
      upsertSnapshot.run(row.id, today, stock, stock)
      synced++
    }

    if (unarchived.length > 0) {
      log('info', `Sync: ${unarchived.length} producten uit archief gehaald (weer gepubliceerd): ${unarchived.map(r => r.sku).join(', ')}`)
    }

    // Archive products whose SKU is no longer published in WooCommerce (don't delete — preserves history).
    // Matched on SKU, not woo_product_id: remapped composite parts share their bundle's woo id.
    if (skuMap.size === 0) {
      log('warn', 'Sync: geen gepubliceerde producten ontvangen, archiveren overgeslagen')
    } else {
      const toArchive = db.prepare('SELECT sku FROM products WHERE archived = 0 AND sku NOT IN (SELECT value FROM json_each(?))')
        .all(syncedSkus) as { sku: string }[]
      if (toArchive.length > 0) {
        db.prepare('UPDATE products SET archived = 1 WHERE archived = 0 AND sku NOT IN (SELECT value FROM json_each(?))').run(syncedSkus)
        log('info', `Sync: ${toArchive.length} producten gearchiveerd (niet meer gepubliceerd in WooCommerce): ${toArchive.map(r => r.sku).join(', ')}`)
      }
    }

    const added = storeUnpublishedProducts(db, unpublished, new Set(skuMap.keys()))
    if (added.length > 0) {
      log('info', `Sync: ${added.length} niet-gepubliceerde producten opgeslagen (gearchiveerd, kiesbaar bij bestellingen): ${added.join(', ')}`)
    }
  })()

  log('info', `Sync: ${synced} producten bijgewerkt`)
  return synced
}

// Unpublished products (e.g. disabled variations) are kept archived so orders can already be
// matched to them; publishing them later un-archives the same row. Live SKUs are never touched.
export function storeUnpublishedProducts(
  db: Database.Database,
  unpublished: { id: number; sku: string; name: string }[],
  liveSkus: Set<string>,
): string[] {
  const exists = db.prepare('SELECT 1 FROM products WHERE sku = ?')
  const insert = db.prepare('INSERT INTO products (woo_product_id, sku, name, archived) VALUES (?, ?, ?, 1)')
  const rename = db.prepare('UPDATE products SET name = ? WHERE sku = ? AND archived = 1')
  const added: string[] = []
  const seen = new Set<string>()
  for (const p of unpublished) {
    // Composite SKUs are bundles; their parts are handled by the published sync
    if (!p.sku || p.sku.includes('+') || liveSkus.has(p.sku) || seen.has(p.sku)) continue
    seen.add(p.sku)
    if (exists.get(p.sku)) {
      rename.run(p.name, p.sku)
    } else {
      insert.run(p.id, p.sku, p.name)
      added.push(p.sku)
    }
  }
  return added
}

// Overlapping windows are safe (each order is counted once), so look back a week to catch up on missed syncs
const RECENT_ORDER_DAYS = 7
const HISTORY_YEARS = 3

export async function syncRecentOrders() {
  const db = getDb()
  const since = new Date(Date.now() - RECENT_ORDER_DAYS * 86400000).toISOString()
  const orders = await fetchOrders(since)
  const result = processOrders(db, orders)
  log('info', `Orders: ${result.lines} verkoopregels verwerkt uit ${result.counted} nieuwe orders (${orders.length} opgehaald)`)
  return result.lines
}

const orderTime = (o: WooOrder) =>
  o.date_created_gmt ? Date.parse(o.date_created_gmt + 'Z') : Date.parse(o.date_created)

// Adds each order's lines to sales_history once; orders seen before are skipped
export function processOrders(db: Database.Database, orders: WooOrder[]): { counted: number; lines: number } {
  const upsertSales = db.prepare(`
    INSERT INTO sales_history (product_id, date, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT(product_id, date) DO UPDATE SET quantity = quantity + ?
  `)
  const markProcessed = db.prepare('INSERT OR IGNORE INTO processed_orders (woo_order_id) VALUES (?)')
  const findProduct = db.prepare('SELECT id FROM products WHERE sku = ?')
  const findLiveProduct = db.prepare('SELECT id FROM products WHERE sku = ? AND archived = 0')
  // Syncs from before order tracking counted every order up to their own run
  const countedUntilRow = db.prepare("SELECT value FROM settings WHERE key = 'orders_counted_until'").get() as { value: string } | undefined
  const countedUntil = countedUntilRow ? Date.parse(countedUntilRow.value) : NaN

  let counted = 0
  let lines = 0
  db.transaction(() => {
    for (const order of orders) {
      if (markProcessed.run(order.id).changes === 0) continue
      if (orderTime(order) <= countedUntil) continue
      counted++
      const date = order.date_created.slice(0, 10)
      for (const item of order.line_items) {
        const sku = item.sku || ''
        // A bundle none of whose parts is sold separately is tracked under its own SKU
        const bundle = sku.includes('+') ? findLiveProduct.get(sku) as { id: number } | undefined : undefined
        const productIds = bundle
          ? [bundle.id]
          : splitCompositeSku(sku).map(s => (findProduct.get(s) as { id: number } | undefined)?.id).filter((id): id is number => id !== undefined)
        for (const productId of productIds) {
          upsertSales.run(productId, date, item.quantity, item.quantity)
          lines++
        }
      }
    }
  })()
  return { counted, lines }
}

// Replaces the sales history from `sinceDate` on with exactly these orders; also undoes earlier double counting
export function rebuildSalesHistory(db: Database.Database, orders: WooOrder[], sinceDate: string) {
  return db.transaction(() => {
    db.prepare('DELETE FROM sales_history WHERE date >= ?').run(sinceDate)
    db.prepare('DELETE FROM processed_orders').run()
    db.prepare("DELETE FROM settings WHERE key = 'orders_counted_until'").run()
    return processOrders(db, orders)
  })()
}

export async function importHistoricalOrders() {
  const db = getDb()
  const since = new Date()
  since.setFullYear(since.getFullYear() - HISTORY_YEARS)
  const sinceDate = since.toISOString().slice(0, 10)
  // Woo compares `after` in shop time, like date_created, so whole days line up with the delete
  const orders = await fetchOrders(`${sinceDate}T00:00:00`)
  const result = rebuildSalesHistory(db, orders, sinceDate)
  log('info', `Historische import: verkoophistorie vanaf ${sinceDate} opnieuw opgebouwd uit ${result.counted} orders (${result.lines} verkoopregels)`)
  return result.lines
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

export class SyncBusyError extends Error {}

// globalThis: the scheduler and the route handlers load separate copies of this module
const syncState = globalThis as { __stockSyncRunning?: boolean }

async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (syncState.__stockSyncRunning) throw new SyncBusyError('Er loopt al een sync, probeer het over een paar minuten opnieuw')
  syncState.__stockSyncRunning = true
  try {
    return await fn()
  } finally {
    syncState.__stockSyncRunning = false
  }
}

async function trackSync<T>(type: string, fn: () => Promise<T>): Promise<T> {
  try {
    setSetting('last_sync_status', 'running')
    setSetting('last_sync_type', type)
    const result = await fn()
    setSetting('last_sync_at', new Date().toISOString())
    setSetting('last_sync_status', 'success')
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    setSetting('last_sync_status', `error: ${msg}`)
    log('error', `Sync fout (${type}): ${msg}`)
    throw e
  }
}

export function runDailySync(type: 'manual' | 'automated' = 'manual') {
  return exclusive(() => trackSync(type, async () => {
    await syncProducts()
    await syncRecentOrders()
    log('info', `Sync voltooid (${type})`)
  }))
}

export function runHistoricalImport() {
  return exclusive(() => trackSync('historical', async () => {
    const ordersProcessed = await importHistoricalOrders()
    return { ordersProcessed, peaks: analyzeHistoricalPeaks() }
  }))
}
