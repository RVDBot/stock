import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db'

function freshDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  db.prepare("INSERT INTO suppliers (id, name, lead_time_days) VALUES (1, 'Fab', 30)").run()
  db.prepare("INSERT INTO products (id, woo_product_id, sku, name, supplier_id) VALUES (10, 1, 'SKU-A', 'Rope A', 1), (11, 2, 'SKU-B', 'Rope B', 1)").run()
  return db
}

describe('orders migration', () => {
  it('maakt van elke losse bestelling een order met één regel, en is idempotent', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO purchase_orders (supplier_id, product_id, quantity, order_date, expected_arrival, status, notes)
      VALUES (1, 10, 50, '2026-09-01', '2026-10-15', 'shipped', 'eerste'), (1, 11, 20, '2026-09-05', NULL, 'ordered', NULL)`).run()

    initSchema(db)
    initSchema(db)

    const orders = db.prepare('SELECT * FROM orders ORDER BY id').all() as { supplier_id: number; order_date: string; expected_arrival: string | null; status: string; notes: string | null }[]
    expect(orders).toHaveLength(2)
    expect(orders[0]).toMatchObject({ supplier_id: 1, order_date: '2026-09-01', expected_arrival: '2026-10-15', status: 'shipped', notes: 'eerste' })
    expect(orders[1]).toMatchObject({ order_date: '2026-09-05', status: 'ordered' })

    const unlinked = db.prepare('SELECT COUNT(*) as n FROM purchase_orders WHERE order_id IS NULL').get() as { n: number }
    expect(unlinked.n).toBe(0)
  })

  it('migreert max tokens van de datumzoeker met een minimum van 1024', () => {
    const db = freshDb()
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_max_tokens_per_lookup', '100')").run()
    initSchema(db)
    const get = (k: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value
    expect(get('ai_max_tokens_event_lookup')).toBe('1024')
    expect(get('ai_max_tokens_per_lookup')).toBeUndefined()
  })

  it('neemt een hogere oude waarde over', () => {
    const db = freshDb()
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_max_tokens_per_lookup', '2048')").run()
    initSchema(db)
    const row = db.prepare("SELECT value FROM settings WHERE key = 'ai_max_tokens_event_lookup'").get() as { value: string }
    expect(row.value).toBe('2048')
  })

  it('kent bestaand totaalverbruik eenmalig toe aan de datumzoeker', () => {
    const db = freshDb()
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_total_input_tokens', '500'), ('ai_total_output_tokens', '70')").run()
    initSchema(db)
    db.prepare("UPDATE settings SET value = '900' WHERE key = 'ai_total_input_tokens'").run()
    initSchema(db)
    const get = (k: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string }).value
    expect(get('ai_tokens_event_lookup_input')).toBe('500')
    expect(get('ai_tokens_event_lookup_output')).toBe('70')
  })
})
