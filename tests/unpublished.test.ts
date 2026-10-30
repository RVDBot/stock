import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db'
import { createOrder, getUnpublishedProducts } from '@/lib/orders'
import { storeUnpublishedProducts } from '@/lib/sync'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  db.prepare("INSERT INTO suppliers (id, name, lead_time_days) VALUES (1, 'Fab', 30), (2, 'Ander', 30)").run()
  db.prepare("INSERT INTO products (id, woo_product_id, sku, name, supplier_id) VALUES (10, 1, 'LIVE', 'Live rope', 1)").run()
})

describe('niet-gepubliceerde producten', () => {
  it('slaat nieuwe niet-gepubliceerde varianten gearchiveerd op en laat live SKUs met rust', () => {
    db.prepare("INSERT INTO products (id, woo_product_id, sku, name, archived) VALUES (20, 5, 'OLD', 'Oude naam', 1)").run()
    const added = storeUnpublishedProducts(db, [
      { id: 7, sku: 'NEW-GREEN', name: 'Speed Rope PRO - Groen' },
      { id: 8, sku: 'LIVE', name: 'Concept met live SKU' },
      { id: 9, sku: 'A+B', name: 'Bundel' },
      { id: 11, sku: '', name: 'Zonder SKU' },
      { id: 5, sku: 'OLD', name: 'Nieuwe naam' },
      { id: 12, sku: 'NEW-GREEN', name: 'Dubbel' },
    ], new Set(['LIVE']))
    expect(added).toEqual(['NEW-GREEN'])
    expect(db.prepare("SELECT archived, name, supplier_id FROM products WHERE sku = 'NEW-GREEN'").get()).toEqual({ archived: 1, name: 'Speed Rope PRO - Groen', supplier_id: null })
    expect(db.prepare("SELECT archived, name FROM products WHERE sku = 'LIVE'").get()).toEqual({ archived: 0, name: 'Live rope' })
    expect(db.prepare("SELECT name FROM products WHERE sku = 'OLD'").get()).toEqual({ name: 'Nieuwe naam' })
    expect(db.prepare("SELECT COUNT(*) AS n FROM products WHERE sku = 'A+B'").get()).toEqual({ n: 0 })
  })

  it('biedt eigen en nog niet toegewezen niet-gepubliceerde producten aan', () => {
    db.prepare(`INSERT INTO products (id, woo_product_id, sku, name, supplier_id, archived, active) VALUES
      (30, 3, 'MINE', 'Mijn variant', 1, 1, 1),
      (31, 4, 'FREE', 'Vrije variant', NULL, 1, 1),
      (32, 6, 'OTHER', 'Andermans variant', 2, 1, 1),
      (33, 7, 'IGNORED', 'Genegeerd', NULL, 1, 0)`).run()
    expect(getUnpublishedProducts(db, 1).map(p => p.sku)).toEqual(['MINE', 'FREE'])
    expect(getUnpublishedProducts(db, 2).map(p => p.sku).sort()).toEqual(['FREE', 'OTHER'])
  })

  it('koppelt een product zonder leverancier aan de leverancier van de order', () => {
    db.prepare("INSERT INTO products (id, woo_product_id, sku, name, archived) VALUES (31, 4, 'FREE', 'Vrije variant', 1)").run()
    db.prepare("INSERT INTO products (id, woo_product_id, sku, name, supplier_id, archived) VALUES (32, 6, 'OTHER', 'Andermans', 2, 1)").run()
    createOrder(db, { supplier_id: 1, order_date: '2026-10-30', lines: [{ product_id: 31, quantity: 100 }, { product_id: 32, quantity: 5 }] })
    expect(db.prepare('SELECT supplier_id FROM products WHERE id = 31').get()).toEqual({ supplier_id: 1 })
    expect(db.prepare('SELECT supplier_id FROM products WHERE id = 32').get()).toEqual({ supplier_id: 2 })
  })
})
