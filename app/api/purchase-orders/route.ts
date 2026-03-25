import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { isPositiveInt, isNonEmptyString, isDateString, isStringOrNull } from '@/lib/validate'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const db = getDb()
  const supplierId = req.nextUrl.searchParams.get('supplier_id')
  const status = req.nextUrl.searchParams.get('status')

  let query = 'SELECT * FROM purchase_orders'
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (supplierId) {
    conditions.push('supplier_id = ?')
    params.push(parseInt(supplierId, 10))
  }
  if (status && isNonEmptyString(status)) {
    conditions.push('status = ?')
    params.push(status)
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }
  query += ' ORDER BY created_at DESC'

  const orders = db.prepare(query).all(...params)
  return NextResponse.json(orders)
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const body = await req.json()
  const { supplier_id, product_id, quantity, order_date, expected_arrival, notes } = body

  if (!isPositiveInt(supplier_id) || !isPositiveInt(product_id) || !isPositiveInt(quantity)) {
    return NextResponse.json({ error: 'supplier_id, product_id en quantity (positieve gehele getallen) zijn verplicht' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]

  const db = getDb()
  const result = db.prepare(
    'INSERT INTO purchase_orders (supplier_id, product_id, quantity, order_date, expected_arrival, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    supplier_id,
    product_id,
    quantity,
    isDateString(order_date) ? order_date : today,
    isDateString(expected_arrival) ? expected_arrival : null,
    isStringOrNull(notes) ? (notes || null) : null,
  )

  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const body = await req.json()
  const { id, supplier_id, product_id, quantity, order_date, expected_arrival, status, notes } = body

  if (!isPositiveInt(id)) {
    return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
  }

  const db = getDb()
  const result = db.prepare(
    'UPDATE purchase_orders SET supplier_id = ?, product_id = ?, quantity = ?, order_date = ?, expected_arrival = ?, status = ?, notes = ? WHERE id = ?'
  ).run(
    isPositiveInt(supplier_id) ? supplier_id : null,
    isPositiveInt(product_id) ? product_id : null,
    isPositiveInt(quantity) ? quantity : 0,
    isDateString(order_date) ? order_date : null,
    isDateString(expected_arrival) ? expected_arrival : null,
    isNonEmptyString(status) ? String(status).slice(0, 50) : 'ordered',
    isStringOrNull(notes) ? (notes || null) : null,
    id,
  )

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Bestelling niet gevonden' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const { id } = await req.json()

  if (!isPositiveInt(id)) {
    return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
  }

  const db = getDb()
  const result = db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(id)

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Bestelling niet gevonden' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
