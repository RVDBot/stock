import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { getAllProductStatuses, getProductStatusesBySupplier } from '@/lib/stock-status'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const supplierId = req.nextUrl.searchParams.get('supplier_id')

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

  // Bulk assign: { ids: [1, 2, 3], supplier_id: 5 }
  if (Array.isArray(body.ids)) {
    if (body.ids.length === 0) {
      return NextResponse.json({ error: 'Geen producten geselecteerd' }, { status: 400 })
    }
    const stmt = db.prepare('UPDATE products SET supplier_id = ? WHERE id = ?')
    const tx = db.transaction((ids: number[]) => {
      for (const id of ids) stmt.run(body.supplier_id, id)
    })
    tx(body.ids)
    return NextResponse.json({ success: true, updated: body.ids.length })
  }

  // Single assign: { id: 1, supplier_id: 5 }
  if (!body.id) {
    return NextResponse.json({ error: 'Product id is verplicht' }, { status: 400 })
  }

  const result = db.prepare('UPDATE products SET supplier_id = ? WHERE id = ?').run(body.supplier_id, body.id)

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Product niet gevonden' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
