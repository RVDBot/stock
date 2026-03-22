import { getDb } from '@/lib/db'
import { getExpectedDailySales, getWeightedDailySales, getDataWeeks } from '@/lib/prediction'

export type StockStatus = 'order_now' | 'soon' | 'on_track'

export interface ProductStatus {
  productId: number
  wooProductId: number
  sku: string
  name: string
  currentStock: number
  dailySales: number
  daysUntilEmpty: number
  orderDeadlineDays: number
  status: StockStatus
  supplierId: number | null
  supplierName: string | null
  supplierLeadTime: number | null
  pendingOrderQty: number
  pendingOrderArrival: string | null
  dataWeeks: number
  price: number
}

function getSettingNum(key: string, fallback: string): number {
  const db = getDb()
  const val = (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value
  return parseInt(val || fallback, 10)
}

export function calculateProductStatus(productId: number): ProductStatus | null {
  const db = getDb()

  const product = db.prepare(`
    SELECT p.*, s.name as supplier_name, s.lead_time_days
    FROM products p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE p.id = ? AND p.active = 1
  `).get(productId) as {
    id: number; woo_product_id: number; sku: string; name: string; current_stock: number; price: number;
    supplier_id: number | null; supplier_name: string | null; lead_time_days: number | null
  } | undefined

  if (!product) return null

  const now = new Date()
  const warehouseDays = getSettingNum('warehouse_inbound_days', '14')
  const safetyDays = getSettingNum('safety_margin_days', '7')
  const leadTime = product.lead_time_days || 0
  const orderDeadline = leadTime + warehouseDays

  // Pending purchase orders — each with its own arrival date
  const pendingOrders = db.prepare(`
    SELECT quantity, expected_arrival
    FROM purchase_orders
    WHERE product_id = ? AND status IN ('ordered', 'shipped')
  `).all(productId) as { quantity: number; expected_arrival: string | null }[]

  const totalPendingQty = pendingOrders.reduce((s, o) => s + o.quantity, 0)
  const earliestArrival = pendingOrders
    .filter(o => o.expected_arrival)
    .sort((a, b) => a.expected_arrival!.localeCompare(b.expected_arrival!))[0]?.expected_arrival || null

  // Build map of day -> incoming stock
  const incomingByDay = new Map<number, number>()
  for (const po of pendingOrders) {
    if (po.expected_arrival) {
      const arrivalDay = Math.floor((new Date(po.expected_arrival).getTime() - now.getTime()) / 86400000)
      if (arrivalDay >= 0) {
        incomingByDay.set(arrivalDay, (incomingByDay.get(arrivalDay) || 0) + po.quantity)
      }
    }
  }

  // Day-by-day simulation
  const dailySales = getWeightedDailySales(productId)
  const futureEnd = new Date(now.getTime() + 365 * 86400000)
  const expectedDailySales = getExpectedDailySales(product.sku, now, futureEnd)

  let stock = product.current_stock
  let daysUntilEmpty = 365

  for (let day = 0; day < 365; day++) {
    const incoming = incomingByDay.get(day)
    if (incoming) stock += incoming

    stock -= expectedDailySales[day] || dailySales
    if (stock <= 0) {
      daysUntilEmpty = day
      break
    }
  }

  let status: StockStatus = 'on_track'
  if (daysUntilEmpty < orderDeadline) {
    status = 'order_now'
  } else if (daysUntilEmpty < orderDeadline + safetyDays) {
    status = 'soon'
  }

  return {
    productId: product.id,
    wooProductId: product.woo_product_id,
    sku: product.sku,
    name: product.name,
    currentStock: product.current_stock,
    dailySales: Math.round(dailySales * 100) / 100,
    daysUntilEmpty,
    orderDeadlineDays: orderDeadline,
    status,
    supplierId: product.supplier_id,
    supplierName: product.supplier_name,
    supplierLeadTime: product.lead_time_days,
    pendingOrderQty: totalPendingQty,
    pendingOrderArrival: earliestArrival,
    dataWeeks: getDataWeeks(productId),
    price: product.price,
  }
}

export function getAllProductStatuses(): ProductStatus[] {
  const db = getDb()
  const products = db.prepare('SELECT id FROM products WHERE active = 1').all() as { id: number }[]
  const statuses: ProductStatus[] = []

  for (const p of products) {
    const status = calculateProductStatus(p.id)
    if (status) statuses.push(status)
  }

  const ORDER: Record<StockStatus, number> = { order_now: 0, soon: 1, on_track: 2 }
  statuses.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.daysUntilEmpty - b.daysUntilEmpty)

  return statuses
}

export function getProductStatusesBySupplier(supplierId: number): ProductStatus[] {
  const db = getDb()
  const products = db.prepare('SELECT id FROM products WHERE active = 1 AND supplier_id = ?').all(supplierId) as { id: number }[]
  const statuses: ProductStatus[] = []

  for (const p of products) {
    const status = calculateProductStatus(p.id)
    if (status) statuses.push(status)
  }

  const ORDER: Record<StockStatus, number> = { order_now: 0, soon: 1, on_track: 2 }
  statuses.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.daysUntilEmpty - b.daysUntilEmpty)

  return statuses
}
