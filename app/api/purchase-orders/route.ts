import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'

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
  if (status) {
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

  const { supplier_id, product_id, quantity, order_date, expected_arrival, notes } = await req.json()

  if (!supplier_id || !product_id || !quantity) {
    return NextResponse.json({ error: 'supplier_id, product_id en quantity zijn verplicht' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]

  const db = getDb()
  const result = db.prepare(
    'INSERT INTO purchase_orders (supplier_id, product_id, quantity, order_date, expected_arrival, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(supplier_id, product_id, quantity, order_date || today, expected_arrival || null, notes || null)

  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const { id, supplier_id, product_id, quantity, order_date, expected_arrival, status, notes } = await req.json()

  if (!id) {
    return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
  }

  const db = getDb()
  const result = db.prepare(
    'UPDATE purchase_orders SET supplier_id = ?, product_id = ?, quantity = ?, order_date = ?, expected_arrival = ?, status = ?, notes = ? WHERE id = ?'
  ).run(supplier_id, product_id, quantity, order_date, expected_arrival || null, status, notes || null, id)

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Bestelling niet gevonden' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const { id } = await req.json()

  if (!id) {
    return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
  }

  const db = getDb()
  const result = db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(id)

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Bestelling niet gevonden' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
