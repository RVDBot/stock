import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { getAllProductStatuses, getProductStatusesBySupplier } from '@/lib/stock-status'
import { isPositiveInt, isIntArray, isInt } from '@/lib/validate'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const productId = req.nextUrl.searchParams.get('id')
  const supplierId = req.nextUrl.searchParams.get('supplier_id')
  const inactive = req.nextUrl.searchParams.get('inactive')

  // Return single product with specs
  if (productId) {
    const parsed = parseInt(productId, 10)
    if (!isPositiveInt(parsed)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const db = getDb()
    const product = db.prepare(`
      SELECT p.*, s.name as supplier_name, s.lead_time_days,
             st.name as template_name, st.fields as template_fields
      FROM products p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN spec_templates st ON p.spec_template_id = st.id
      WHERE p.id = ?
    `).get(parsed)
    if (!product) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })
    return NextResponse.json(product)
  }

  // Return product IDs that have specs filled in for a supplier
  const withSpecs = req.nextUrl.searchParams.get('with_specs')
  if (withSpecs === '1' && supplierId) {
    const db = getDb()
    const rows = db.prepare(`
      SELECT id as productId, sku, name FROM products
      WHERE supplier_id = ? AND active = 1 AND spec_template_id IS NOT NULL AND specs != '{}'
      ORDER BY name
    `).all(parseInt(supplierId, 10))
    return NextResponse.json(rows)
  }

  // Return inactive (ignored) products
  if (inactive === '1') {
    const db = getDb()
    const products = db.prepare('SELECT id as productId, sku, name, supplier_id as supplierId FROM products WHERE active = 0 ORDER BY name').all()
    return NextResponse.json(products)
  }

  if (supplierId) {
    const statuses = getProductStatusesBySupplier(parseInt(supplierId, 10))
    return NextResponse.json(statuses)
  }

  const statuses = getAllProductStatuses()
  return NextResponse.json(statuses)
}

export async function PATCH(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const body = await req.json()
  const db = getDb()

  // Bulk operations: { ids: [1, 2, 3], supplier_id?: 5, active?: 0 }
  if (Array.isArray(body.ids)) {
    if (!isIntArray(body.ids)) {
      return NextResponse.json({ error: 'ids moet een array van gehele getallen zijn (max 10.000)' }, { status: 400 })
    }

    // Bulk set active/inactive
    if (body.active !== undefined) {
      const active = body.active === 1 ? 1 : 0
      const stmt = db.prepare('UPDATE products SET active = ? WHERE id = ?')
      const tx = db.transaction((ids: number[]) => {
        for (const id of ids) stmt.run(active, id)
      })
      tx(body.ids)
      return NextResponse.json({ success: true, updated: body.ids.length })
    }

    // Bulk apply specs
    if (body.bulk_specs) {
      const { spec_template_id, specs, overrides } = body.bulk_specs
      if (!isPositiveInt(spec_template_id) || typeof specs !== 'object') {
        return NextResponse.json({ error: 'Ongeldige bulk_specs' }, { status: 400 })
      }
      const stmt = db.prepare('UPDATE products SET spec_template_id = ?, specs = ? WHERE id = ?')
      const tx = db.transaction((ids: number[]) => {
        for (const id of ids) {
          const productOverrides = (overrides && typeof overrides === 'object') ? (overrides[String(id)] || {}) : {}
          const mergedSpecs = { ...specs, ...productOverrides }
          stmt.run(spec_template_id, JSON.stringify(mergedSpecs), id)
        }
      })
      tx(body.ids)
      return NextResponse.json({ success: true, updated: body.ids.length })
    }

    // Bulk assign supplier
    if (!isInt(body.supplier_id)) {
      return NextResponse.json({ error: 'supplier_id is verplicht' }, { status: 400 })
    }
    const stmt = db.prepare('UPDATE products SET supplier_id = ? WHERE id = ?')
    const tx = db.transaction((ids: number[]) => {
      for (const id of ids) stmt.run(body.supplier_id, id)
    })
    tx(body.ids)
    return NextResponse.json({ success: true, updated: body.ids.length })
  }

  // Single product update
  if (!isPositiveInt(body.id)) {
    return NextResponse.json({ error: 'Product id is verplicht' }, { status: 400 })
  }

  if (body.specs !== undefined || body.spec_template_id !== undefined) {
    const updates: string[] = []
    const params: (string | number | null)[] = []

    if (body.spec_template_id !== undefined) {
      updates.push('spec_template_id = ?')
      params.push(isInt(body.spec_template_id) ? body.spec_template_id : null)
    }
    if (body.specs !== undefined) {
      updates.push('specs = ?')
      params.push(JSON.stringify(body.specs))
    }
    if (body.supplier_id !== undefined) {
      updates.push('supplier_id = ?')
      params.push(isInt(body.supplier_id) ? body.supplier_id : null)
    }

    params.push(body.id)
    db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    return NextResponse.json({ success: true })
  }

  const result = db.prepare('UPDATE products SET supplier_id = ? WHERE id = ?').run(body.supplier_id, body.id)

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Product niet gevonden' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
