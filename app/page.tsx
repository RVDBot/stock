'use client'

import { useEffect, useState, useMemo } from 'react'
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

  const alerts = useMemo(() =>
    products.filter(p => p.status === 'order_now' || p.status === 'soon'),
    [products]
  )

  const summary = useMemo(() => ({
    orderNow: products.filter(p => p.status === 'order_now').length,
    soon: products.filter(p => p.status === 'soon').length,
    total: products.length,
  }), [products])

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
      </main>
    </div>
  )
}
