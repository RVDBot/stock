import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { runDailySync, importHistoricalOrders, analyzeHistoricalPeaks } from '@/lib/sync'
import { log } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  const { action } = await req.json()

  if (action === 'daily') {
    try {
      await runDailySync()
      return NextResponse.json({ success: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const stack = e instanceof Error ? e.stack : undefined
      log('error', `Dagelijkse sync mislukt: ${msg}`, stack)
      return NextResponse.json({ success: false, error: msg }, { status: 500 })
    }
  }

  if (action === 'historical') {
    try {
      const count = await importHistoricalOrders()
      const peaks = analyzeHistoricalPeaks()
      return NextResponse.json({ success: true, ordersProcessed: count, peaks })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const stack = e instanceof Error ? e.stack : undefined
      log('error', `Historische import mislukt: ${msg}`, stack)
      return NextResponse.json({ success: false, error: msg }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
}
