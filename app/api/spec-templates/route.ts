import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { isNonEmptyString, isPositiveInt } from '@/lib/validate'

const FIELD_TYPES = ['text', 'number', 'select', 'fixed', 'price']

function isTemplateFields(v: unknown): boolean {
  return Array.isArray(v) && v.length <= 100 && v.every(f =>
    f && typeof f === 'object' && isNonEmptyString(f.name) && FIELD_TYPES.includes(f.type))
}

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const supplierId = req.nextUrl.searchParams.get('supplier_id')
  const db = getDb()

  if (supplierId) {
    const templates = db.prepare('SELECT * FROM spec_templates WHERE supplier_id = ? ORDER BY name').all(parseInt(supplierId, 10))
    return NextResponse.json(templates)
  }

  const templates = db.prepare('SELECT * FROM spec_templates ORDER BY name').all()
  return NextResponse.json(templates)
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const { supplier_id, name, fields = [] } = await req.json()
  if (!isPositiveInt(supplier_id) || !isNonEmptyString(name)) {
    return NextResponse.json({ error: 'supplier_id en name zijn verplicht' }, { status: 400 })
  }
  if (!isTemplateFields(fields)) {
    return NextResponse.json({ error: 'Ongeldige velden' }, { status: 400 })
  }

  const db = getDb()
  if (!db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(supplier_id)) {
    return NextResponse.json({ error: 'Fabrikant niet gevonden' }, { status: 400 })
  }
  const result = db.prepare(
    'INSERT INTO spec_templates (supplier_id, name, fields) VALUES (?, ?, ?)'
  ).run(supplier_id, name.slice(0, 200), JSON.stringify(fields))

  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const { id, name, fields = [] } = await req.json()
  if (!isPositiveInt(id)) {
    return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
  }
  if (!isNonEmptyString(name) || !isTemplateFields(fields)) {
    return NextResponse.json({ error: 'Naam en geldige velden zijn verplicht' }, { status: 400 })
  }

  const db = getDb()
  const result = db.prepare(
    'UPDATE spec_templates SET name = ?, fields = ? WHERE id = ?'
  ).run(name.slice(0, 200), JSON.stringify(fields), id)

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Template niet gevonden' }, { status: 404 })
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
  // Unlink products using this template
  db.prepare('UPDATE products SET spec_template_id = NULL WHERE spec_template_id = ?').run(id)
  const result = db.prepare('DELETE FROM spec_templates WHERE id = ?').run(id)

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Template niet gevonden' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
