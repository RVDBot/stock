import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db'
import { processOrders, rebuildSalesHistory } from '@/lib/sync'
import type { WooOrder } from '@/lib/woocommerce'

function freshDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  db.prepare(`INSERT INTO products (id, woo_product_id, sku, name, archived) VALUES
    (1, 1, 'A', 'Rope A', 0), (2, 2, 'B', 'Rope B', 0), (3, 3, 'X+Y', 'Bundel XY', 0), (4, 4, 'A+B', 'Oude bundel', 1)`).run()
  return db
}

const order = (id: number, date: string, items: [string, number][]): WooOrder => ({
  id, date_created: `${date}T10:00:00`, date_created_gmt: `${date}T09:00:00`,
  line_items: items.map(([sku, quantity]) => ({ product_id: 0, sku, quantity })),
})

const sales = (db: Database.Database) =>
  db.prepare('SELECT product_id, date, quantity FROM sales_history ORDER BY product_id, date').all()

describe('processOrders', () => {
  it('telt een order maar één keer, ook als syncs overlappen', () => {
    const db = freshDb()
    const orders = [order(100, '2026-10-01', [['A', 2]]), order(101, '2026-10-01', [['A', 1]])]
    processOrders(db, orders)
    const second = processOrders(db, [...orders, order(102, '2026-10-02', [['B', 5]])])

    expect(second).toEqual({ counted: 1, lines: 1 })
    expect(sales(db)).toEqual([
      { product_id: 1, date: '2026-10-01', quantity: 3 },
      { product_id: 2, date: '2026-10-02', quantity: 5 },
    ])
  })

  it('telt een bundel waarvan geen deel los bestaat op de eigen SKU', () => {
    const db = freshDb()
    processOrders(db, [order(100, '2026-10-01', [['X+Y', 4]])])
    expect(sales(db)).toEqual([{ product_id: 3, date: '2026-10-01', quantity: 4 }])
  })

  it('splitst een bundel van losse producten, ook als de bundel zelf nog gearchiveerd bestaat', () => {
    const db = freshDb()
    processOrders(db, [order(100, '2026-10-01', [['A+B', 1]])])
    expect(sales(db)).toEqual([
      { product_id: 1, date: '2026-10-01', quantity: 1 },
      { product_id: 2, date: '2026-10-01', quantity: 1 },
    ])
  })

  it('telt orders die vóór order-tracking al geteld waren niet opnieuw', () => {
    const db = new Database(':memory:')
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')")
    db.prepare("INSERT INTO settings (key, value) VALUES ('last_sync_at', '2026-10-01T12:00:00.000Z')").run()
    initSchema(db)
    db.prepare("INSERT INTO products (id, woo_product_id, sku, name) VALUES (1, 1, 'A', 'Rope A')").run()

    const result = processOrders(db, [order(100, '2026-10-01', [['A', 2]]), order(101, '2026-10-02', [['A', 3]])])

    expect(result.counted).toBe(1)
    expect(sales(db)).toEqual([{ product_id: 1, date: '2026-10-02', quantity: 3 }])
    // The skipped order is remembered, so a later sync doesn't pick it up either
    expect(processOrders(db, [order(100, '2026-10-01', [['A', 2]])]).counted).toBe(0)
  })
})

describe('rebuildSalesHistory', () => {
  it('vervangt dubbel getelde historie vanaf de startdatum en laat oudere data staan', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO sales_history (product_id, date, quantity) VALUES
      (1, '2023-01-01', 7), (1, '2026-10-01', 6)`).run()
    db.prepare("INSERT INTO settings (key, value) VALUES ('orders_counted_until', '2030-01-01T00:00:00Z')").run()

    rebuildSalesHistory(db, [order(100, '2026-10-01', [['A', 3]])], '2024-01-01')

    expect(sales(db)).toEqual([
      { product_id: 1, date: '2023-01-01', quantity: 7 },
      { product_id: 1, date: '2026-10-01', quantity: 3 },
    ])
    expect(db.prepare("SELECT 1 FROM settings WHERE key = 'orders_counted_until'").get()).toBeUndefined()
  })
})
