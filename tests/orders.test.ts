import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db'
import { createOrder, updateOrder, setOrderStatus, deleteOrder, listOrders, getPendingOrders, validateOrderInput } from '@/lib/orders'
import { getAliasMap } from '@/lib/aliases'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  db.prepare("INSERT INTO suppliers (id, name, lead_time_days) VALUES (1, 'Fab', 30)").run()
  db.prepare("INSERT INTO products (id, woo_product_id, sku, name, supplier_id) VALUES (10, 1, 'SKU-A', 'Rope A', 1), (11, 2, 'SKU-B', 'Rope B', 1)").run()
})

const base = { supplier_id: 1, order_date: '2026-10-01', supplier_ref: 'PI-1', expected_arrival: '2026-11-15', notes: null }

describe('orders', () => {
  it('maakt een order met regels en geeft hem terug in de lijst', () => {
    const id = createOrder(db, { ...base, lines: [{ product_id: 10, quantity: 50, supplier_code: 'X1', supplier_description: 'Rope black' }, { product_id: 11, quantity: 5 }] })
    const [order] = listOrders(db, 1, 'all')
    expect(order.id).toBe(id)
    expect(order.supplier_ref).toBe('PI-1')
    expect(order.lines.map(l => [l.product_id, l.quantity, l.sku])).toEqual([[10, 50, 'SKU-A'], [11, 5, 'SKU-B']])
  })

  it('onthoudt alleen regels met remember', () => {
    createOrder(db, { ...base, lines: [{ product_id: 10, quantity: 1, supplier_code: 'X1', remember: true }, { product_id: 11, quantity: 1, supplier_code: 'X2' }] })
    const map = getAliasMap(db, 1)
    expect(map.get('x1')).toBe(10)
    expect(map.has('x2')).toBe(false)
  })

  it('telt alleen besteld en verzonden als onderweg', () => {
    const a = createOrder(db, { ...base, lines: [{ product_id: 10, quantity: 50 }] })
    createOrder(db, { ...base, expected_arrival: null, lines: [{ product_id: 10, quantity: 7 }] })
    expect(getPendingOrders(db, 10).reduce((s, o) => s + o.quantity, 0)).toBe(57)
    setOrderStatus(db, a, 'received')
    expect(getPendingOrders(db, 10)).toEqual([{ quantity: 7, expected_arrival: null }])
  })

  it('filtert open orders', () => {
    const a = createOrder(db, { ...base, lines: [{ product_id: 10, quantity: 1 }] })
    createOrder(db, { ...base, lines: [{ product_id: 11, quantity: 1 }] })
    setOrderStatus(db, a, 'received')
    expect(listOrders(db, 1, 'open')).toHaveLength(1)
    expect(listOrders(db, 1, 'all')).toHaveLength(2)
  })

  it('vervangt regels bij update en verwijdert order met regels', () => {
    const id = createOrder(db, { ...base, lines: [{ product_id: 10, quantity: 1 }] })
    expect(updateOrder(db, id, { ...base, supplier_ref: 'PI-2', lines: [{ product_id: 11, quantity: 9 }] })).toBe(true)
    const [order] = listOrders(db, 1, 'all')
    expect(order.supplier_ref).toBe('PI-2')
    expect(order.lines.map(l => l.product_id)).toEqual([11])
    expect(deleteOrder(db, id)).toBe(true)
    expect((db.prepare('SELECT COUNT(*) n FROM purchase_orders').get() as { n: number }).n).toBe(0)
    expect(updateOrder(db, 999, { ...base, lines: [{ product_id: 10, quantity: 1 }] })).toBe(false)
  })
})

describe('validateOrderInput', () => {
  const ok = { supplier_id: 1, order_date: '2026-10-01', lines: [{ product_id: 10, quantity: 3 }] }
  it('accepteert een geldige order en maakt lege velden null', () => {
    const r = validateOrderInput({ ...ok, supplier_ref: '', expected_arrival: '', notes: '' })
    expect(r).toEqual({ ok: true, value: { ...ok, supplier_ref: null, expected_arrival: null, notes: null, lines: [{ product_id: 10, quantity: 3, supplier_code: null, supplier_description: null, remember: false }] } })
  })
  it('weigert een order zonder regels, met aantal 0, of met ongeldige datum', () => {
    expect(validateOrderInput({ ...ok, lines: [] }).ok).toBe(false)
    expect(validateOrderInput({ ...ok, lines: [{ product_id: 10, quantity: 0 }] }).ok).toBe(false)
    expect(validateOrderInput({ ...ok, order_date: '1-10-2026' }).ok).toBe(false)
    expect(validateOrderInput(null).ok).toBe(false)
  })
  it('accepteert een regel zonder product mits er een omschrijving of code is', () => {
    const r = validateOrderInput({ ...ok, lines: [{ product_id: null, quantity: 4, supplier_description: 'Nieuw touw 3m' }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.lines[0]).toMatchObject({ product_id: null, quantity: 4, supplier_description: 'Nieuw touw 3m', remember: false })
    expect(validateOrderInput({ ...ok, lines: [{ product_id: null, quantity: 4, supplier_code: 'NX-1' }] }).ok).toBe(true)
    const bad = validateOrderInput({ ...ok, lines: [{ product_id: null, quantity: 4 }] })
    expect(bad).toEqual({ ok: false, error: 'Een regel zonder product heeft een omschrijving nodig' })
  })
})

describe('regels zonder product', () => {
  it('worden opgeslagen, getoond en tellen niet mee als onderweg, en worden niet onthouden', () => {
    const id = createOrder(db, { ...base, lines: [
      { product_id: 10, quantity: 5 },
      { product_id: null, quantity: 8, supplier_code: 'NX-1', supplier_description: 'Nieuw touw', remember: true },
    ] })
    const [order] = listOrders(db, 1, 'all')
    expect(order.id).toBe(id)
    expect(order.lines.map(l => [l.product_id, l.sku, l.quantity])).toEqual([[10, 'SKU-A', 5], [null, null, 8]])
    expect(getPendingOrders(db, 10).reduce((s, o) => s + o.quantity, 0)).toBe(5)
    expect(getAliasMap(db, 1).has('nx1')).toBe(false)

    // Assigning later via an update counts it as pending and remembers the code
    updateOrder(db, id, { ...base, lines: [
      { product_id: 10, quantity: 5 },
      { product_id: 11, quantity: 8, supplier_code: 'NX-1', supplier_description: 'Nieuw touw', remember: true },
    ] })
    expect(getPendingOrders(db, 11).reduce((s, o) => s + o.quantity, 0)).toBe(8)
    expect(getAliasMap(db, 1).get('nx1')).toBe(11)
  })
})

