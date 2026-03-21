'use client'

import { useEffect, useState } from 'react'
import Nav from '@/components/Nav'

interface Supplier {
  id: number
  name: string
  lead_time_days: number
  contact_info: string | null
  notes: string | null
  created_at: string
}

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

interface SupplierWithCounts extends Supplier {
  orderNow: number
  soon: number
  onTrack: number
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<SupplierWithCounts[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [lastSyncStatus, setLastSyncStatus] = useState('')

  function loadData() {
    setLoading(true)
    Promise.all([
      fetch('/api/suppliers').then(r => r.json()),
      fetch('/api/settings').then(r => r.json()),
    ]).then(async ([suppliersData, settData]) => {
      const settings = settData.settings || {}
      setLastSyncAt(settings.last_sync_at || '')
      setLastSyncStatus(settings.last_sync_status || '')

      const supplierList: Supplier[] = Array.isArray(suppliersData) ? suppliersData : []

      const withCounts: SupplierWithCounts[] = await Promise.all(
        supplierList.map(async (s) => {
          const products: ProductStatus[] = await fetch(`/api/products?supplier_id=${s.id}`).then(r => r.json())
          const arr = Array.isArray(products) ? products : []
          return {
            ...s,
            orderNow: arr.filter(p => p.status === 'order_now').length,
            soon: arr.filter(p => p.status === 'soon').length,
            onTrack: arr.filter(p => p.status === 'on_track').length,
          }
        })
      )

      // Sort: suppliers with order_now first, then by name
      withCounts.sort((a, b) => {
        if (a.orderNow > 0 && b.orderNow === 0) return -1
        if (a.orderNow === 0 && b.orderNow > 0) return 1
        return a.name.localeCompare(b.name)
      })

      setSuppliers(withCounts)
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

  return (
    <div className="min-h-screen">
      <Nav lastSyncAt={lastSyncAt} lastSyncStatus={lastSyncStatus} onSync={handleSync} syncing={syncing} />

      <main className="max-w-[1100px] mx-auto px-6 py-6">
        <h1 className="text-[16px] font-semibold text-text-primary mb-4">Fabrikanten</h1>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-surface-1 rounded-2xl border border-border-subtle p-4">
                <div className="skeleton h-5 w-40 mb-3" />
                <div className="skeleton h-4 w-24 mb-2" />
                <div className="flex gap-3">
                  <div className="skeleton h-6 w-16" />
                  <div className="skeleton h-6 w-16" />
                  <div className="skeleton h-6 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : suppliers.length === 0 ? (
          <div className="bg-surface-1 rounded-2xl border border-border-subtle p-16 text-center">
            <p className="text-text-primary text-[14px] font-semibold mb-1">Geen fabrikanten</p>
            <p className="text-text-tertiary text-[13px]">Voeg fabrikanten toe via Instellingen.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {suppliers.map((s, i) => {
              const hasUrgent = s.orderNow > 0
              return (
                <a
                  key={s.id}
                  href={`/suppliers/${s.id}`}
                  className={`bg-surface-1 rounded-2xl border p-4 animate-row block transition-all duration-150 hover:bg-surface-2 ${
                    hasUrgent ? 'border-danger/30' : 'border-border-subtle'
                  }`}
                  style={{ animationDelay: `${Math.min(i * 20, 400)}ms` }}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h2 className="text-[14px] font-semibold text-text-primary">{s.name}</h2>
                    {hasUrgent && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-danger/10 text-danger border border-danger/20 shrink-0">
                        Actie vereist
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-text-secondary mb-3">Levertijd: {s.lead_time_days} dagen</p>
                  <div className="flex items-center gap-2">
                    {s.orderNow > 0 && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg border bg-danger/10 text-danger border-danger/20">
                        {s.orderNow} bestel nu
                      </span>
                    )}
                    {s.soon > 0 && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg border bg-warning/10 text-warning border-warning/20">
                        {s.soon} binnenkort
                      </span>
                    )}
                    {s.onTrack > 0 && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg border bg-success/10 text-success border-success/20">
                        {s.onTrack} op schema
                      </span>
                    )}
                    {s.orderNow === 0 && s.soon === 0 && s.onTrack === 0 && (
                      <span className="text-[11px] text-text-tertiary">Geen producten</span>
                    )}
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
