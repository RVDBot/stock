import { getDb } from '@/lib/db'
import { log } from '@/lib/logger'

interface WooProduct {
  id: number
  name: string
  sku: string
  stock_quantity: number | null
  price: string
  status: string
}

interface WooOrder {
  id: number
  date_created: string
  line_items: {
    product_id: number
    sku: string
    quantity: number
  }[]
}

export function getWooCredentials(): { url: string; key: string; secret: string } {
  const db = getDb()
  const get = (k: string) =>
    (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value || ''
  const url = get('woo_url')
  const key = get('woo_consumer_key')
  const secret = get('woo_consumer_secret')
  if (!url || !key || !secret) throw new Error('WooCommerce credentials niet geconfigureerd')
  return { url, key, secret }
}

async function wooFetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T[]> {
  const { url, key, secret } = getWooCredentials()
  const allResults: T[] = []
  let page = 1
  const perPage = 100

  while (true) {
    const searchParams = new URLSearchParams({ per_page: String(perPage), page: String(page), ...params })
    const res = await fetch(
      `${url}/wp-json/wc/v3/${endpoint}?${searchParams}`,
      {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64'),
        },
      }
    )
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`WooCommerce API fout (${res.status}): ${err}`)
    }
    const data = await res.json() as T[]
    allResults.push(...data)
    if (data.length < perPage) break
    page++
    await new Promise(r => setTimeout(r, 200))
  }

  return allResults
}

export async function fetchAllProducts(): Promise<WooProduct[]> {
  log('info', 'WooCommerce: producten ophalen...')
  const products = await wooFetch<WooProduct>('products', { status: 'publish' })
  log('info', `WooCommerce: ${products.length} producten opgehaald`)
  return products
}

export async function fetchOrders(afterDate?: string): Promise<WooOrder[]> {
  const params: Record<string, string> = { status: 'completed,processing' }
  if (afterDate) params.after = afterDate
  log('info', `WooCommerce: orders ophalen${afterDate ? ` na ${afterDate}` : ''}...`)
  const orders = await wooFetch<WooOrder>('orders', params)
  log('info', `WooCommerce: ${orders.length} orders opgehaald`)
  return orders
}

export function splitCompositeSku(sku: string): string[] {
  if (!sku.includes('+')) return [sku]
  return sku.split('+').map(s => s.trim()).filter(Boolean)
}
