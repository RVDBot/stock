import { getDb } from '@/lib/db'

interface Event {
  expected_date: string | null
  duration_days: number
  impact_percentage: number
}

interface ProductForOrder {
  productId: number
  sku: string
  name: string
  currentStock: number
  dailySales: number
  requiredStock: number
  toOrder: number
}

export function calculateOrderList(supplierId: number): {
  coverageDays: number
  products: ProductForOrder[]
} {
  const db = getDb()

  const supplier = db.prepare('SELECT lead_time_days, order_cycle_days FROM suppliers WHERE id = ?').get(supplierId) as {
    lead_time_days: number
    order_cycle_days: number
  } | undefined

  if (!supplier) return { coverageDays: 0, products: [] }

  const settings = db.prepare("SELECT key, value FROM settings WHERE key IN ('warehouse_inbound_days', 'safety_margin_days')").all() as { key: string; value: string }[]
  const settingsMap = Object.fromEntries(settings.map(s => [s.key, s.value]))
  const warehouseInbound = parseInt(settingsMap.warehouse_inbound_days || '14', 10)
  const safetyMargin = parseInt(settingsMap.safety_margin_days || '7', 10)

  const coverageDays = supplier.lead_time_days + warehouseInbound + safetyMargin + supplier.order_cycle_days

  // Get all active events
  const events = db.prepare('SELECT expected_date, duration_days, impact_percentage FROM events WHERE expected_date IS NOT NULL').all() as Event[]

  // Get products for this supplier
  const products = db.prepare(`
    SELECT id, sku, name, current_stock, manual_daily_sales
    FROM products
    WHERE supplier_id = ? AND active = 1
  `).all() as { id: number; sku: string; name: string; current_stock: number; manual_daily_sales: number | null }[]

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const result: ProductForOrder[] = []

  for (const product of products) {
    // Calculate average daily sales from sales_history
    const salesData = db.prepare(`
      SELECT SUM(quantity) as total, COUNT(DISTINCT date) as days
      FROM sales_history
      WHERE product_id = ? AND date >= date('now', '-90 days')
    `).get(product.id) as { total: number | null; days: number }

    const dailySales = product.manual_daily_sales
      ?? (salesData.days > 0 ? (salesData.total || 0) / 90 : 0)

    if (dailySales <= 0) {
      result.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        currentStock: product.current_stock,
        dailySales: 0,
        requiredStock: 0,
        toOrder: 0,
      })
      continue
    }

    // Calculate required stock day-by-day, accounting for events
    let requiredStock = 0
    for (let d = 0; d < coverageDays; d++) {
      const date = new Date(today)
      date.setDate(date.getDate() + d)

      let eventMultiplier = 1
      for (const event of events) {
        if (!event.expected_date) continue
        const eventStart = new Date(event.expected_date)
        eventStart.setHours(0, 0, 0, 0)
        const eventEnd = new Date(eventStart)
        eventEnd.setDate(eventEnd.getDate() + event.duration_days)

        if (date >= eventStart && date < eventEnd) {
          eventMultiplier += event.impact_percentage / 100
        }
      }

      requiredStock += dailySales * eventMultiplier
    }

    requiredStock = Math.ceil(requiredStock)
    const toOrder = Math.max(0, requiredStock - product.current_stock)

    result.push({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      currentStock: product.current_stock,
      dailySales: Math.round(dailySales * 10) / 10,
      requiredStock,
      toOrder,
    })
  }

  // Sort: highest toOrder first
  result.sort((a, b) => b.toOrder - a.toOrder)

  return { coverageDays, products: result }
}
