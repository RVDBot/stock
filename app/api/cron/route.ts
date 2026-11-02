import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runDailySync, SyncBusyError } from '@/lib/sync'

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected || expected.length < 16) {
    return NextResponse.json({ error: 'CRON_SECRET not configured or too short (min 16 chars)' }, { status: 500 })
  }
  const secret = req.headers.get('x-cron-secret') || ''
  const match = secret.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected))
  if (!match) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    await runDailySync('automated')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: e instanceof SyncBusyError ? 409 : 500 })
  }
  return NextResponse.json({ ok: true })
}
