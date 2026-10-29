import type Database from 'better-sqlite3'
import { upsertAlias } from '@/lib/aliases'
import { isPositiveInt, isDateString } from '@/lib/validate'
import { ORDER_STATUSES, type Order, type OrderInput, type OrderLine, type OrderLineInput, type OrderStatus } from '@/lib/order-types'

const PENDING_STATUSES = "('ordered', 'shipped')"

// Stock on its way for one product — shared by stock-status and order-calculator
export function getPendingOrders(db: Database.Database, productId: number): { quantity: number; expected_arrival: string | null }[] {
  return db.prepare(`
    SELECT po.quantity, o.expected_arrival
    FROM purchase_orders po
    JOIN orders o ON o.id = po.order_id
    WHERE po.product_id = ? AND o.status IN ${PENDING_STATUSES}
  `).all(productId) as { quantity: number; expected_arrival: string | null }[]
}

export function listOrders(db: Database.Database, supplierId: number, filter: 'open' | 'all'): Order[] {
  const where = filter === 'open' ? `AND status IN ${PENDING_STATUSES}` : ''
  const orders = db.prepare(`SELECT * FROM orders WHERE supplier_id = ? ${where} ORDER BY order_date DESC, id DESC`)
    .all(supplierId) as Omit<Order, 'lines'>[]
  const linesStmt = db.prepare(`
    SELECT po.id, po.product_id, p.sku, p.name, po.quantity, po.supplier_code, po.supplier_description
    FROM purchase_orders po
    LEFT JOIN products p ON p.id = po.product_id
    WHERE po.order_id = ?
    ORDER BY po.id
  `)
  return orders.map(o => ({ ...o, lines: linesStmt.all(o.id) as OrderLine[] }))
}

function insertLines(db: Database.Database, orderId: number, input: OrderInput) {
  // order_date is still NOT NULL on the legacy line columns; status/arrival live on the order
  const insert = db.prepare(`
    INSERT INTO purchase_orders (order_id, supplier_id, product_id, quantity, order_date, supplier_code, supplier_description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  for (const line of input.lines) {
    insert.run(orderId, input.supplier_id, line.product_id, line.quantity, input.order_date, line.supplier_code || null, line.supplier_description || null)
    if (line.remember && line.product_id !== null) upsertAlias(db, input.supplier_id, line.product_id, line.supplier_code, line.supplier_description)
  }
}

export function createOrder(db: Database.Database, input: OrderInput): number {
  return db.transaction(() => {
    const r = db.prepare('INSERT INTO orders (supplier_id, order_date, supplier_ref, expected_arrival, notes) VALUES (?, ?, ?, ?, ?)')
      .run(input.supplier_id, input.order_date, input.supplier_ref || null, input.expected_arrival || null, input.notes || null)
    const orderId = Number(r.lastInsertRowid)
    insertLines(db, orderId, input)
    return orderId
  })()
}

export function updateOrder(db: Database.Database, id: number, input: OrderInput): boolean {
  return db.transaction(() => {
    const r = db.prepare('UPDATE orders SET supplier_id = ?, order_date = ?, supplier_ref = ?, expected_arrival = ?, notes = ? WHERE id = ?')
      .run(input.supplier_id, input.order_date, input.supplier_ref || null, input.expected_arrival || null, input.notes || null, id)
    if (r.changes === 0) return false
    db.prepare('DELETE FROM purchase_orders WHERE order_id = ?').run(id)
    insertLines(db, id, input)
    return true
  })()
}

export function setOrderStatus(db: Database.Database, id: number, status: OrderStatus): boolean {
  return db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id).changes > 0
}

export function deleteOrder(db: Database.Database, id: number): boolean {
  return db.transaction(() => {
    db.prepare('DELETE FROM purchase_orders WHERE order_id = ?').run(id)
    return db.prepare('DELETE FROM orders WHERE id = ?').run(id).changes > 0
  })()
}

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === 'string' && (ORDER_STATUSES as string[]).includes(v)
}

function optionalText(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string') return undefined
  return v.trim().slice(0, max) || null
}

export function validateOrderInput(body: unknown): { ok: true; value: OrderInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Ongeldige invoer' }
  const b = body as Record<string, unknown>
  if (!isPositiveInt(b.supplier_id)) return { ok: false, error: 'supplier_id is verplicht' }
  if (!isDateString(b.order_date)) return { ok: false, error: 'Besteldatum is verplicht (JJJJ-MM-DD)' }
  if (b.expected_arrival !== undefined && b.expected_arrival !== null && b.expected_arrival !== '' && !isDateString(b.expected_arrival)) {
    return { ok: false, error: 'Ongeldige verwachte aankomst' }
  }
  const supplierRef = optionalText(b.supplier_ref, 100)
  const notes = optionalText(b.notes, 2000)
  if (supplierRef === undefined || notes === undefined) return { ok: false, error: 'Ongeldige tekstvelden' }
  if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 500) {
    return { ok: false, error: 'Een bestelling heeft minimaal één regel nodig' }
  }
  const lines: OrderLineInput[] = []
  for (const raw of b.lines) {
    const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const unassigned = l.product_id === null || l.product_id === undefined
    if (!unassigned && !isPositiveInt(l.product_id)) return { ok: false, error: 'Elke regel heeft een product nodig' }
    if (!isPositiveInt(l.quantity) || l.quantity > 1_000_000) return { ok: false, error: 'Elke regel heeft een aantal van minimaal 1 nodig' }
    const code = optionalText(l.supplier_code, 200)
    const description = optionalText(l.supplier_description, 500)
    if (code === undefined || description === undefined) return { ok: false, error: 'Ongeldige regelgegevens' }
    // Without a product the description is the only way to know later what was ordered
    if (unassigned && !code && !description) return { ok: false, error: 'Een regel zonder product heeft een omschrijving nodig' }
    lines.push({ product_id: unassigned ? null : (l.product_id as number), quantity: l.quantity, supplier_code: code, supplier_description: description, remember: l.remember === true })
  }
  return {
    ok: true,
    value: {
      supplier_id: b.supplier_id,
      order_date: b.order_date,
      supplier_ref: supplierRef,
      expected_arrival: isDateString(b.expected_arrival) ? b.expected_arrival : null,
      notes,
      lines,
    },
  }
}
