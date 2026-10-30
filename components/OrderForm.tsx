'use client'

import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { prepareImageForUpload } from '@/lib/image-resize'
import type { ImportResult, MatchKind, Order } from '@/lib/order-types'

interface ProductOption { productId: number; sku: string; name: string }

interface LineState {
  key: string
  product_id: number | '' | 'later' // 'later' = product not in WooCommerce yet, assign afterwards
  quantity: string
  supplier_code: string | null
  supplier_description: string | null
  match: MatchKind | null // null = added by hand
  suggested_product_id: number | null
  manualDescription: boolean // no supplier text from a document, so the user types it when assigning later
}

interface Props {
  supplierId: number
  products: ProductOption[]
  order?: Order
  onSaved: () => void
  onCancel: () => void
}

const MATCH_STYLES: Record<MatchKind, { dot: string; label: string }> = {
  memory: { dot: 'bg-success', label: 'Uit geheugen' },
  confident: { dot: 'bg-success/60', label: 'Gekoppeld' },
  uncertain: { dot: 'bg-warning', label: 'Controleren' },
  none: { dot: 'bg-danger', label: 'Kies product' },
}

const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf'
let keySeq = 0
const newKey = () => `l${++keySeq}`

function emptyLine(): LineState {
  return { key: newKey(), product_id: '', quantity: '', supplier_code: null, supplier_description: null, match: null, suggested_product_id: null, manualDescription: true }
}

const inputClass = 'w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary'
const labelClass = 'text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1'

export default function OrderForm({ supplierId, products, order, onSaved, onCancel }: Props) {
  const today = new Date().toISOString().split('T')[0]
  const [orderDate, setOrderDate] = useState(order?.order_date || today)
  const [supplierRef, setSupplierRef] = useState(order?.supplier_ref || '')
  const [arrival, setArrival] = useState(order?.expected_arrival || '')
  const [notes, setNotes] = useState(order?.notes || '')
  const [lines, setLines] = useState<LineState[]>(() => order
    ? order.lines.map(l => ({ key: newKey(), product_id: l.product_id ?? 'later', quantity: String(l.quantity), supplier_code: l.supplier_code, supplier_description: l.supplier_description, match: null, suggested_product_id: l.product_id, manualDescription: !l.supplier_code }))
    : [emptyLine()])
  const [analyzing, setAnalyzing] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'warn' | 'info'; text: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const sortedProducts = [...products].sort((a, b) => a.name.localeCompare(b.name, 'nl'))
  // Products that exist in WooCommerce but are not published (e.g. disabled variations)
  const [unpublished, setUnpublished] = useState<ProductOption[]>([])
  useEffect(() => {
    apiFetch(`/api/products?unpublished_for=${supplierId}`).then(r => r.json())
      .then(data => setUnpublished(Array.isArray(data) ? data : []))
      .catch(() => setUnpublished([]))
  }, [supplierId])

  async function analyze(raw: File) {
    setMessage(null)
    setAnalyzing(true)
    try {
      const file = await prepareImageForUpload(raw)
      const body = new FormData()
      body.append('supplier_id', String(supplierId))
      body.append('file', file)
      const res = await apiFetch('/api/orders/import', { method: 'POST', body })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ kind: 'error', text: data.error || 'Analyse mislukt' })
        return
      }
      const result = data as ImportResult
      if (result.order_date) setOrderDate(result.order_date)
      if (result.supplier_ref) setSupplierRef(result.supplier_ref)
      if (result.lines.length === 0) {
        setLines([emptyLine()])
        setMessage({ kind: 'warn', text: 'Geen regels gevonden in het document. Vul de bestelling handmatig in.' })
        return
      }
      setLines(result.lines.map(l => ({
        key: newKey(),
        product_id: l.product_id ?? '',
        quantity: l.quantity > 0 ? String(l.quantity) : '',
        supplier_code: l.supplier_code,
        supplier_description: l.supplier_description,
        match: l.match,
        suggested_product_id: l.product_id,
        manualDescription: false,
      })))
      const open = result.lines.filter(l => l.match === 'none' || l.match === 'uncertain').length
      if (result.truncated) {
        setMessage({ kind: 'warn', text: 'Het antwoord is afgekapt, mogelijk ontbreken regels. Verhoog "max tokens" voor "Bestelling uit document" in Instellingen.' })
      } else if (open > 0) {
        setMessage({ kind: 'info', text: `${result.lines.length} regels gevonden, ${open} om te controleren.` })
      } else {
        setMessage({ kind: 'info', text: `${result.lines.length} regels gevonden.` })
      }
    } catch {
      setMessage({ kind: 'error', text: 'Analyse mislukt. Probeer het opnieuw.' })
    } finally {
      setAnalyzing(false)
    }
  }

  // Paste a screenshot straight from the clipboard (new orders only)
  useEffect(() => {
    if (order) return
    function onPaste(e: ClipboardEvent) {
      const file = Array.from(e.clipboardData?.files || []).find(f => ACCEPT.split(',').includes(f.type))
      if (!file) return
      e.preventDefault()
      analyze(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, supplierId])

  function updateLine(key: string, patch: Partial<LineState>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }

  const lineComplete = (l: LineState) => parseInt(l.quantity, 10) >= 1 &&
    (typeof l.product_id === 'number' || (l.product_id === 'later' && !!(l.supplier_code || l.supplier_description?.trim())))
  const canSave = lines.length > 0 && lines.every(lineComplete) && !saving && !analyzing

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    setMessage(null)
    try {
      const payload = {
        ...(order ? { id: order.id } : {}),
        supplier_id: supplierId,
        order_date: orderDate,
        supplier_ref: supplierRef,
        expected_arrival: arrival,
        notes,
        lines: lines.map(l => ({
          product_id: typeof l.product_id === 'number' ? l.product_id : null,
          quantity: parseInt(l.quantity, 10),
          supplier_code: l.supplier_code,
          supplier_description: l.supplier_description,
          // Remember when the user picked or changed the product for a supplier line
          remember: typeof l.product_id === 'number' && !!(l.supplier_code || l.supplier_description) && l.product_id !== l.suggested_product_id,
        })),
      }
      const res = await apiFetch('/api/orders', {
        method: order ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setMessage({ kind: 'error', text: data.error || 'Opslaan mislukt' })
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const messageColor = message?.kind === 'error' ? 'text-danger' : message?.kind === 'warn' ? 'text-warning' : 'text-text-secondary'

  return (
    <div className="bg-surface-1 rounded-2xl border border-border-subtle p-4 mb-4 animate-row">
      <h3 className="text-[14px] font-semibold text-text-primary mb-3">{order ? `Bestelling #${order.id} bewerken` : 'Nieuwe bestelling'}</h3>

      {!order && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) analyze(f) }}
          onClick={() => !analyzing && fileInput.current?.click()}
          className={`mb-4 rounded-xl border border-dashed px-4 py-5 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-accent bg-accent/5' : 'border-border-subtle hover:bg-surface-2'
          }`}
        >
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) analyze(f); e.target.value = '' }}
          />
          {analyzing ? (
            <p className="text-[13px] text-text-secondary">Document analyseren…</p>
          ) : (
            <>
              <p className="text-[13px] text-text-primary font-medium">Sleep een screenshot of pdf hierheen, plak (⌘V) of klik om te kiezen</p>
              <p className="text-[12px] text-text-tertiary mt-0.5">Claude zet de bestelling voor je klaar. Png, jpg, webp of pdf, max 10 MB.</p>
            </>
          )}
        </div>
      )}

      {message && <p className={`text-[12px] mb-3 ${messageColor}`}>{message.text}</p>}

      <form onSubmit={handleSave}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div>
            <label className={labelClass}>Besteldatum</label>
            <input type="date" required value={orderDate} onChange={e => setOrderDate(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Ordernummer fabrikant</label>
            <input type="text" value={supplierRef} onChange={e => setSupplierRef(e.target.value)} className={inputClass} placeholder="Optioneel" />
          </div>
          <div>
            <label className={labelClass}>Verwachte aankomst</label>
            <input type="date" value={arrival} onChange={e => setArrival(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Notities</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} className={inputClass} placeholder="Optioneel" />
          </div>
        </div>

        <div className="space-y-2 mb-3">
          {lines.map(l => {
            const later = l.product_id === 'later'
            const style = later ? { dot: 'bg-warning', label: 'Later toewijzen' } : l.match ? MATCH_STYLES[l.match] : null
            const changed = !later && l.match && l.product_id !== '' && l.product_id !== l.suggested_product_id
            return (
              <div key={l.key} className="flex flex-wrap items-center gap-2 bg-surface-0 rounded-xl border border-border-subtle px-3 py-2">
                {style && (
                  <span className="flex items-center gap-1.5 w-28 shrink-0" title={style.label}>
                    <span className={`w-2 h-2 rounded-full ${changed ? 'bg-accent' : style.dot}`} />
                    <span className="text-[11px] text-text-tertiary">{changed ? 'Aangepast' : style.label}</span>
                  </span>
                )}
                {later && l.manualDescription ? (
                  <input
                    type="text"
                    value={l.supplier_description ?? ''}
                    onChange={e => updateLine(l.key, { supplier_description: e.target.value })}
                    className={`${inputClass} flex-1 basis-48 ${l.supplier_description?.trim() ? '' : 'border-danger/50'}`}
                    placeholder="Omschrijving (bijv. Speed Rope PRO 3m groen)"
                  />
                ) : (l.supplier_code || l.supplier_description) && (
                  <span className="text-[12px] text-text-secondary min-w-0 flex-1 basis-48 truncate" title={`${l.supplier_code ?? ''} ${l.supplier_description ?? ''}`}>
                    {l.supplier_code && <span className="font-mono text-text-tertiary mr-1.5">{l.supplier_code}</span>}
                    {l.supplier_description}
                  </span>
                )}
                <select
                  value={l.product_id}
                  onChange={e => {
                    const v = e.target.value
                    updateLine(l.key, { product_id: v === '' || v === 'later' ? v : parseInt(v, 10) })
                  }}
                  className={`${inputClass} flex-1 basis-56 ${l.product_id === '' ? 'border-danger/50' : ''}`}
                >
                  <option value="">Selecteer product...</option>
                  <option value="later">Later toewijzen (nog niet in WooCommerce)</option>
                  {sortedProducts.map(p => (
                    <option key={p.productId} value={p.productId}>{p.sku} — {p.name}</option>
                  ))}
                  {unpublished.length > 0 && (
                    <optgroup label="Niet gepubliceerd in WooCommerce">
                      {unpublished.map(p => (
                        <option key={p.productId} value={p.productId}>{p.sku} — {p.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <input
                  type="number"
                  min="1"
                  value={l.quantity}
                  onChange={e => updateLine(l.key, { quantity: e.target.value })}
                  className={`${inputClass} w-24`}
                  placeholder="Aantal"
                />
                <button
                  type="button"
                  onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))}
                  className="text-[12px] font-medium px-2 py-1.5 rounded-lg text-danger hover:bg-danger/10 transition-all duration-150"
                  title="Regel verwijderen"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setLines(prev => [...prev, emptyLine()])}
            className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-surface-2 border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-all duration-150"
          >
            + Regel toevoegen
          </button>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!canSave}
              className="text-[12px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-all duration-150"
            >
              {saving ? 'Opslaan...' : 'Opslaan'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="text-[12px] font-medium px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle text-text-secondary hover:text-text-primary transition-all duration-150"
            >
              Annuleren
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
