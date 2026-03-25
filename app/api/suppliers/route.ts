import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { isPositiveInt, isNonEmptyString, isStringOrNull } from '@/lib/validate'

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

  if (!isNonEmptyString(name) || !isPositiveInt(lead_time_days)) {
    return NextResponse.json({ error: 'name (string) en lead_time_days (positief geheel getal) zijn verplicht' }, { status: 400 })
  }

  const db = getDb()
  const result = db.prepare(
    'INSERT INTO suppliers (name, lead_time_days, order_cycle_days, inspection, contact_name, contact_email, phone, preferred_contact, contact_info, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    String(name).slice(0, 200),
    lead_time_days,
    isPositiveInt(order_cycle_days) ? order_cycle_days : 30,
    ['never', 'always', 'random'].includes(inspection) ? inspection : 'never',
    isStringOrNull(contact_name) ? (contact_name || null) : null,
    isStringOrNull(contact_email) ? (contact_email || null) : null,
    isStringOrNull(phone) ? (phone || null) : null,
    ['email', 'whatsapp'].includes(preferred_contact) ? preferred_contact : 'email',
    isStringOrNull(contact_info) ? (contact_info || null) : null,
    isStringOrNull(notes) ? (notes || null) : null,
  )

  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const body = await req.json()
  const { id, name, lead_time_days, order_cycle_days, inspection, contact_name, contact_email, phone, preferred_contact, contact_info, notes } = body

  if (!isPositiveInt(id)) {
    return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
  }

  const db = getDb()
  const result = db.prepare(
    'UPDATE suppliers SET name = ?, lead_time_days = ?, order_cycle_days = ?, inspection = ?, contact_name = ?, contact_email = ?, phone = ?, preferred_contact = ?, contact_info = ?, notes = ? WHERE id = ?'
  ).run(
    String(name).slice(0, 200),
    isPositiveInt(lead_time_days) ? lead_time_days : 1,
    isPositiveInt(order_cycle_days) ? order_cycle_days : 30,
    ['never', 'always', 'random'].includes(inspection) ? inspection : 'never',
    isStringOrNull(contact_name) ? (contact_name || null) : null,
    isStringOrNull(contact_email) ? (contact_email || null) : null,
    isStringOrNull(phone) ? (phone || null) : null,
    ['email', 'whatsapp'].includes(preferred_contact) ? preferred_contact : 'email',
    isStringOrNull(contact_info) ? (contact_info || null) : null,
    isStringOrNull(notes) ? (notes || null) : null,
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

  if (!isPositiveInt(id)) {
    return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
  }

  const db = getDb()
  const result = db.prepare('DELETE FROM suppliers WHERE id = ?').run(id)

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Supplier niet gevonden' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
