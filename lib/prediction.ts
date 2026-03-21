import { getDb } from '@/lib/db'

/**
 * Weighted moving average over 12 weeks.
 * Week 1 (most recent) = weight 12, week 12 = weight 1.
 * All 12 weeks count — a zero-sale week is real data that pulls the average down.
 * If manual_daily_sales is set on the product, returns that instead.
 */
export function getWeightedDailySales(productId: number): number {
  const db = getDb()

  const product = db.prepare('SELECT manual_daily_sales FROM products WHERE id = ?')
    .get(productId) as { manual_daily_sales: number | null } | undefined
  if (product?.manual_daily_sales !== null && product?.manual_daily_sales !== undefined) {
    return product.manual_daily_sales
  }

  const now = new Date()
  const twelveWeeksAgo = new Date(now.getTime() - 12 * 7 * 86400000)

  const rows = db.prepare(`
    SELECT date, quantity FROM sales_history
    WHERE product_id = ? AND date >= ?
    ORDER BY date DESC
  `).all(productId, twelveWeeksAgo.toISOString().slice(0, 10)) as { date: string; quantity: number }[]

  if (rows.length === 0) return 0

  const weeklyTotals = new Array(12).fill(0)
  const weekWeights = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]

  for (const row of rows) {
    const dayDate = new Date(row.date)
    const daysAgo = Math.floor((now.getTime() - dayDate.getTime()) / 86400000)
    const weekIndex = Math.floor(daysAgo / 7)
    if (weekIndex < 12) {
      weeklyTotals[weekIndex] += row.quantity
    }
  }

  let weightedSum = 0
  let totalWeight = 0
  for (let i = 0; i < 12; i++) {
    weightedSum += (weeklyTotals[i] / 7) * weekWeights[i]
    totalWeight += weekWeights[i]
  }

  if (totalWeight === 0) return 0
  return weightedSum / totalWeight
}

/**
 * Get number of weeks of sales data available for a product.
 */
export function getDataWeeks(productId: number): number {
  const db = getDb()
  const result = db.prepare(`
    SELECT MIN(date) as first_date FROM sales_history WHERE product_id = ? AND quantity > 0
  `).get(productId) as { first_date: string | null } | undefined

  if (!result?.first_date) return 0
  const firstDate = new Date(result.first_date)
  const now = new Date()
  return Math.floor((now.getTime() - firstDate.getTime()) / (7 * 86400000))
}

/**
 * Interface for future ML model replacement.
 * Accepts SKU so a future ML model can be a drop-in replacement.
 * If two events overlap, the highest impact multiplier is used (not additive).
 */
export function getExpectedDailySales(sku: string, startDate: Date, endDate: Date): number[] {
  const db = getDb()
  const product = db.prepare('SELECT id FROM products WHERE sku = ?').get(sku) as { id: number } | undefined
  if (!product) return []

  const baseDailySales = getWeightedDailySales(product.id)

  const events = db.prepare(`
    SELECT expected_date, duration_days, impact_percentage FROM events
    WHERE expected_date IS NOT NULL
  `).all() as { expected_date: string; duration_days: number; impact_percentage: number }[]

  const days: number[] = []
  const current = new Date(startDate)

  while (current <= endDate) {
    let multiplier = 1

    for (const event of events) {
      const eventStart = new Date(event.expected_date)
      const eventEnd = new Date(eventStart.getTime() + event.duration_days * 86400000)
      if (current >= eventStart && current < eventEnd) {
        multiplier = Math.max(multiplier, (100 + event.impact_percentage) / 100)
      }
    }

    days.push(baseDailySales * multiplier)
    current.setDate(current.getDate() + 1)
  }

  return days
}
