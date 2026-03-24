import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { getAllProductStatuses, getProductStatusesBySupplier } from '@/lib/stock-status'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const productId = req.nextUrl.searchParams.get('id')
  const supplierId = req.nextUrl.searchParams.get('supplier_id')
  const inactive = req.nextUrl.searchParams.get('inactive')

  // Return single product with specs
  if (productId) {
    const db = getDb()
    const product = db.prepare(`
      SELECT p.*, s.name as supplier_name, s.lead_time_days,
             st.name as template_name, st.fields as template_fields
      FROM products p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN spec_templates st ON p.spec_template_id = st.id
      WHERE p.id = ?
    `).get(parseInt(productId, 10))
    if (!product) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })
    return NextResponse.json(product)
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
    if (body.ids.length === 0) {
      return NextResponse.json({ error: 'Geen producten geselecteerd' }, { status: 400 })
    }

    // Bulk set active/inactive
    if (body.active !== undefined) {
      const stmt = db.prepare('UPDATE products SET active = ? WHERE id = ?')
      const tx = db.transaction((ids: number[]) => {
        for (const id of ids) stmt.run(body.active, id)
      })
      tx(body.ids)
      return NextResponse.json({ success: true, updated: body.ids.length })
    }

    // Bulk apply specs: { ids, bulk_specs: { spec_template_id, specs, overrides: { [productId]: { field: value } } } }
    if (body.bulk_specs) {
      const { spec_template_id, specs, overrides } = body.bulk_specs as {
        spec_template_id: number
        specs: Record<string, string>
        overrides: Record<string, Record<string, string>>
      }
      const stmt = db.prepare('UPDATE products SET spec_template_id = ?, specs = ? WHERE id = ?')
      const tx = db.transaction((ids: number[]) => {
        for (const id of ids) {
          const productOverrides = overrides?.[String(id)] || {}
          const mergedSpecs = { ...specs, ...productOverrides }
          stmt.run(spec_template_id, JSON.stringify(mergedSpecs), id)
        }
      })
      tx(body.ids)
      return NextResponse.json({ success: true, updated: body.ids.length })
    }

    // Bulk assign supplier
    const stmt = db.prepare('UPDATE products SET supplier_id = ? WHERE id = ?')
    const tx = db.transaction((ids: number[]) => {
      for (const id of ids) stmt.run(body.supplier_id, id)
    })
    tx(body.ids)
    return NextResponse.json({ success: true, updated: body.ids.length })
  }

  // Single product update: { id, supplier_id?, spec_template_id?, specs? }
  if (!body.id) {
    return NextResponse.json({ error: 'Product id is verplicht' }, { status: 400 })
  }

  if (body.specs !== undefined || body.spec_template_id !== undefined) {
    const updates: string[] = []
    const params: (string | number | null)[] = []

    if (body.spec_template_id !== undefined) {
      updates.push('spec_template_id = ?')
      params.push(body.spec_template_id)
    }
    if (body.specs !== undefined) {
      updates.push('specs = ?')
      params.push(JSON.stringify(body.specs))
    }
    if (body.supplier_id !== undefined) {
      updates.push('supplier_id = ?')
      params.push(body.supplier_id)
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
