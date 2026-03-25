export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { scheduleDailySync } = await import('@/lib/scheduler')
    scheduleDailySync()
  }
}
