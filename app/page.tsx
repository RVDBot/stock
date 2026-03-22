'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import Nav from '@/components/Nav'

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

function formatNumber(n: number): string {
  return n.toLocaleString('nl-NL')
}

const STATUS_STYLES = {
  order_now: { bg: 'bg-danger/10', text: 'text-danger', border: 'border-danger/20', label: 'Bestel nu' },
  soon: { bg: 'bg-warning/10', text: 'text-warning', border: 'border-warning/20', label: 'Binnenkort' },
  on_track: { bg: 'bg-success/10', text: 'text-success', border: 'border-success/20', label: 'Op schema' },
}

export default function AlertsPage() {
  const [products, setProducts] = useState<ProductStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [lastSyncStatus, setLastSyncStatus] = useState('')
  const [wooUrl, setWooUrl] = useState('')
  const [openMenu, setOpenMenu] = useState<number | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useState('')

  function loadData() {
    setLoading(true)
    Promise.all([
      fetch('/api/products').then(r => r.json()),
      fetch('/api/settings').then(r => r.json()),
    ]).then(([prodData, settData]) => {
      setProducts(Array.isArray(prodData) ? prodData : prodData.products || [])
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

  async function ignoreProduct(productId: number) {
    await fetch('/api/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [productId], active: 0 }),
    })
    setOpenMenu(null)
    loadData()
  }

  useEffect(() => { loadData() }, [])

  // Close menu when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    if (openMenu !== null) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [openMenu])

  const alerts = useMemo(() => {
    let filtered = products.filter(p => p.status === 'order_now' || p.status === 'soon')
    if (search) {
      const q = search.toLowerCase()
      filtered = filtered.filter(p =>
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.supplierName && p.supplierName.toLowerCase().includes(q))
      )
    }
    return filtered
  }, [products, search])

  const summary = useMemo(() => ({
    orderNow: products.filter(p => p.status === 'order_now').length,
    soon: products.filter(p => p.status === 'soon').length,
    total: products.length,
  }), [products])

  const adminBase = wooUrl ? `${wooUrl.replace(/\/$/, '')}/wp-admin/post.php` : ''
  const siteBase = wooUrl ? wooUrl.replace(/\/$/, '') : ''

  return (
    <div className="min-h-screen">
      <Nav lastSyncAt={lastSyncAt} lastSyncStatus={lastSyncStatus} onSync={handleSync} syncing={syncing} />

      <main className="max-w-[1100px] mx-auto px-6 py-6">
        {/* Summary */}
        <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5 mb-4">
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
              <p className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-0.5">Totaal producten</p>
              <p className="text-[22px] font-bold text-text-primary tracking-tight leading-none tabular-nums">{summary.total}</p>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Zoek op SKU, naam of fabrikant..."
            className="w-full text-[13px] px-3 py-2 rounded-lg bg-surface-1 border border-border-subtle text-text-primary outline-none focus:border-accent transition-colors"
          />
        </div>

        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-surface-1 rounded-2xl border border-border-subtle p-4">
                <div className="flex justify-between"><div className="skeleton h-5 w-60" /><div className="skeleton h-6 w-20" /></div>
              </div>
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <div className="bg-surface-1 rounded-2xl border border-border-subtle p-16 text-center">
            <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-success" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 8.5l3 3 7-7" />
              </svg>
            </div>
            <p className="text-text-primary text-[14px] font-semibold mb-1">Alle producten op schema</p>
            <p className="text-text-tertiary text-[13px]">Geen producten die nu besteld moeten worden.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((p, i) => {
              const style = STATUS_STYLES[p.status]
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
                        {p.supplierName ? (
                          <a href={`/suppliers/${p.supplierId}`} className="text-accent hover:text-accent-hover">
                            {p.supplierName} ({p.supplierLeadTime}d)
                          </a>
                        ) : (
                          <span className="text-danger font-medium">Geen fabrikant</span>
                        )}
                      </div>
                      {p.pendingOrderQty > 0 && (
                        <p className="text-[11px] text-success mt-1 ml-8">
                          {formatNumber(p.pendingOrderQty)} besteld
                          {p.pendingOrderArrival && `, verwacht ${new Date(p.pendingOrderArrival).toLocaleDateString('nl-NL')}`}
                        </p>
                      )}
                      {p.dataWeeks < 12 && (
                        <p className="text-[11px] text-warning mt-1 ml-8">
                          Beperkte verkoopdata ({p.dataWeeks} weken)
                        </p>
                      )}
                    </div>
                    <div className="flex items-start gap-2 shrink-0">
                      <div className="text-right">
                        <p className="text-[16px] font-bold text-text-primary tabular-nums">{p.daysUntilEmpty}d</p>
                        <p className="text-text-tertiary text-[11px]">tot leeg</p>
                      </div>
                      {/* 3-dot menu */}
                      <div className="relative" ref={openMenu === p.productId ? menuRef : undefined}>
                        <button
                          onClick={() => setOpenMenu(openMenu === p.productId ? null : p.productId)}
                          className="p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                            <circle cx="8" cy="3" r="1.5" />
                            <circle cx="8" cy="8" r="1.5" />
                            <circle cx="8" cy="13" r="1.5" />
                          </svg>
                        </button>
                        {openMenu === p.productId && (
                          <div className="absolute right-0 top-8 z-50 w-48 bg-surface-1 rounded-xl border border-border-subtle shadow-lg py-1 animate-row">
                            {adminBase && (
                              <a
                                href={`${adminBase}?post=${p.wooProductId}&action=edit`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block px-3 py-2 text-[13px] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors"
                              >
                                Product wijzigen
                              </a>
                            )}
                            {siteBase && (
                              <a
                                href={`${siteBase}/?p=${p.wooProductId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block px-3 py-2 text-[13px] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors"
                              >
                                Product bekijken
                              </a>
                            )}
                            <button
                              onClick={() => ignoreProduct(p.productId)}
                              className="block w-full text-left px-3 py-2 text-[13px] text-danger hover:bg-danger/5 transition-colors"
                            >
                              Product negeren
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
