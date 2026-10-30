import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { isPositiveInt } from '@/lib/validate'
import { buildFulfilmentMail } from '@/lib/fulfilment-mail'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const id = parseInt(req.nextUrl.searchParams.get('id') || '', 10)
  if (!isPositiveInt(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
  const mail = buildFulfilmentMail(getDb(), id)
  if (!mail) return NextResponse.json({ error: 'Bestelling niet gevonden' }, { status: 404 })
  return NextResponse.json(mail)
}
