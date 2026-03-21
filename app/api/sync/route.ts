import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { runDailySync, importHistoricalOrders, analyzeHistoricalPeaks } from '@/lib/sync'

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  const { action } = await req.json()

  if (action === 'daily') {
    await runDailySync()
    return NextResponse.json({ ok: true })
  }

  if (action === 'historical') {
    const count = await importHistoricalOrders()
    const peaks = analyzeHistoricalPeaks()
    return NextResponse.json({ ok: true, ordersProcessed: count, peaks })
  }

  return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
}
