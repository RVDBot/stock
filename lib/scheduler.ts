import { log } from '@/lib/logger'

const SYNC_HOUR = 5 // 05:00 lokale servertijd

let scheduled = false

export function scheduleDailySync() {
  if (scheduled) return
  scheduled = true

  function msUntilNext(hour: number): number {
    const now = new Date()
    const next = new Date(now)
    next.setHours(hour, 0, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    return next.getTime() - now.getTime()
  }

  async function run() {
    try {
      const { runDailySync } = await import('@/lib/sync')
      log('info', 'Automatische dagelijkse sync gestart')
      await runDailySync('automated')
      log('info', 'Automatische dagelijkse sync voltooid')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log('error', `Automatische sync mislukt: ${msg}`)
    }
    // Schedule next run
    setTimeout(run, msUntilNext(SYNC_HOUR))
  }

  const ms = msUntilNext(SYNC_HOUR)
  const hours = Math.round(ms / 3_600_000 * 10) / 10
  log('info', `Dagelijkse sync gepland om ${SYNC_HOUR}:00 (over ${hours} uur)`)
  setTimeout(run, ms)
}
