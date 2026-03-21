import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const db = getDb()
  const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY name').all()
  return NextResponse.json(suppliers)
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const { name, lead_time_days, contact_info, notes } = await req.json()

  if (!name || lead_time_days == null) {
    return NextResponse.json({ error: 'name en lead_time_days zijn verplicht' }, { status: 400 })
  }

  const db = getDb()
  const result = db.prepare(
    'INSERT INTO suppliers (name, lead_time_days, contact_info, notes) VALUES (?, ?, ?, ?)'
  ).run(name, lead_time_days, contact_info || null, notes || null)

  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const { id, name, lead_time_days, contact_info, notes } = await req.json()

  if (!id) {
    return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
  }

  const db = getDb()
  const result = db.prepare(
    'UPDATE suppliers SET name = ?, lead_time_days = ?, contact_info = ?, notes = ? WHERE id = ?'
  ).run(name, lead_time_days, contact_info || null, notes || null, id)

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
