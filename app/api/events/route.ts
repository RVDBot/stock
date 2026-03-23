import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const db = getDb()
  const events = db.prepare('SELECT * FROM events ORDER BY expected_date').all()
  return NextResponse.json(events)
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const { parent_id, name, expected_date, duration_days, impact_percentage, recurring, ai_lookup, ai_skip_months, notes } = await req.json()

  if (!name) {
    return NextResponse.json({ error: 'name is verplicht' }, { status: 400 })
  }

  const db = getDb()

  // Verify parent exists if specified
  if (parent_id) {
    const parent = db.prepare('SELECT id FROM events WHERE id = ? AND parent_id IS NULL').get(parent_id)
    if (!parent) {
      return NextResponse.json({ error: 'Hoofd-event niet gevonden' }, { status: 400 })
    }
  }

  const result = db.prepare(
    'INSERT INTO events (parent_id, name, expected_date, duration_days, impact_percentage, recurring, ai_lookup, ai_skip_months, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    parent_id || null,
    name,
    expected_date || null,
    duration_days ?? 7,
    impact_percentage ?? 100,
    recurring ?? 1,
    ai_lookup ?? 1,
    ai_skip_months ?? 6,
    notes || null
  )

  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const { id, parent_id, name, expected_date, duration_days, impact_percentage, recurring, ai_lookup, ai_skip_months, notes } = await req.json()

  if (!id) {
    return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
  }

  const db = getDb()
  const result = db.prepare(
    'UPDATE events SET parent_id = ?, name = ?, expected_date = ?, duration_days = ?, impact_percentage = ?, recurring = ?, ai_lookup = ?, ai_skip_months = ?, notes = ? WHERE id = ?'
  ).run(parent_id || null, name, expected_date || null, duration_days, impact_percentage, recurring, ai_lookup ?? 1, ai_skip_months ?? 6, notes || null, id)

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Event niet gevonden' }, { status: 404 })
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
  const result = db.prepare('DELETE FROM events WHERE id = ?').run(id)

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Event niet gevonden' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
