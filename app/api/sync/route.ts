import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { runDailySync, runHistoricalImport, SyncBusyError } from '@/lib/sync'
import { log } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  const { action } = await req.json()

  if (action !== 'daily' && action !== 'historical') {
    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  }

  try {
    if (action === 'daily') {
      await runDailySync('manual')
      return NextResponse.json({ success: true })
    }
    const { ordersProcessed, peaks } = await runHistoricalImport()
    return NextResponse.json({ success: true, ordersProcessed, peaks })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof SyncBusyError) return NextResponse.json({ success: false, error: msg }, { status: 409 })
    const stack = e instanceof Error ? e.stack : undefined
    log('error', `${action === 'daily' ? 'Dagelijkse sync' : 'Historische import'} mislukt: ${msg}`, stack)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
