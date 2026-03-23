'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import Nav from '@/components/Nav'

interface Product {
  productId: number
  sku: string
  name: string
  currentStock: number
  dailySales: number
  daysUntilEmpty: number
  status: 'order_now' | 'soon' | 'on_track'
  supplierId: number | null
  supplierName: string | null
}

interface Supplier {
  id: number
  name: string
}

interface IgnoredProduct {
  productId: number
  sku: string
  name: string
  supplierId: number | null
}

function formatNumber(n: number): string {
  return n.toLocaleString('nl-NL')
}

const STATUS_DOT = {
  order_now: 'bg-danger',
  soon: 'bg-warning',
  on_track: 'bg-success',
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [ignoredProducts, setIgnoredProducts] = useState<IgnoredProduct[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [lastSyncStatus, setLastSyncStatus] = useState('')

  const [search, setSearch] = useState('')
  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set())
  const [bulkSupplierId, setBulkSupplierId] = useState('')
  const [bulkAssigning, setBulkAssigning] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)
  const [sortCol, setSortCol] = useState<'sku' | 'name' | 'supplier' | 'stock'>('sku')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const lastClickedIndex = useRef<number | null>(null)

  function loadData() {
    setLoading(true)
    Promise.all([
      fetch('/api/products').then(r => r.json()),
      fetch('/api/products?inactive=1').then(r => r.json()),
      fetch('/api/suppliers').then(r => r.json()),
      fetch('/api/settings').then(r => r.json()),
    ]).then(([prodData, ignoredData, suppData, settData]) => {
      setProducts(Array.isArray(prodData) ? prodData : [])
      setIgnoredProducts(Array.isArray(ignoredData) ? ignoredData : [])
      setSuppliers(Array.isArray(suppData) ? suppData : [])
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

  const filtered = useMemo(() => {
    let list = products
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.supplierName && p.supplierName.toLowerCase().includes(q))
      )
    }
    const dir = sortDir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortCol) {
        case 'sku': return a.sku.localeCompare(b.sku) * dir
        case 'name': return a.name.localeCompare(b.name) * dir
        case 'supplier': return (a.supplierName || '').localeCompare(b.supplierName || '') * dir
        case 'stock': return (a.currentStock - b.currentStock) * dir
      }
    })
  }, [products, search, sortCol, sortDir])

  function handleSort(col: typeof sortCol) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  function SortArrow({ col }: { col: typeof sortCol }) {
    if (sortCol !== col) return null
    return <span className="ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  function handleProductClick(e: React.MouseEvent, index: number) {
    const id = filtered[index].productId
    const isShift = e.shiftKey

    if (isShift && lastClickedIndex.current !== null) {
      e.preventDefault()
      const start = Math.min(lastClickedIndex.current, index)
      const end = Math.max(lastClickedIndex.current, index)
      const ids = new Set(selectedProducts)
      for (let i = start; i <= end; i++) {
        ids.add(filtered[i].productId)
      }
      setSelectedProducts(ids)
    } else {
      const ids = new Set(selectedProducts)
      if (ids.has(id)) ids.delete(id)
      else ids.add(id)
      setSelectedProducts(ids)
    }
    lastClickedIndex.current = index
  }

  function toggleAll() {
    if (selectedProducts.size === filtered.length && filtered.length > 0) {
      setSelectedProducts(new Set())
    } else {
      setSelectedProducts(new Set(filtered.map(p => p.productId)))
    }
  }

  async function bulkAssignSupplier() {
    if (selectedProducts.size === 0 || !bulkSupplierId) return
    setBulkAssigning(true)
    try {
      await fetch('/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedProducts), supplier_id: parseInt(bulkSupplierId) }),
      })
      setSelectedProducts(new Set())
      setBulkSupplierId('')
      lastClickedIndex.current = null
      loadData()
    } finally {
      setBulkAssigning(false)
    }
  }

  async function ignoreSelected() {
    if (selectedProducts.size === 0) return
    setBulkAssigning(true)
    try {
      await fetch('/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedProducts), active: 0 }),
      })
      setSelectedProducts(new Set())
      lastClickedIndex.current = null
      loadData()
    } finally {
      setBulkAssigning(false)
    }
  }

  async function restoreProducts(ids: number[]) {
    await fetch('/api/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, active: 1 }),
    })
    loadData()
  }

  const summary = useMemo(() => ({
    total: products.length,
    withSupplier: products.filter(p => p.supplierId !== null).length,
    withoutSupplier: products.filter(p => p.supplierId === null).length,
    ignored: ignoredProducts.length,
  }), [products, ignoredProducts])

  return (
    <div className="min-h-screen">
      <Nav lastSyncAt={lastSyncAt} lastSyncStatus={lastSyncStatus} onSync={handleSync} syncing={syncing} />

      <main className="max-w-[1100px] mx-auto px-6 py-6">
        {/* Summary */}
        <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5 mb-4">
          <div className="flex items-center gap-8">
            <div>
              <p className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-0.5">Totaal</p>
              <p className="text-[22px] font-bold text-text-primary tracking-tight leading-none tabular-nums">{summary.total}</p>
            </div>
            <div>
              <p className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-0.5">Met fabrikant</p>
              <p className="text-[22px] font-bold text-success tracking-tight leading-none tabular-nums">{summary.withSupplier}</p>
            </div>
            <div>
              <p className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-0.5">Zonder fabrikant</p>
              <p className="text-[22px] font-bold text-warning tracking-tight leading-none tabular-nums">{summary.withoutSupplier}</p>
            </div>
            <div>
              <p className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-0.5">Genegeerd</p>
              <p className="text-[22px] font-bold text-text-tertiary tracking-tight leading-none tabular-nums">{summary.ignored}</p>
            </div>
          </div>
        </div>

        {/* Search + bulk actions */}
        <div className="flex items-center gap-3 mb-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Zoek op SKU, naam of fabrikant..."
            className="w-64 text-[13px] px-3 py-2 rounded-lg bg-surface-1 border border-border-subtle text-text-primary outline-none focus:border-accent transition-colors"
          />
          {selectedProducts.size > 0 && (
            <>
              <span className="text-[12px] text-text-secondary font-medium whitespace-nowrap">
                {selectedProducts.size} geselecteerd
              </span>
              <select
                className="text-[13px] px-3 py-1.5 rounded-lg bg-surface-0 border border-border-subtle text-text-primary w-48"
                value={bulkSupplierId}
                onChange={e => setBulkSupplierId(e.target.value)}
              >
                <option value="">Kies fabrikant...</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button
                onClick={bulkAssignSupplier}
                disabled={!bulkSupplierId || bulkAssigning}
                className="text-[12px] font-medium px-4 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-all duration-150"
              >
                Koppelen
              </button>
              <button
                onClick={ignoreSelected}
                disabled={bulkAssigning}
                className="text-[12px] font-medium px-3 py-1.5 rounded-lg text-danger hover:bg-danger/10 transition-all duration-150"
              >
                Negeren
              </button>
            </>
          )}
        </div>

        {loading ? (
          <div className="space-y-1">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="bg-surface-1 rounded-xl border border-border-subtle p-3">
                <div className="flex gap-3"><div className="skeleton h-4 w-20" /><div className="skeleton h-4 w-full" /></div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Header row */}
            <div className="flex items-center gap-3 px-3 py-2 text-[11px] text-text-tertiary font-semibold uppercase tracking-wider">
              <input
                type="checkbox"
                checked={selectedProducts.size === filtered.length && filtered.length > 0}
                onChange={toggleAll}
                className="w-3.5 h-3.5 accent-accent cursor-pointer"
              />
              <span className="w-2" />
              <button onClick={() => handleSort('sku')} className="w-24 text-left hover:text-text-primary transition-colors cursor-pointer">
                SKU<SortArrow col="sku" />
              </button>
              <button onClick={() => handleSort('name')} className="flex-1 text-left hover:text-text-primary transition-colors cursor-pointer">
                Naam<SortArrow col="name" />
              </button>
              <button onClick={() => handleSort('supplier')} className="w-36 text-left hover:text-text-primary transition-colors cursor-pointer">
                Fabrikant<SortArrow col="supplier" />
              </button>
              <button onClick={() => handleSort('stock')} className="w-20 text-right hover:text-text-primary transition-colors cursor-pointer">
                Voorraad<SortArrow col="stock" />
              </button>
            </div>

            {/* Product rows */}
            <div className="space-y-1">
              {filtered.map((p, i) => (
                <div
                  key={p.productId}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors select-none ${
                    selectedProducts.has(p.productId)
                      ? 'bg-accent-subtle border-accent/20'
                      : 'bg-surface-1 border-border-subtle hover:bg-surface-hover'
                  }`}
                  onMouseDown={e => handleProductClick(e, i)}
                >
                  <input
                    type="checkbox"
                    checked={selectedProducts.has(p.productId)}
                    readOnly
                    className="w-3.5 h-3.5 accent-accent cursor-pointer pointer-events-none"
                  />
                  <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[p.status]}`} />
                  <span className="text-text-tertiary font-mono text-[11px] w-24 shrink-0 truncate">{p.sku}</span>
                  <span className="text-text-primary text-[13px] flex-1 truncate">{p.name}</span>
                  <span className="w-36 shrink-0 truncate">
                    {p.supplierName ? (
                      <a
                        href={`/suppliers/${p.supplierId}`}
                        className="text-accent hover:text-accent-hover text-[12px]"
                        onClick={e => e.stopPropagation()}
                        onMouseDown={e => e.stopPropagation()}
                      >
                        {p.supplierName}
                      </a>
                    ) : (
                      <span className="text-text-tertiary text-[12px]">Niet toegewezen</span>
                    )}
                  </span>
                  <span className="w-20 text-right text-[13px] tabular-nums font-medium text-text-primary">{formatNumber(p.currentStock)}</span>
                  <a
                    href={`/products/${p.productId}`}
                    className="text-text-tertiary hover:text-accent text-[12px] shrink-0 transition-colors"
                    onClick={e => e.stopPropagation()}
                    onMouseDown={e => e.stopPropagation()}
                  >
                    &rarr;
                  </a>
                </div>
              ))}
            </div>

            {filtered.length === 0 && (
              <div className="bg-surface-1 rounded-2xl border border-border-subtle p-12 text-center mt-2">
                <p className="text-text-tertiary text-[13px]">Geen producten gevonden.</p>
              </div>
            )}

            {/* Ignored products */}
            {ignoredProducts.length > 0 && (
              <div className="mt-6">
                <button
                  onClick={() => setShowIgnored(!showIgnored)}
                  className="flex items-center gap-2 text-[13px] font-semibold text-text-secondary hover:text-text-primary transition-colors mb-2"
                >
                  <span className="text-[11px]">{showIgnored ? '▼' : '▶'}</span>
                  Genegeerde producten ({ignoredProducts.length})
                </button>
                {showIgnored && (
                  <div className="space-y-1">
                    {ignoredProducts.map(p => (
                      <div
                        key={p.productId}
                        className="flex items-center gap-3 px-3 py-2 rounded-xl bg-surface-1 border border-border-subtle"
                      >
                        <span className="text-text-tertiary font-mono text-[11px] w-24 shrink-0">{p.sku}</span>
                        <span className="text-text-tertiary text-[13px] flex-1 line-through">{p.name}</span>
                        <button
                          onClick={() => restoreProducts([p.productId])}
                          className="text-[12px] font-medium px-3 py-1 rounded-lg bg-surface-2 border border-border-subtle text-text-secondary hover:text-text-primary transition-all duration-150"
                        >
                          Herstellen
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => restoreProducts(ignoredProducts.map(p => p.productId))}
                      className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-surface-2 border border-border-subtle text-text-secondary hover:text-text-primary transition-all duration-150 mt-1"
                    >
                      Alles herstellen
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
