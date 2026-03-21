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

  const { id, supplier_id } = await req.json()

  if (!id) {
    return NextResponse.json({ error: 'Product id is verplicht' }, { status: 400 })
  }

  const db = getDb()
  const result = db.prepare('UPDATE products SET supplier_id = ? WHERE id = ?').run(supplier_id, id)

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Product niet gevonden' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
