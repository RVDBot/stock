import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { isPositiveInt } from '@/lib/validate'
import { listOrders, createOrder, updateOrder, setOrderStatus, deleteOrder, validateOrderInput, isOrderStatus } from '@/lib/orders'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const supplierId = parseInt(req.nextUrl.searchParams.get('supplier_id') || '', 10)
  if (!isPositiveInt(supplierId)) {
    return NextResponse.json({ error: 'supplier_id is verplicht' }, { status: 400 })
  }
  const filter = req.nextUrl.searchParams.get('status') === 'open' ? 'open' : 'all'
  return NextResponse.json(listOrders(getDb(), supplierId, filter))
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const parsed = validateOrderInput(await req.json())
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const id = createOrder(getDb(), parsed.value)
    return NextResponse.json({ id }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Opslaan mislukt: onbekend product of leverancier' }, { status: 400 })
  }
}

export async function PUT(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const body = await req.json()
  if (!isPositiveInt(body?.id)) {
    return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
  }
  const db = getDb()

  // Status-only update from the history list
  if (body.lines === undefined) {
    if (!isOrderStatus(body.status)) return NextResponse.json({ error: 'Ongeldige status' }, { status: 400 })
    return setOrderStatus(db, body.id, body.status)
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: 'Bestelling niet gevonden' }, { status: 404 })
  }

  const parsed = validateOrderInput(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    return updateOrder(db, body.id, parsed.value)
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: 'Bestelling niet gevonden' }, { status: 404 })
  } catch {
    return NextResponse.json({ error: 'Opslaan mislukt: onbekend product of leverancier' }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const { id } = await req.json()
  if (!isPositiveInt(id)) {
    return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
  }
  return deleteOrder(getDb(), id)
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: 'Bestelling niet gevonden' }, { status: 404 })
}
