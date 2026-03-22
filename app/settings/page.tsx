'use client'

import { useEffect, useState } from 'react'
import Nav from '@/components/Nav'

interface Supplier {
  id: number
  name: string
  lead_time_days: number
  contact_info: string | null
  notes: string | null
}

interface ProductStatus {
  productId: number
  sku: string
  name: string
  supplierId: number | null
  supplierName: string | null
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [lastSyncStatus, setLastSyncStatus] = useState('')

  // WooCommerce settings
  const [wooUrl, setWooUrl] = useState('')
  const [wooConsumerKey, setWooConsumerKey] = useState('')
  const [wooConsumerSecret, setWooConsumerSecret] = useState('')
  const [hasWooSecret, setHasWooSecret] = useState(false)
  const [wooSaving, setWooSaving] = useState(false)
  const [wooMsg, setWooMsg] = useState('')

  // Stock settings
  const [warehouseInboundDays, setWarehouseInboundDays] = useState('14')
  const [safetyMarginDays, setSafetyMarginDays] = useState('7')
  const [stockSaving, setStockSaving] = useState(false)
  const [stockMsg, setStockMsg] = useState('')

  // Suppliers
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [editingSupplier, setEditingSupplier] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ name: '', lead_time_days: '', contact_info: '', notes: '' })
  const [newSupplier, setNewSupplier] = useState({ name: '', lead_time_days: '', contact_info: '', notes: '' })
  const [supplierSaving, setSupplierSaving] = useState(false)

  // Sync
  const [historicalSyncing, setHistoricalSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  // Products without supplier
  const [unassignedProducts, setUnassignedProducts] = useState<ProductStatus[]>([])
  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set())
  const [bulkSupplierId, setBulkSupplierId] = useState<string>('')
  const [bulkAssigning, setBulkAssigning] = useState(false)

  function loadData() {
    setLoading(true)
    Promise.all([
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/suppliers').then(r => r.json()),
      fetch('/api/products').then(r => r.json()),
    ]).then(([settData, suppData, prodData]) => {
      const settings = settData.settings || {}
      setLastSyncAt(settings.last_sync_at || '')
      setLastSyncStatus(settings.last_sync_status || '')
      setWooUrl(settings.woo_url || '')
      setWooConsumerKey(settings.woo_consumer_key || '')
      setHasWooSecret(settings.has_woo_consumer_secret === '1')
      setWarehouseInboundDays(settings.warehouse_inbound_days || '14')
      setSafetyMarginDays(settings.safety_margin_days || '7')

      setSuppliers(suppData || [])

      const products: ProductStatus[] = (prodData.products || prodData || [])
      setUnassignedProducts(products.filter((p: ProductStatus) => p.supplierId === null))
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

  // WooCommerce save
  async function saveWooSettings() {
    setWooSaving(true)
    setWooMsg('')
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { woo_url: wooUrl, woo_consumer_key: wooConsumerKey } }),
      })
      if (wooConsumerSecret) {
        await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'woo_consumer_secret', value: wooConsumerSecret }),
        })
        setHasWooSecret(true)
        setWooConsumerSecret('')
      }
      setWooMsg('Opgeslagen')
      setTimeout(() => setWooMsg(''), 3000)
    } finally {
      setWooSaving(false)
    }
  }

  // Stock settings save
  async function saveStockSettings() {
    setStockSaving(true)
    setStockMsg('')
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { warehouse_inbound_days: warehouseInboundDays, safety_margin_days: safetyMarginDays } }),
      })
      setStockMsg('Opgeslagen')
      setTimeout(() => setStockMsg(''), 3000)
    } finally {
      setStockSaving(false)
    }
  }

  // Test connection
  async function testConnection() {
    await saveWooSettings()
    setSyncing(true)
    setSyncMsg('')
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'daily' }),
      })
      const data = await res.json()
      if (data.success) {
        setSyncMsg('Verbinding geslaagd')
      } else {
        setSyncMsg('Fout: ' + (data.error || 'onbekend'))
      }
      loadData()
    } catch {
      setSyncMsg('Verbinding mislukt')
    } finally {
      setSyncing(false)
    }
  }

  // Suppliers CRUD
  async function addSupplier() {
    if (!newSupplier.name || !newSupplier.lead_time_days) return
    setSupplierSaving(true)
    try {
      await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSupplier.name,
          lead_time_days: parseInt(newSupplier.lead_time_days),
          contact_info: newSupplier.contact_info || null,
          notes: newSupplier.notes || null,
        }),
      })
      setNewSupplier({ name: '', lead_time_days: '', contact_info: '', notes: '' })
      loadData()
    } finally {
      setSupplierSaving(false)
    }
  }

  async function saveSupplier(id: number) {
    setSupplierSaving(true)
    try {
      await fetch('/api/suppliers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: editForm.name,
          lead_time_days: parseInt(editForm.lead_time_days),
          contact_info: editForm.contact_info || null,
          notes: editForm.notes || null,
        }),
      })
      setEditingSupplier(null)
      loadData()
    } finally {
      setSupplierSaving(false)
    }
  }

  async function deleteSupplier(id: number) {
    if (!confirm('Weet je zeker dat je deze fabrikant wilt verwijderen?')) return
    await fetch('/api/suppliers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    loadData()
  }

  function startEdit(s: Supplier) {
    setEditingSupplier(s.id)
    setEditForm({
      name: s.name,
      lead_time_days: String(s.lead_time_days),
      contact_info: s.contact_info || '',
      notes: s.notes || '',
    })
  }

  // Historical sync
  async function runHistoricalSync() {
    if (!confirm('Dit kan lang duren — 3 jaar aan orders worden geimporteerd. Doorgaan?')) return
    setHistoricalSyncing(true)
    setSyncMsg('')
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'historical' }),
      })
      const data = await res.json()
      setSyncMsg(data.message || 'Historische import gestart')
      loadData()
    } catch {
      setSyncMsg('Fout bij historische import')
    } finally {
      setHistoricalSyncing(false)
    }
  }

  // Bulk assign supplier to products
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
      loadData()
    } finally {
      setBulkAssigning(false)
    }
  }

  function toggleProduct(id: number) {
    setSelectedProducts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllProducts() {
    if (selectedProducts.size === unassignedProducts.length) {
      setSelectedProducts(new Set())
    } else {
      setSelectedProducts(new Set(unassignedProducts.map(p => p.productId)))
    }
  }

  const inputClass = 'w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary outline-none focus:border-accent transition-colors'
  const labelClass = 'text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1'
  const primaryBtn = 'text-[12px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-all duration-150'
  const secondaryBtn = 'text-[12px] font-medium px-3 py-1.5 rounded-lg bg-surface-2 border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-all duration-150'
  const dangerBtn = 'text-[12px] font-medium text-danger hover:bg-danger/10 px-2 py-1 rounded-lg transition-all duration-150'

  return (
    <div className="min-h-screen">
      <Nav lastSyncAt={lastSyncAt} lastSyncStatus={lastSyncStatus} onSync={handleSync} syncing={syncing} />

      <main className="max-w-[1100px] mx-auto px-6 py-6">
        {loading ? (
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-surface-1 rounded-2xl border border-border-subtle p-5">
                <div className="skeleton h-5 w-48 mb-3" />
                <div className="skeleton h-9 w-full mb-2" />
                <div className="skeleton h-9 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {/* 1. WooCommerce verbinding */}
            <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5">
              <h2 className="text-[14px] font-semibold text-text-primary mb-3">WooCommerce verbinding</h2>
              <div className="grid grid-cols-1 gap-3 mb-3">
                <div>
                  <label className={labelClass}>URL</label>
                  <input
                    type="url"
                    className={inputClass}
                    value={wooUrl}
                    onChange={e => setWooUrl(e.target.value)}
                    placeholder="https://jouwwinkel.nl"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Consumer Key</label>
                    <input
                      type="text"
                      className={inputClass}
                      value={wooConsumerKey}
                      onChange={e => setWooConsumerKey(e.target.value)}
                      placeholder="ck_..."
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Consumer Secret</label>
                    <input
                      type="password"
                      className={inputClass}
                      value={wooConsumerSecret}
                      onChange={e => setWooConsumerSecret(e.target.value)}
                      placeholder={hasWooSecret ? 'Bewaard (typ om te wijzigen)' : 'cs_...'}
                    />
                    {hasWooSecret && !wooConsumerSecret && (
                      <span className="text-success text-[12px] mt-0.5 block">Bewaard</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className={primaryBtn} disabled={wooSaving} onClick={saveWooSettings}>
                  {wooSaving ? 'Opslaan...' : 'Opslaan'}
                </button>
                <button className={secondaryBtn} disabled={syncing} onClick={testConnection}>
                  {syncing ? 'Testen...' : 'Test verbinding'}
                </button>
                {wooMsg && <span className="text-success text-[12px]">{wooMsg}</span>}
              </div>
            </div>

            {/* 2. Fabrikanten */}
            <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5">
              <h2 className="text-[14px] font-semibold text-text-primary mb-3">Fabrikanten</h2>

              {/* Existing suppliers */}
              {suppliers.length > 0 && (
                <div className="space-y-2 mb-4">
                  {suppliers.map(s => (
                    <div key={s.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface-0 border border-border-subtle">
                      {editingSupplier === s.id ? (
                        <>
                          <input
                            className={`${inputClass} !w-auto flex-1`}
                            value={editForm.name}
                            onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                            placeholder="Naam"
                          />
                          <input
                            type="number"
                            className={`${inputClass} !w-20`}
                            value={editForm.lead_time_days}
                            onChange={e => setEditForm({ ...editForm, lead_time_days: e.target.value })}
                            placeholder="Dagen"
                          />
                          <input
                            className={`${inputClass} !w-auto flex-1`}
                            value={editForm.contact_info}
                            onChange={e => setEditForm({ ...editForm, contact_info: e.target.value })}
                            placeholder="Contact"
                          />
                          <button className={primaryBtn} disabled={supplierSaving} onClick={() => saveSupplier(s.id)}>Opslaan</button>
                          <button className={secondaryBtn} onClick={() => setEditingSupplier(null)}>Annuleren</button>
                        </>
                      ) : (
                        <>
                          <span className="text-text-primary text-[13px] font-medium flex-1">{s.name}</span>
                          <span className="text-text-secondary text-[12px]">{s.lead_time_days} dagen</span>
                          {s.contact_info && <span className="text-text-tertiary text-[12px]">{s.contact_info}</span>}
                          <button className={secondaryBtn} onClick={() => startEdit(s)}>Bewerken</button>
                          <button className={dangerBtn} onClick={() => deleteSupplier(s.id)}>Verwijderen</button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add supplier form */}
              <div className="p-3 rounded-lg bg-surface-0 border border-border-subtle">
                <p className="text-[12px] text-text-tertiary font-medium mb-2">Fabrikant toevoegen</p>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  <div>
                    <label className={labelClass}>Naam</label>
                    <input
                      className={inputClass}
                      value={newSupplier.name}
                      onChange={e => setNewSupplier({ ...newSupplier, name: e.target.value })}
                      placeholder="Naam"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Levertijd (dagen)</label>
                    <input
                      type="number"
                      className={inputClass}
                      value={newSupplier.lead_time_days}
                      onChange={e => setNewSupplier({ ...newSupplier, lead_time_days: e.target.value })}
                      placeholder="30"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Contact</label>
                    <input
                      className={inputClass}
                      value={newSupplier.contact_info}
                      onChange={e => setNewSupplier({ ...newSupplier, contact_info: e.target.value })}
                      placeholder="E-mail of telefoon"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Notities</label>
                    <input
                      className={inputClass}
                      value={newSupplier.notes}
                      onChange={e => setNewSupplier({ ...newSupplier, notes: e.target.value })}
                      placeholder="Optioneel"
                    />
                  </div>
                </div>
                <button
                  className={primaryBtn}
                  disabled={supplierSaving || !newSupplier.name || !newSupplier.lead_time_days}
                  onClick={addSupplier}
                >
                  Toevoegen
                </button>
              </div>
            </div>

            {/* 3. Voorraad instellingen */}
            <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5">
              <h2 className="text-[14px] font-semibold text-text-primary mb-3">Voorraad instellingen</h2>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={labelClass}>Warehouse inbound tijd (dagen)</label>
                  <input
                    type="number"
                    className={inputClass}
                    value={warehouseInboundDays}
                    onChange={e => setWarehouseInboundDays(e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>Veiligheidsmarge (dagen)</label>
                  <input
                    type="number"
                    className={inputClass}
                    value={safetyMarginDays}
                    onChange={e => setSafetyMarginDays(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className={primaryBtn} disabled={stockSaving} onClick={saveStockSettings}>
                  {stockSaving ? 'Opslaan...' : 'Opslaan'}
                </button>
                {stockMsg && <span className="text-success text-[12px]">{stockMsg}</span>}
              </div>
            </div>

            {/* 4. Data */}
            <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5">
              <h2 className="text-[14px] font-semibold text-text-primary mb-3">Data</h2>
              <div className="mb-3">
                <p className="text-text-secondary text-[13px]">
                  Laatste sync: {lastSyncAt ? (
                    <>
                      <span className="font-medium">{new Date(lastSyncAt).toLocaleString('nl-NL')}</span>
                      {' \u2014 '}
                      <span className={lastSyncStatus === 'success' ? 'text-success' : 'text-danger'}>{lastSyncStatus}</span>
                    </>
                  ) : (
                    <span className="text-text-tertiary">Nog niet gesynchroniseerd</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button className={primaryBtn} disabled={syncing} onClick={handleSync}>
                  {syncing ? 'Synchroniseren...' : 'Handmatige sync'}
                </button>
                <button className={secondaryBtn} disabled={historicalSyncing} onClick={runHistoricalSync}>
                  {historicalSyncing ? 'Importeren...' : 'Historische import'}
                </button>
              </div>
              {syncMsg && (
                <p className={`mt-2 text-[12px] ${syncMsg.startsWith('Fout') || syncMsg.startsWith('Verbinding mislukt') ? 'text-danger' : 'text-success'}`}>
                  {syncMsg}
                </p>
              )}
              <p className="text-warning text-[12px] mt-2">
                Historische import kan lang duren — 3 jaar aan orders worden geimporteerd.
              </p>
            </div>

            {/* 5. Product-fabrikant koppeling */}
            {unassignedProducts.length > 0 && (
              <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5">
                <h2 className="text-[14px] font-semibold text-text-primary mb-3">
                  Product-fabrikant koppeling
                  <span className="text-text-tertiary font-normal ml-2">({unassignedProducts.length} zonder fabrikant)</span>
                </h2>

                {/* Bulk assign bar */}
                <div className="flex items-center gap-3 mb-3 p-3 rounded-xl bg-surface-0 border border-border-subtle">
                  <span className="text-[12px] text-text-secondary">
                    {selectedProducts.size > 0
                      ? `${selectedProducts.size} geselecteerd`
                      : 'Selecteer producten'}
                  </span>
                  <div className="flex-1" />
                  <select
                    className={`${inputClass} !w-48`}
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
                    disabled={selectedProducts.size === 0 || !bulkSupplierId || bulkAssigning}
                    className={primaryBtn}
                  >
                    {bulkAssigning ? 'Koppelen...' : 'Koppelen'}
                  </button>
                </div>

                {/* Select all */}
                <div className="flex items-center gap-2 mb-2 px-2">
                  <input
                    type="checkbox"
                    checked={selectedProducts.size === unassignedProducts.length && unassignedProducts.length > 0}
                    onChange={toggleAllProducts}
                    className="w-3.5 h-3.5 accent-accent cursor-pointer"
                  />
                  <span className="text-[11px] text-text-tertiary font-semibold uppercase tracking-wider">Alles selecteren</span>
                </div>

                <div className="space-y-1">
                  {unassignedProducts.map(p => (
                    <label
                      key={p.productId}
                      className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${
                        selectedProducts.has(p.productId)
                          ? 'bg-accent-subtle border-accent/20'
                          : 'bg-surface-0 border-border-subtle hover:bg-surface-hover'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedProducts.has(p.productId)}
                        onChange={() => toggleProduct(p.productId)}
                        className="w-3.5 h-3.5 accent-accent cursor-pointer"
                      />
                      <span className="text-text-tertiary font-mono text-[11px] w-20">{p.sku}</span>
                      <span className="text-text-primary text-[13px] flex-1">{p.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
