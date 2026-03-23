import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { calculateOrderList } from '@/lib/order-calculator'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const supplierId = req.nextUrl.searchParams.get('supplier_id')
  if (!supplierId) {
    return NextResponse.json({ error: 'supplier_id is verplicht' }, { status: 400 })
  }

  const result = calculateOrderList(parseInt(supplierId, 10))
  return NextResponse.json(result)
}
