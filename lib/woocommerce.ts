import { getDb } from '@/lib/db'
import { log } from '@/lib/logger'

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
  const products = await wooFetch<WooProduct>('products', { status: 'any' })
  log('info', `WooCommerce: ${products.length} producten opgehaald (incl. variable)`)

  // Fetch variations for variable products
  const allProducts: WooProduct[] = []
  const DEBUG_PREFIX = 'SR-TX2'
  for (const p of products) {
    if (p.sku?.startsWith(DEBUG_PREFIX)) {
      log('info', `DEBUG ${p.sku}: gevonden als top-level product type=${p.type} id=${p.id} stock=${p.stock_quantity} manage_stock=${p.manage_stock}`)
    }
    if (p.type === 'variable') {
      const variations = await wooFetch<WooVariation>(`products/${p.id}/variations`, { status: 'any' })
      const isDebugParent = p.name?.includes('TX2') || p.sku?.startsWith(DEBUG_PREFIX)
      if (isDebugParent) {
        log('info', `DEBUG variable product "${p.name}" (id=${p.id}): ${variations.length} variaties gevonden`)
      }
      for (const v of variations) {
        if (!v.sku) {
          if (isDebugParent) log('info', `DEBUG variatie id=${v.id} van "${p.name}": GEEN SKU, overgeslagen`)
          continue
        }
        if (isDebugParent) {
          log('info', `DEBUG variatie "${p.name}": sku=${v.sku} id=${v.id} stock=${v.stock_quantity} manage_stock=${v.manage_stock} status=${v.status}`)
        }
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
          status: v.status,
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
