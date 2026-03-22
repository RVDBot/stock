import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const db = getDb()

  // Get weekly sales totals
  const weeks = db.prepare(`
    SELECT strftime('%Y', date) as year,
           strftime('%W', date) as week_num,
           MIN(date) as week_start,
           MAX(date) as week_end,
           SUM(quantity) as total_sales
    FROM sales_history
    GROUP BY year, week_num
    ORDER BY year, week_num
  `).all() as { year: string; week_num: string; week_start: string; week_end: string; total_sales: number }[]

  if (weeks.length === 0) return NextResponse.json({ peaks: {} })

  // Group weeks by year and calculate per-year averages
  const weeksByYear: Record<string, typeof weeks> = {}
  for (const w of weeks) {
    if (!weeksByYear[w.year]) weeksByYear[w.year] = []
    weeksByYear[w.year].push(w)
  }

  // Find peaks (>1.8x the year's average) grouped by year
  const peaksByYear: Record<string, { weekStart: string; weekEnd: string; weekNum: number; totalSales: number; avgWeeklySales: number; ratio: number }[]> = {}

  for (const [year, yearWeeks] of Object.entries(weeksByYear)) {
    const yearAvg = yearWeeks.reduce((s, w) => s + w.total_sales, 0) / yearWeeks.length
    if (yearAvg === 0) continue

    for (const w of yearWeeks) {
      const ratio = w.total_sales / yearAvg
      if (ratio > 1.8) {
        if (!peaksByYear[year]) peaksByYear[year] = []
        peaksByYear[year].push({
          weekStart: w.week_start,
          weekEnd: w.week_end,
          weekNum: parseInt(w.week_num),
          totalSales: w.total_sales,
          avgWeeklySales: Math.round(yearAvg),
          ratio: Math.round(ratio * 10) / 10,
        })
      }
    }
  }

  // Sort peaks within each year by ratio descending
  for (const year of Object.keys(peaksByYear)) {
    peaksByYear[year].sort((a, b) => b.ratio - a.ratio)
  }

  return NextResponse.json({ peaks: peaksByYear })
}
