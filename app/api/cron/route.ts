import { NextRequest, NextResponse } from 'next/server'
import { runDailySync } from '@/lib/sync'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  await runDailySync('automated')
  return NextResponse.json({ ok: true })
}
