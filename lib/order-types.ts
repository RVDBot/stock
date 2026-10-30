// Shared order types — safe to import from client components

export type OrderStatus = 'ordered' | 'shipped' | 'received'
export const ORDER_STATUSES: OrderStatus[] = ['ordered', 'shipped', 'received']
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  ordered: 'Besteld',
  shipped: 'Verzonden',
  received: 'Ontvangen',
}

export type MatchKind = 'memory' | 'confident' | 'uncertain' | 'none'

export interface OrderLine {
  id: number
  product_id: number | null // null = nog niet toegewezen (product bestaat nog niet in WooCommerce)
  sku: string | null
  name: string | null
  quantity: number
  supplier_code: string | null
  supplier_description: string | null
}

export interface Order {
  id: number
  supplier_id: number
  order_date: string
  supplier_ref: string | null
  expected_arrival: string | null
  status: OrderStatus
  notes: string | null
  created_at: string
  lines: OrderLine[]
}

export interface OrderLineInput {
  product_id: number | null
  quantity: number
  supplier_code?: string | null
  supplier_description?: string | null
  remember?: boolean
}

export interface OrderInput {
  supplier_id: number
  order_date: string
  supplier_ref?: string | null
  expected_arrival?: string | null
  notes?: string | null
  lines: OrderLineInput[]
}

export interface ImportedLine {
  supplier_code: string | null
  supplier_description: string
  quantity: number
  product_id: number | null
  match: MatchKind
}

export interface ImportResult {
  order_date: string | null
  supplier_ref: string | null
  lines: ImportedLine[]
  truncated: boolean
}

export interface FulfilmentMailLine {
  sku: string | null
  name: string
  variant: string | null
  barcode: string | null
  hs_code: string | null
  country_of_origin: string | null
  quantity: number
  is_new: boolean
}

export interface FulfilmentMail {
  subject: string
  html: string
  text: string
  missing_barcodes: string[]
}
