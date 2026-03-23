'use client'

import { useEffect, useState, useMemo, use } from 'react'
import Nav from '@/components/Nav'

interface Supplier {
  id: number
  name: string
  lead_time_days: number
  order_cycle_days: number
  inspection: string
  contact_name: string | null
  contact_email: string | null
  phone: string | null
  preferred_contact: string
  contact_info: string | null
  notes: string | null
  created_at: string
}

interface OrderListProduct {
  productId: number
  sku: string
  name: string
  currentStock: number
  dailySales: number
  requiredStock: number
  toOrder: number
}

interface ProductStatus {
  productId: number
  wooProductId: number
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

const INSPECTION_OPTIONS = [
  { value: 'never', label: 'Nooit' },
  { value: 'new_products', label: 'Alleen bij nieuwe producten' },
  { value: 'always', label: 'Altijd' },
]

const PREFERRED_CONTACT_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
]

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [products, setProducts] = useState<ProductStatus[]>([])
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [lastSyncStatus, setLastSyncStatus] = useState('')
  const [wooUrl, setWooUrl] = useState('')

  // Edit state
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    lead_time_days: 0,
    order_cycle_days: 30,
    inspection: 'never',
    contact_name: '',
    contact_email: '',
    phone: '',
    preferred_contact: 'email',
    notes: '',
  })

  // Order form state
  const [showOrderForm, setShowOrderForm] = useState(false)
  const [orderProductId, setOrderProductId] = useState<number | ''>('')
  const [orderQty, setOrderQty] = useState('')
  const [orderArrival, setOrderArrival] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<'products' | 'orderlist'>('products')
  const [orderList, setOrderList] = useState<OrderListProduct[]>([])
  const [orderListCoverageDays, setOrderListCoverageDays] = useState(0)
  const [orderListLoading, setOrderListLoading] = useState(false)

  function loadData() {
    setLoading(true)
    Promise.all([
      fetch(`/api/suppliers?id=${id}`).then(r => r.json()),
      fetch(`/api/products?supplier_id=${id}`).then(r => r.json()),
      fetch(`/api/purchase-orders?supplier_id=${id}`).then(r => r.json()),
      fetch('/api/settings').then(r => r.json()),
    ]).then(([supplierData, productsData, ordersData, settData]) => {
      const sup = supplierData.error ? null : supplierData as Supplier
      setSupplier(sup)
      if (sup) {
        setForm({
          name: sup.name,
          lead_time_days: sup.lead_time_days,
          order_cycle_days: sup.order_cycle_days ?? 30,
          inspection: sup.inspection || 'never',
          contact_name: sup.contact_name || '',
          contact_email: sup.contact_email || '',
          phone: sup.phone || '',
          preferred_contact: sup.preferred_contact || 'email',
          notes: sup.notes || '',
        })
      }
      setProducts(Array.isArray(productsData) ? productsData : [])
      setOrders(Array.isArray(ordersData) ? ordersData : [])
      const settings = settData.settings || {}
      setLastSyncAt(settings.last_sync_at || '')
      setLastSyncStatus(settings.last_sync_status || '')
      setWooUrl(settings.woo_url || '')
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

  async function handleSave() {
    setSaving(true)
    try {
      await fetch('/api/suppliers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: parseInt(id, 10), ...form }),
      })
      setEditing(false)
      loadData()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Weet je zeker dat je deze fabrikant wilt verwijderen? Producten worden losgekoppeld.')) return
    await fetch('/api/suppliers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: parseInt(id, 10) }),
    })
    window.location.href = '/suppliers'
  }

  function loadOrderList() {
    setOrderListLoading(true)
    fetch(`/api/order-list?supplier_id=${id}`).then(r => r.json()).then(data => {
      setOrderList(data.products || [])
      setOrderListCoverageDays(data.coverageDays || 0)
    }).finally(() => setOrderListLoading(false))
  }

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    if (activeTab === 'orderlist') loadOrderList()
  }, [activeTab])

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

  const adminBase = wooUrl ? `${wooUrl.replace(/\/$/, '')}/wp-admin/post.php` : ''

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
              <div className="flex items-center justify-between">
                <h1 className="text-[18px] font-semibold text-text-primary">{supplier.name}</h1>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditing(!editing)}
                    className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-surface-2 border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-all duration-150"
                  >
                    {editing ? 'Annuleren' : 'Bewerken'}
                  </button>
                  <button
                    onClick={handleDelete}
                    className="text-[12px] font-medium px-3 py-1.5 rounded-lg text-danger hover:bg-danger/10 transition-all duration-150"
                  >
                    Verwijderen
                  </button>
                </div>
              </div>
            </div>

            {/* Edit / View mode */}
            {editing ? (
              <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5 mb-4 animate-row">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Left column */}
                  <div className="space-y-3">
                    <h3 className="text-[13px] font-semibold text-text-primary">Bedrijfsgegevens</h3>
                    <div>
                      <label className="text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1">Bedrijfsnaam</label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={e => setForm({ ...form, name: e.target.value })}
                        className="w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1">Levertijd (dagen)</label>
                      <input
                        type="number"
                        min="0"
                        value={form.lead_time_days}
                        onChange={e => setForm({ ...form, lead_time_days: parseInt(e.target.value, 10) || 0 })}
                        className="w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1">Inspectie</label>
                      <select
                        value={form.inspection}
                        onChange={e => setForm({ ...form, inspection: e.target.value })}
                        className="w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary"
                      >
                        {INSPECTION_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Right column */}
                  <div className="space-y-3">
                    <h3 className="text-[13px] font-semibold text-text-primary">Contactgegevens</h3>
                    <div>
                      <label className="text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1">Naam</label>
                      <input
                        type="text"
                        value={form.contact_name}
                        onChange={e => setForm({ ...form, contact_name: e.target.value })}
                        className="w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary"
                        placeholder="Contactpersoon"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1">Email</label>
                      <input
                        type="email"
                        value={form.contact_email}
                        onChange={e => setForm({ ...form, contact_email: e.target.value })}
                        className="w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary"
                        placeholder="email@fabrikant.com"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1">Telefoonnummer</label>
                      <input
                        type="tel"
                        value={form.phone}
                        onChange={e => setForm({ ...form, phone: e.target.value })}
                        className="w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary"
                        placeholder="+31 6 12345678"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1">Geprefereerd contact</label>
                      <select
                        value={form.preferred_contact}
                        onChange={e => setForm({ ...form, preferred_contact: e.target.value })}
                        className="w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary"
                      >
                        {PREFERRED_CONTACT_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <label className="text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1">Notities</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    rows={2}
                    className="w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary resize-none"
                    placeholder="Opmerkingen over deze fabrikant..."
                  />
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    onClick={handleSave}
                    disabled={saving || !form.name}
                    className="text-[12px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-all duration-150"
                  >
                    {saving ? 'Opslaan...' : 'Opslaan'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5 mb-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {/* Left: business info */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-secondary">
                      <span>Levertijd: <strong>{supplier.lead_time_days} dagen</strong></span>
                      <span>Inspectie: <strong>{INSPECTION_OPTIONS.find(o => o.value === supplier.inspection)?.label || 'Nooit'}</strong></span>
                    </div>
                    {supplier.notes && (
                      <p className="text-[12px] text-text-tertiary">{supplier.notes}</p>
                    )}
                  </div>

                  {/* Right: contact info */}
                  <div className="space-y-1 text-[12px] text-text-secondary">
                    {supplier.contact_name && (
                      <p><span className="text-text-tertiary">Naam:</span> {supplier.contact_name}</p>
                    )}
                    {supplier.contact_email && (
                      <p><span className="text-text-tertiary">Email:</span> <a href={`mailto:${supplier.contact_email}`} className="text-accent hover:text-accent-hover">{supplier.contact_email}</a></p>
                    )}
                    {supplier.phone && (
                      <p><span className="text-text-tertiary">Tel:</span> <a href={`tel:${supplier.phone}`} className="text-accent hover:text-accent-hover">{supplier.phone}</a></p>
                    )}
                    {(supplier.contact_name || supplier.contact_email || supplier.phone) && (
                      <p><span className="text-text-tertiary">Voorkeur:</span> <strong>{PREFERRED_CONTACT_OPTIONS.find(o => o.value === supplier.preferred_contact)?.label || 'Email'}</strong></p>
                    )}
                    {!supplier.contact_name && !supplier.contact_email && !supplier.phone && (
                      <p className="text-text-tertiary">Geen contactgegevens ingevuld</p>
                    )}
                  </div>
                </div>
              </div>
            )}

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

            {/* Product overview */}
            {activeTab === 'products' && (
              <div className="mb-4">
                <h2 className="text-[14px] font-semibold text-text-primary mb-2">Producten ({products.length})</h2>
              {products.length === 0 ? (
                <div className="bg-surface-1 rounded-2xl border border-border-subtle p-12 text-center">
                  <p className="text-text-tertiary text-[13px]">Geen producten gekoppeld aan deze fabrikant.</p>
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
                              <span>Verkoop: <strong>{p.dailySales.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/dag</strong></span>
                              <span>Leeg over: <strong>{p.daysUntilEmpty} dagen</strong></span>
                              {adminBase && (
                                <a
                                  href={`${adminBase}?post=${p.wooProductId}&action=edit`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-accent hover:text-accent-hover"
                                >
                                  WooCommerce
                                </a>
                              )}
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
              </div>
            )}

            {/* Order list tab */}
            {activeTab === 'orderlist' && (
              <div className="mb-4">
                {orderListLoading ? (
                  <div className="space-y-2">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="bg-surface-1 rounded-xl border border-border-subtle p-3">
                        <div className="flex gap-3"><div className="skeleton h-4 w-20" /><div className="skeleton h-4 w-full" /></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="bg-surface-1 rounded-2xl border border-border-subtle p-4 mb-3">
                      <p className="text-text-secondary text-[13px]">
                        Berekend voor <strong>{orderListCoverageDays} dagen</strong> voorraad
                        <span className="text-text-tertiary ml-2">
                          (levertijd {supplier.lead_time_days}d + inbound + marge + cyclus {supplier.order_cycle_days ?? 30}d)
                        </span>
                      </p>
                    </div>

                    {/* Header */}
                    <div className="flex items-center gap-3 px-3 py-2 text-[11px] text-text-tertiary font-semibold uppercase tracking-wider">
                      <span className="w-24">SKU</span>
                      <span className="flex-1">Naam</span>
                      <span className="w-20 text-right">Voorraad</span>
                      <span className="w-20 text-right">Verkoop/d</span>
                      <span className="w-24 text-right">Nodig</span>
                      <span className="w-24 text-right">Bestellen</span>
                    </div>

                    <div className="space-y-1">
                      {orderList.map((p, i) => (
                        <div
                          key={p.productId}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border animate-row ${
                            p.toOrder > 0 ? 'bg-surface-1 border-border-subtle' : 'bg-surface-1/50 border-border-subtle/50'
                          }`}
                          style={{ animationDelay: `${Math.min(i * 20, 400)}ms` }}
                        >
                          <span className="text-text-tertiary font-mono text-[11px] w-24 shrink-0 truncate">{p.sku}</span>
                          <span className={`text-[13px] flex-1 truncate ${p.toOrder > 0 ? 'text-text-primary' : 'text-text-tertiary'}`}>{p.name}</span>
                          <span className="w-20 text-right text-[13px] tabular-nums text-text-secondary">{formatNumber(p.currentStock)}</span>
                          <span className="w-20 text-right text-[13px] tabular-nums text-text-secondary">{p.dailySales.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                          <span className="w-24 text-right text-[13px] tabular-nums text-text-secondary">{formatNumber(p.requiredStock)}</span>
                          <span className={`w-24 text-right text-[13px] tabular-nums font-semibold ${
                            p.toOrder > 0 ? 'text-danger' : 'text-success'
                          }`}>
                            {p.toOrder > 0 ? formatNumber(p.toOrder) : '—'}
                          </span>
                        </div>
                      ))}
                    </div>

                    {orderList.filter(p => p.toOrder > 0).length > 0 && (
                      <div className="flex items-center justify-between mt-3 px-3 py-3 rounded-xl bg-surface-1 border border-border-subtle">
                        <span className="text-[13px] font-semibold text-text-primary">
                          Totaal te bestellen: {orderList.filter(p => p.toOrder > 0).length} producten
                        </span>
                        <span className="text-[16px] font-bold text-danger tabular-nums">
                          {formatNumber(orderList.reduce((sum, p) => sum + p.toOrder, 0))} stuks
                        </span>
                      </div>
                    )}

                    {orderList.length === 0 && (
                      <div className="bg-surface-1 rounded-2xl border border-border-subtle p-12 text-center">
                        <p className="text-text-tertiary text-[13px]">Geen producten gekoppeld aan deze fabrikant.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Orders overview */}
            <div>
              <h2 className="text-[14px] font-semibold text-text-primary mb-2">Bestellingen ({orders.length})</h2>
              {orders.length === 0 ? (
                <div className="bg-surface-1 rounded-2xl border border-border-subtle p-12 text-center">
                  <p className="text-text-tertiary text-[13px]">Nog geen bestellingen geregistreerd.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {orders.map((o, i) => {
                    const product = products.find(p => p.productId === o.product_id)
                    const statusColor = o.status === 'ordered' ? 'text-accent' : o.status === 'shipped' ? 'text-warning' : o.status === 'received' ? 'text-success' : 'text-text-tertiary'
                    return (
                      <div
                        key={o.id}
                        className="bg-surface-1 rounded-2xl border border-border-subtle p-4 animate-row"
                        style={{ animationDelay: `${Math.min(i * 20, 400)}ms` }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-text-primary text-[13px] font-semibold">
                                #{o.id} — {product?.name || `Product #${o.product_id}`}
                              </span>
                              <span className={`text-[11px] font-semibold ${statusColor}`}>
                                {o.status}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-secondary">
                              <span>{formatNumber(o.quantity)} stuks</span>
                              <span>Besteld: {new Date(o.order_date).toLocaleDateString('nl-NL')}</span>
                              {o.expected_arrival && (
                                <span>Verwacht: {new Date(o.expected_arrival).toLocaleDateString('nl-NL')}</span>
                              )}
                              {o.notes && (
                                <span className="text-text-tertiary">{o.notes}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
