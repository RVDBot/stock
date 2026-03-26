'use client'

import { useEffect, useState, use } from 'react'
import Nav from '@/components/Nav'
import { apiFetch } from '@/lib/api'

interface TemplateField {
  name: string
  type: 'text' | 'number' | 'select' | 'fixed' | 'price'
  unit?: string
  options?: string[]
  fixedValue?: string
  currency?: string
  shared: boolean
}

interface SpecTemplate {
  id: number
  supplier_id: number
  name: string
  fields: string // JSON
}

interface Product {
  id: number
  sku: string
  name: string
  current_stock: number
  price: number
  supplier_id: number | null
  supplier_name: string | null
  spec_template_id: number | null
  template_name: string | null
  template_fields: string | null
  specs: string
}

function formatNumber(n: number): string {
  return n.toLocaleString('nl-NL')
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [product, setProduct] = useState<Product | null>(null)
  const [templates, setTemplates] = useState<SpecTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [lastSyncStatus, setLastSyncStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null)
  const [specs, setSpecs] = useState<Record<string, string>>({})

  function loadData() {
    setLoading(true)
    Promise.all([
      apiFetch(`/api/products?id=${id}`).then(r => r.json()),
      apiFetch('/api/settings').then(r => r.json()),
    ]).then(([productData, settData]) => {
      if (productData.error) {
        setProduct(null)
      } else {
        const p = productData as Product
        setProduct(p)
        setSelectedTemplateId(p.spec_template_id)
        try {
          setSpecs(JSON.parse(p.specs || '{}'))
        } catch {
          setSpecs({})
        }
        // Load templates for this supplier
        if (p.supplier_id) {
          apiFetch(`/api/spec-templates?supplier_id=${p.supplier_id}`).then(r => r.json()).then(t => {
            setTemplates(Array.isArray(t) ? t : [])
          })
        }
      }
      const settings = settData.settings || {}
      setLastSyncAt(settings.last_sync_at || '')
      setLastSyncStatus(settings.last_sync_status || '')
    }).finally(() => setLoading(false))
  }

  async function handleSync() {
    setSyncing(true)
    try {
      await apiFetch('/api/sync', {
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

  function getFields(): TemplateField[] {
    // Use selected template or product's current template
    const templateId = selectedTemplateId
    const template = templates.find(t => t.id === templateId)
    if (template) {
      try {
        return JSON.parse(template.fields)
      } catch {
        return []
      }
    }
    // Fallback to product's stored template fields
    if (product?.template_fields) {
      try {
        return JSON.parse(product.template_fields)
      } catch {
        return []
      }
    }
    return []
  }

  async function handleSave() {
    setSaving(true)
    try {
      await apiFetch('/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: parseInt(id, 10),
          spec_template_id: selectedTemplateId,
          specs,
        }),
      })
      loadData()
    } finally {
      setSaving(false)
    }
  }

  function handleTemplateChange(templateId: number | null) {
    setSelectedTemplateId(templateId)
    // Keep existing specs values that match new template fields
  }

  function handleCopyForSupplier() {
    if (!product) return
    const fields = getFields()
    const sharedFields = fields.filter(f => f.shared)

    let text = `${product.sku} — ${product.name}\n`
    for (const field of sharedFields) {
      if (field.type === 'fixed') {
        if (field.fixedValue) text += `${field.name}: ${field.fixedValue}\n`
        continue
      }
      const value = specs[field.name] || ''
      if (value) {
        if (field.type === 'price') {
          const symbol = field.currency === 'USD' ? '$' : field.currency === 'GBP' ? '£' : field.currency === 'CNY' ? '¥' : '€'
          text += `${field.name}: ${symbol}${value}\n`
        } else {
          text += `${field.name}: ${value}${field.unit ? ' ' + field.unit : ''}\n`
        }
      }
    }

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const fields = getFields()
  const hasSharedFields = fields.some(f => f.shared && specs[f.name])

  const inputClass = 'w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary outline-none focus:border-accent transition-colors'
  const labelClass = 'text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1'

  return (
    <div className="min-h-screen">
      <Nav lastSyncAt={lastSyncAt} lastSyncStatus={lastSyncStatus} onSync={handleSync} syncing={syncing} />

      <main className="max-w-[1100px] mx-auto px-6 py-6">
        {loading ? (
          <div className="space-y-3">
            <div className="skeleton h-6 w-48 mb-2" />
            <div className="skeleton h-4 w-32 mb-4" />
            <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5">
              <div className="skeleton h-40 w-full" />
            </div>
          </div>
        ) : !product ? (
          <div className="bg-surface-1 rounded-2xl border border-border-subtle p-16 text-center">
            <p className="text-text-primary text-[14px] font-semibold mb-1">Product niet gevonden</p>
            <a href="/products" className="text-accent hover:text-accent-hover text-[13px]">Terug naar overzicht</a>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="mb-4">
              <a href="/products" className="text-accent hover:text-accent-hover text-[12px] mb-2 inline-block">&larr; Producten</a>
              <h1 className="text-[18px] font-semibold text-text-primary">{product.name}</h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-secondary mt-1">
                <span className="font-mono text-text-tertiary">{product.sku}</span>
                <span>Voorraad: <strong>{formatNumber(product.current_stock)}</strong></span>
                <span>Prijs: <strong>&euro;{product.price.toLocaleString('nl-NL', { minimumFractionDigits: 2 })}</strong></span>
                {product.supplier_name && (
                  <a href={`/suppliers/${product.supplier_id}`} className="text-accent hover:text-accent-hover">
                    {product.supplier_name}
                  </a>
                )}
              </div>
            </div>

            {/* Specs */}
            <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[14px] font-semibold text-text-primary">Productspecificaties</h2>
                <div className="flex items-center gap-2">
                  {hasSharedFields && (
                    <button
                      onClick={handleCopyForSupplier}
                      className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-surface-2 border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-all duration-150"
                    >
                      {copied ? 'Gekopieerd!' : 'Kopieer voor fabrikant'}
                    </button>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="text-[12px] font-medium px-4 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-all duration-150"
                  >
                    {saving ? 'Opslaan...' : 'Opslaan'}
                  </button>
                </div>
              </div>

              {!product.supplier_id ? (
                <p className="text-text-tertiary text-[13px]">Wijs eerst een fabrikant toe om specificaties in te vullen.</p>
              ) : templates.length === 0 ? (
                <div>
                  <p className="text-text-tertiary text-[13px] mb-2">Geen templates beschikbaar voor deze fabrikant.</p>
                  <a
                    href={`/suppliers/${product.supplier_id}`}
                    className="text-accent hover:text-accent-hover text-[13px]"
                  >
                    Maak een template aan bij de fabrikant &rarr;
                  </a>
                </div>
              ) : (
                <>
                  {/* Template selector */}
                  <div className="mb-4">
                    <label className={labelClass}>Template</label>
                    <select
                      value={selectedTemplateId ?? ''}
                      onChange={e => handleTemplateChange(e.target.value ? parseInt(e.target.value, 10) : null)}
                      className={`${inputClass} max-w-xs`}
                    >
                      <option value="">Selecteer template...</option>
                      {templates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Spec fields */}
                  {fields.length > 0 && (
                    <div className="border border-border-subtle rounded-xl overflow-hidden">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-surface-0">
                            <th className="text-left text-[11px] text-text-tertiary font-semibold uppercase tracking-wider px-4 py-2.5 w-48">Veld</th>
                            <th className="text-left text-[11px] text-text-tertiary font-semibold uppercase tracking-wider px-4 py-2.5">Waarde</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fields.map((field, i) => (
                            <tr
                              key={field.name}
                              className={`border-t border-border-subtle ${i % 2 === 0 ? '' : 'bg-surface-0/50'}`}
                            >
                              <td className="px-4 py-2.5 align-middle">
                                <div className="flex items-center gap-2">
                                  <span className="text-text-primary text-[13px]">{field.name}</span>
                                  {field.unit && <span className="text-text-tertiary text-[11px]">({field.unit})</span>}
                                  {!field.shared && (
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-2 text-text-tertiary border border-border-subtle" title="Niet gedeeld met fabrikant">
                                      intern
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                {field.type === 'fixed' ? (
                                  <span className="text-text-secondary text-[13px]">{field.fixedValue || '—'}</span>
                                ) : field.type === 'price' ? (
                                  <div className="flex items-center gap-1 max-w-sm">
                                    <span className="text-text-tertiary text-[13px]">{field.currency === 'USD' ? '$' : field.currency === 'GBP' ? '£' : field.currency === 'CNY' ? '¥' : '€'}</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={specs[field.name] || ''}
                                      onChange={e => setSpecs(s => ({ ...s, [field.name]: e.target.value }))}
                                      className={`${inputClass} flex-1`}
                                      placeholder="0.00"
                                    />
                                  </div>
                                ) : field.type === 'select' && field.options ? (
                                  <select
                                    value={specs[field.name] || ''}
                                    onChange={e => setSpecs(s => ({ ...s, [field.name]: e.target.value }))}
                                    className={`${inputClass} max-w-sm`}
                                  >
                                    <option value="">—</option>
                                    {field.options.map(opt => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    type={field.type === 'number' ? 'number' : 'text'}
                                    value={specs[field.name] || ''}
                                    onChange={e => setSpecs(s => ({ ...s, [field.name]: e.target.value }))}
                                    className={`${inputClass} max-w-sm`}
                                    placeholder={field.name}
                                  />
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
