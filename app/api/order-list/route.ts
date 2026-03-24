import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { calculateOrderList } from '@/lib/order-calculator'
import { log } from '@/lib/logger'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const supplierId = req.nextUrl.searchParams.get('supplier_id')
  if (!supplierId) {
    return NextResponse.json({ error: 'supplier_id is verplicht' }, { status: 400 })
  }

  try {
    log('info', `Order list API aangeroepen voor fabrikant ${supplierId}`)
    const result = calculateOrderList(parseInt(supplierId, 10))
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('error', `Order list berekening mislukt: ${msg}`)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
