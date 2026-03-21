'use client'

import { useEffect, useState, useMemo, use } from 'react'
import Nav from '@/components/Nav'

interface ProductStatus {
  productId: number
  sku: string
  name: string
  currentStock: number
  dailySales: number
  daysUntilEmpty: number
  orderDeadlineDays: number
  status: 'order_now' | 'soon' | 'on_track'
  supplierId: number | null
  supplierName: string | null
  supplierLeadTime: number | null
  pendingOrderQty: number
  pendingOrderArrival: string | null
  dataWeeks: number
  price: number
}

interface Supplier {
  id: number
  name: string
  lead_time_days: number
  contact_info: string | null
  notes: string | null
  created_at: string
}

interface PurchaseOrder {
  id: number
  supplier_id: number
  product_id: number
  quantity: number
  order_date: string
  expected_arrival: string | null
  status: string
  notes: string | null
  created_at: string
}

function formatNumber(n: number): string {
  return n.toLocaleString('nl-NL')
}

const STATUS_STYLES = {
  order_now: { bg: 'bg-danger/10', text: 'text-danger', border: 'border-danger/20', label: 'Bestel nu' },
  soon: { bg: 'bg-warning/10', text: 'text-warning', border: 'border-warning/20', label: 'Binnenkort' },
  on_track: { bg: 'bg-success/10', text: 'text-success', border: 'border-success/20', label: 'Op schema' },
}

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [products, setProducts] = useState<ProductStatus[]>([])
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [lastSyncStatus, setLastSyncStatus] = useState('')
  const [showOrderForm, setShowOrderForm] = useState(false)
  const [orderProductId, setOrderProductId] = useState<number | ''>('')
  const [orderQty, setOrderQty] = useState('')
  const [orderArrival, setOrderArrival] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)

  function loadData() {
    setLoading(true)
    Promise.all([
      fetch('/api/suppliers').then(r => r.json()),
      fetch(`/api/products?supplier_id=${id}`).then(r => r.json()),
      fetch(`/api/purchase-orders?supplier_id=${id}`).then(r => r.json()),
      fetch('/api/settings').then(r => r.json()),
    ]).then(([suppliersData, productsData, ordersData, settData]) => {
      const allSuppliers: Supplier[] = Array.isArray(suppliersData) ? suppliersData : []
      setSupplier(allSuppliers.find(s => s.id === parseInt(id, 10)) || null)
      setProducts(Array.isArray(productsData) ? productsData : [])
      setOrders(Array.isArray(ordersData) ? ordersData : [])
      const settings = settData.settings || {}
      setLastSyncAt(settings.last_sync_at || '')
      setLastSyncStatus(settings.last_sync_status || '')
    }).finally(() => setLoading(false))
  }

  async function handleSync() {
    setSyncing(true)
    try {
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'daily' }),
      })
      loadData()
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const summary = useMemo(() => ({
    orderNow: products.filter(p => p.status === 'order_now').length,
    soon: products.filter(p => p.status === 'soon').length,
    onTrack: products.filter(p => p.status === 'on_track').length,
  }), [products])

  function getOrdersForProduct(productId: number) {
    return orders.filter(o => o.product_id === productId && o.status !== 'received')
  }

  async function handleSubmitOrder(e: React.FormEvent) {
    e.preventDefault()
    if (!orderProductId || !orderQty) return
    setSubmitting(true)
    try {
      await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_id: parseInt(id, 10),
          product_id: orderProductId,
          quantity: parseInt(orderQty, 10),
          expected_arrival: orderArrival || undefined,
        }),
      })
      setShowOrderForm(false)
      setOrderProductId('')
      setOrderQty('')
      setOrderArrival('')
      loadData()
    } finally {
      setSubmitting(false)
    }
  }

  function handleCopyOrderList() {
    if (!supplier) return
    const today = new Date().toLocaleDateString('nl-NL')
    const orderNowProducts = products.filter(p => p.status === 'order_now')
    const soonProducts = products.filter(p => p.status === 'soon')

    let text = `Bestelling SpeedRopeShop — ${supplier.name} — ${today}\n`

    if (orderNowProducts.length > 0) {
      text += '\nBestel nu:\n'
      for (const p of orderNowProducts) {
        text += `- ${p.sku} ${p.name} — voorraad: ${formatNumber(p.currentStock)}, verkoop: ${p.dailySales.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/dag\n`
      }
    }

    if (soonProducts.length > 0) {
      text += '\nBinnenkort:\n'
      for (const p of soonProducts) {
        text += `- ${p.sku} ${p.name} — voorraad: ${formatNumber(p.currentStock)}, verkoop: ${p.dailySales.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/dag\n`
      }
    }

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="min-h-screen">
      <Nav lastSyncAt={lastSyncAt} lastSyncStatus={lastSyncStatus} onSync={handleSync} syncing={syncing} />

      <main className="max-w-[1100px] mx-auto px-6 py-6">
        {loading ? (
          <div className="space-y-3">
            <div className="skeleton h-6 w-48 mb-2" />
            <div className="skeleton h-4 w-32 mb-4" />
            <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5">
              <div className="flex gap-8">
                <div className="skeleton h-10 w-20" />
                <div className="skeleton h-10 w-20" />
                <div className="skeleton h-10 w-20" />
              </div>
            </div>
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-surface-1 rounded-2xl border border-border-subtle p-4">
                <div className="flex justify-between"><div className="skeleton h-5 w-60" /><div className="skeleton h-6 w-20" /></div>
              </div>
            ))}
          </div>
        ) : !supplier ? (
          <div className="bg-surface-1 rounded-2xl border border-border-subtle p-16 text-center">
            <p className="text-text-primary text-[14px] font-semibold mb-1">Fabrikant niet gevonden</p>
            <a href="/suppliers" className="text-accent hover:text-accent-hover text-[13px]">Terug naar overzicht</a>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="mb-4">
              <a href="/suppliers" className="text-accent hover:text-accent-hover text-[12px] mb-2 inline-block">&larr; Fabrikanten</a>
              <h1 className="text-[18px] font-semibold text-text-primary">{supplier.name}</h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-secondary mt-1">
                <span>Levertijd: <strong>{supplier.lead_time_days} dagen</strong></span>
                {supplier.contact_info && <span>Contact: {supplier.contact_info}</span>}
                {supplier.notes && <span className="text-text-tertiary">{supplier.notes}</span>}
              </div>
            </div>

            {/* Summary bar */}
            <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-8">
                  <div>
                    <p className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-0.5">Bestel nu</p>
                    <p className="text-[22px] font-bold text-danger tracking-tight leading-none tabular-nums">{summary.orderNow}</p>
                  </div>
                  <div>
                    <p className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-0.5">Binnenkort</p>
                    <p className="text-[22px] font-bold text-warning tracking-tight leading-none tabular-nums">{summary.soon}</p>
                  </div>
                  <div>
                    <p className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-0.5">Op schema</p>
                    <p className="text-[22px] font-bold text-success tracking-tight leading-none tabular-nums">{summary.onTrack}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyOrderList}
                    disabled={summary.orderNow === 0 && summary.soon === 0}
                    className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-surface-2 border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-surface-3 disabled:opacity-40 transition-all duration-150"
                  >
                    {copied ? 'Gekopieerd!' : 'Kopieer bestellijst'}
                  </button>
                  <button
                    onClick={() => setShowOrderForm(!showOrderForm)}
                    className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover transition-all duration-150"
                  >
                    Bestelling registreren
                  </button>
                </div>
              </div>
            </div>

            {/* Order form */}
            {showOrderForm && (
              <div className="bg-surface-1 rounded-2xl border border-border-subtle p-4 mb-4 animate-row">
                <h3 className="text-[14px] font-semibold text-text-primary mb-3">Nieuwe bestelling</h3>
                <form onSubmit={handleSubmitOrder} className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[180px]">
                    <label className="text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1">Product</label>
                    <select
                      value={orderProductId}
                      onChange={e => setOrderProductId(e.target.value ? parseInt(e.target.value, 10) : '')}
                      className="w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary"
                      required
                    >
                      <option value="">Selecteer product...</option>
                      {products.map(p => (
                        <option key={p.productId} value={p.productId}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-28">
                    <label className="text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1">Aantal</label>
                    <input
                      type="number"
                      min="1"
                      value={orderQty}
                      onChange={e => setOrderQty(e.target.value)}
                      className="w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary"
                      required
                      placeholder="0"
                    />
                  </div>
                  <div className="w-40">
                    <label className="text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1">Verwachte aankomst</label>
                    <input
                      type="date"
                      value={orderArrival}
                      onChange={e => setOrderArrival(e.target.value)}
                      className="w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="text-[12px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-all duration-150"
                    >
                      {submitting ? 'Opslaan...' : 'Opslaan'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowOrderForm(false)}
                      className="text-[12px] font-medium px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle text-text-secondary hover:text-text-primary transition-all duration-150"
                    >
                      Annuleren
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Product table */}
            {products.length === 0 ? (
              <div className="bg-surface-1 rounded-2xl border border-border-subtle p-16 text-center">
                <p className="text-text-primary text-[14px] font-semibold mb-1">Geen producten</p>
                <p className="text-text-tertiary text-[13px]">Er zijn geen producten gekoppeld aan deze fabrikant.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {products.map((p, i) => {
                  const style = STATUS_STYLES[p.status]
                  const productOrders = getOrdersForProduct(p.productId)
                  return (
                    <div
                      key={p.productId}
                      className="bg-surface-1 rounded-2xl border border-border-subtle p-4 animate-row"
                      style={{ animationDelay: `${Math.min(i * 20, 400)}ms` }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg border ${style.bg} ${style.text} ${style.border}`}>
                              {style.label}
                            </span>
                            <span className="text-text-primary text-[14px] font-semibold">{p.name}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-secondary ml-8">
                            <span className="text-text-tertiary font-mono text-[11px]">{p.sku}</span>
                            <span>Voorraad: <strong>{formatNumber(p.currentStock)}</strong></span>
                            <span>Verkoop: <strong>{p.dailySales.toFixed(1)}/dag</strong></span>
                            <span>Leeg over: <strong>{p.daysUntilEmpty} dagen</strong></span>
                          </div>
                          {p.pendingOrderQty > 0 && (
                            <p className="text-[11px] text-success mt-1 ml-8">
                              {formatNumber(p.pendingOrderQty)} besteld
                              {p.pendingOrderArrival && `, verwacht ${new Date(p.pendingOrderArrival).toLocaleDateString('nl-NL')}`}
                            </p>
                          )}
                          {productOrders.length > 0 && (
                            <div className="mt-1 ml-8 space-y-0.5">
                              {productOrders.map(o => (
                                <p key={o.id} className="text-[11px] text-text-tertiary">
                                  Bestelling #{o.id}: {formatNumber(o.quantity)} stuks
                                  {o.expected_arrival && ` — verwacht ${new Date(o.expected_arrival).toLocaleDateString('nl-NL')}`}
                                  <span className={`ml-1 ${o.status === 'pending' ? 'text-warning' : o.status === 'ordered' ? 'text-accent' : 'text-text-tertiary'}`}>
                                    ({o.status})
                                  </span>
                                </p>
                              ))}
                            </div>
                          )}
                          {p.dataWeeks < 12 && (
                            <p className="text-[11px] text-warning mt-1 ml-8">
                              Beperkte verkoopdata ({p.dataWeeks} weken)
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[16px] font-bold text-text-primary tabular-nums">{p.daysUntilEmpty}d</p>
                          <p className="text-text-tertiary text-[11px]">tot leeg</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
