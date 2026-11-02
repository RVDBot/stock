import { getDb } from '@/lib/db'
import { log } from '@/lib/logger'
import { decryptValue } from '@/lib/encrypt'

interface WooProduct {
  id: number
  name: string
  sku: string
  stock_quantity: number | null
  manage_stock: boolean
  price: string
  status: string
  type?: string
}

interface WooVariation {
  id: number
  sku: string
  stock_quantity: number | null
  manage_stock: boolean
  price: string
  status: string
  attributes: { name: string; option: string }[]
}

export interface WooOrder {
  id: number
  date_created: string
  date_created_gmt?: string
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
  const secret = decryptValue(get('woo_consumer_secret'))
  if (!url || !key || !secret) throw new Error('WooCommerce credentials niet geconfigureerd')
  return { url, key, secret }
}

const MAX_ATTEMPTS = 3

const backoff = (attempt: number) => new Promise(r => setTimeout(r, 1000 * attempt))

// Retries network errors, rate limits and server errors, so one hiccup doesn't drop a page
async function fetchPage<T>(pageUrl: string, key: string, secret: string): Promise<T[]> {
  for (let attempt = 1; ; attempt++) {
    let res: Response
    try {
      res = await fetch(pageUrl, {
        headers: { 'Authorization': 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64') },
      })
    } catch (e) {
      if (attempt >= MAX_ATTEMPTS) throw new Error(`WooCommerce niet bereikbaar: ${e instanceof Error ? e.message : String(e)}`)
      await backoff(attempt)
      continue
    }
    if (res.ok) return await res.json() as T[]
    const error = `WooCommerce API fout (${res.status}): ${await res.text()}`
    const retryable = res.status === 429 || res.status >= 500
    if (!retryable || attempt >= MAX_ATTEMPTS) throw new Error(error)
    await backoff(attempt)
  }
}

async function wooFetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T[]> {
  const { url, key, secret } = getWooCredentials()
  const allResults: T[] = []
  let page = 1
  const perPage = 100

  while (true) {
    const searchParams = new URLSearchParams({ per_page: String(perPage), page: String(page), ...params })
    const data = await fetchPage<T>(`${url}/wp-json/wc/v3/${endpoint}?${searchParams}`, key, secret)
    allResults.push(...data)
    if (data.length < perPage) break
    page++
    await new Promise(r => setTimeout(r, 200))
  }

  return allResults
}

export async function fetchAllProducts(): Promise<WooProduct[]> {
  log('info', 'WooCommerce: producten ophalen...')
  const products = await wooFetch<WooProduct>('products', { status: 'any' })
  log('info', `WooCommerce: ${products.length} producten opgehaald (incl. variable)`)

  // Fetch variations for variable products
  const allProducts: WooProduct[] = []
  for (const p of products) {
    if (p.type === 'variable') {
      const variations = await wooFetch<WooVariation>(`products/${p.id}/variations`, { status: 'any' })
      for (const v of variations) {
        if (!v.sku) continue
        const attrStr = v.attributes.map(a => a.option).join(' / ')
        // If variation doesn't manage its own stock, inherit from parent
        const stock = v.manage_stock ? v.stock_quantity : (p.stock_quantity ?? v.stock_quantity)
        allProducts.push({
          id: v.id,
          name: attrStr ? `${p.name} — ${attrStr}` : p.name,
          sku: v.sku,
          stock_quantity: stock,
          manage_stock: v.manage_stock || p.manage_stock,
          price: v.price,
          // A variation is only live when its parent is published too
          status: p.status === 'publish' ? v.status : p.status,
        })
      }
    } else {
      allProducts.push(p)
    }
  }

  log('info', `WooCommerce: ${allProducts.length} producten totaal (na variaties)`)
  return allProducts
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
