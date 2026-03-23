import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const id = req.nextUrl.searchParams.get('id')
  const db = getDb()

  if (id) {
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(parseInt(id, 10))
    if (!supplier) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })
    return NextResponse.json(supplier)
  }

  const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY name').all()
  return NextResponse.json(suppliers)
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const body = await req.json()
  const { name, lead_time_days, order_cycle_days, inspection, contact_name, contact_email, phone, preferred_contact, contact_info, notes } = body

  if (!name || lead_time_days == null) {
    return NextResponse.json({ error: 'name en lead_time_days zijn verplicht' }, { status: 400 })
  }

  const db = getDb()
  const result = db.prepare(
    'INSERT INTO suppliers (name, lead_time_days, order_cycle_days, inspection, contact_name, contact_email, phone, preferred_contact, contact_info, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    name,
    lead_time_days,
    order_cycle_days ?? 30,
    inspection || 'never',
    contact_name || null,
    contact_email || null,
    phone || null,
    preferred_contact || 'email',
    contact_info || null,
    notes || null,
  )

  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const body = await req.json()
  const { id, name, lead_time_days, order_cycle_days, inspection, contact_name, contact_email, phone, preferred_contact, contact_info, notes } = body

  if (!id) {
    return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
  }

  const db = getDb()
  const result = db.prepare(
    'UPDATE suppliers SET name = ?, lead_time_days = ?, order_cycle_days = ?, inspection = ?, contact_name = ?, contact_email = ?, phone = ?, preferred_contact = ?, contact_info = ?, notes = ? WHERE id = ?'
  ).run(
    name,
    lead_time_days,
    order_cycle_days ?? 30,
    inspection || 'never',
    contact_name || null,
    contact_email || null,
    phone || null,
    preferred_contact || 'email',
    contact_info || null,
    notes || null,
    id,
  )

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Supplier niet gevonden' }, { status: 404 })
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
  const result = db.prepare('DELETE FROM suppliers WHERE id = ?').run(id)

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Supplier niet gevonden' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
