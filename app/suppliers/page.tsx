'use client'

import { useEffect, useState } from 'react'
import Nav from '@/components/Nav'

interface Supplier {
  id: number
  name: string
  lead_time_days: number
}

interface ProductStatus {
  productId: number
  status: 'order_now' | 'soon' | 'on_track'
}

interface SupplierWithCounts extends Supplier {
  totalProducts: number
  orderNow: number
  soon: number
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<SupplierWithCounts[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [lastSyncStatus, setLastSyncStatus] = useState('')

  // New supplier form
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newLeadTime, setNewLeadTime] = useState('')
  const [saving, setSaving] = useState(false)

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
            totalProducts: arr.length,
            orderNow: arr.filter(p => p.status === 'order_now').length,
            soon: arr.filter(p => p.status === 'soon').length,
          }
        })
      )

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

  async function addSupplier() {
    if (!newName || !newLeadTime) return
    setSaving(true)
    try {
      await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, lead_time_days: parseInt(newLeadTime) }),
      })
      setNewName('')
      setNewLeadTime('')
      setShowForm(false)
      loadData()
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => { loadData() }, [])

  return (
    <div className="min-h-screen">
      <Nav lastSyncAt={lastSyncAt} lastSyncStatus={lastSyncStatus} onSync={handleSync} syncing={syncing} />

      <main className="max-w-[1100px] mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-[16px] font-semibold text-text-primary">Fabrikanten</h1>
          <button
            onClick={() => setShowForm(!showForm)}
            className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover transition-all duration-150"
          >
            {showForm ? 'Annuleren' : 'Fabrikant toevoegen'}
          </button>
        </div>

        {/* Add form */}
        {showForm && (
          <div className="bg-surface-1 rounded-2xl border border-border-subtle p-4 mb-4 animate-row">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1">Naam</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary"
                  placeholder="Fabrikant naam"
                />
              </div>
              <div className="w-36">
                <label className="text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1">Levertijd (dagen)</label>
                <input
                  type="number"
                  min="0"
                  value={newLeadTime}
                  onChange={e => setNewLeadTime(e.target.value)}
                  className="w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary"
                  placeholder="30"
                />
              </div>
              <button
                onClick={addSupplier}
                disabled={saving || !newName || !newLeadTime}
                className="text-[12px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-all duration-150"
              >
                {saving ? 'Opslaan...' : 'Toevoegen'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-1">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-surface-1 rounded-xl border border-border-subtle p-3">
                <div className="flex gap-3"><div className="skeleton h-4 w-40" /><div className="skeleton h-4 w-20" /></div>
              </div>
            ))}
          </div>
        ) : suppliers.length === 0 ? (
          <div className="bg-surface-1 rounded-2xl border border-border-subtle p-16 text-center">
            <p className="text-text-primary text-[14px] font-semibold mb-1">Geen fabrikanten</p>
            <p className="text-text-tertiary text-[13px]">Voeg een fabrikant toe om te beginnen.</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-3 py-2 text-[11px] text-text-tertiary font-semibold uppercase tracking-wider">
              <span className="flex-1">Naam</span>
              <span className="w-24 text-right">Levertijd</span>
              <span className="w-24 text-right">Producten</span>
              <span className="w-24 text-right">Status</span>
            </div>

            {/* Rows */}
            <div className="space-y-1">
              {suppliers.map((s, i) => (
                <a
                  key={s.id}
                  href={`/suppliers/${s.id}`}
                  className={`flex items-center gap-3 px-3 py-3 rounded-xl border transition-all duration-150 hover:bg-surface-hover animate-row ${
                    s.orderNow > 0 ? 'bg-surface-1 border-danger/20' : 'bg-surface-1 border-border-subtle'
                  }`}
                  style={{ animationDelay: `${Math.min(i * 20, 400)}ms` }}
                >
                  <span className="text-text-primary text-[13px] font-medium flex-1">{s.name}</span>
                  <span className="w-24 text-right text-[12px] text-text-secondary tabular-nums">{s.lead_time_days} dagen</span>
                  <span className="w-24 text-right text-[13px] text-text-primary tabular-nums font-medium">{s.totalProducts}</span>
                  <span className="w-24 flex items-center justify-end gap-1.5">
                    {s.orderNow > 0 && (
                      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-danger/10 text-danger">
                        {s.orderNow}
                      </span>
                    )}
                    {s.soon > 0 && (
                      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-warning/10 text-warning">
                        {s.soon}
                      </span>
                    )}
                    {s.orderNow === 0 && s.soon === 0 && (
                      <span className="text-[11px] text-success font-medium">OK</span>
                    )}
                  </span>
                </a>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
