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

  const avgWeekly = weeks.reduce((s, w) => s + w.total_sales, 0) / weeks.length

  // Find peaks (>2x average) grouped by year
  const peaksByYear: Record<string, { weekStart: string; weekEnd: string; weekNum: number; totalSales: number; avgWeeklySales: number; ratio: number }[]> = {}

  for (const w of weeks) {
    if (w.total_sales > avgWeekly * 2) {
      if (!peaksByYear[w.year]) peaksByYear[w.year] = []
      peaksByYear[w.year].push({
        weekStart: w.week_start,
        weekEnd: w.week_end,
        weekNum: parseInt(w.week_num),
        totalSales: w.total_sales,
        avgWeeklySales: Math.round(avgWeekly),
        ratio: Math.round((w.total_sales / avgWeekly) * 10) / 10,
      })
    }
  }

  // Sort peaks within each year by ratio descending
  for (const year of Object.keys(peaksByYear)) {
    peaksByYear[year].sort((a, b) => b.ratio - a.ratio)
  }

  return NextResponse.json({ peaks: peaksByYear })
}
