'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import FulfilmentMailDialog from '@/components/FulfilmentMailDialog'
import { ORDER_STATUSES, ORDER_STATUS_LABELS, type Order, type OrderStatus } from '@/lib/order-types'

interface Props {
  orders: Order[]
  onEdit: (order: Order) => void
  onChanged: () => void
}

const STATUS_COLORS: Record<OrderStatus, string> = {
  ordered: 'text-accent',
  shipped: 'text-warning',
  received: 'text-success',
}

const formatDate = (d: string) => new Date(d).toLocaleDateString('nl-NL')
const btn = 'text-[12px] font-medium px-3 py-1.5 rounded-lg bg-surface-2 border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-all duration-150'

export default function OrderHistory({ orders, onEdit, onChanged }: Props) {
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [mailOrderId, setMailOrderId] = useState<number | null>(null)
  const visible = filter === 'open' ? orders.filter(o => o.status !== 'received') : orders

  function toggle(id: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function changeStatus(order: Order, status: OrderStatus) {
    await apiFetch('/api/orders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: order.id, status }),
    })
    onChanged()
  }

  async function remove(order: Order) {
    if (!confirm(`Bestelling #${order.id} verwijderen?`)) return
    await apiFetch('/api/orders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: order.id }),
    })
    onChanged()
  }

  return (
    <div>
      {mailOrderId !== null && <FulfilmentMailDialog orderId={mailOrderId} onClose={() => setMailOrderId(null)} />}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[14px] font-semibold text-text-primary">Bestellingen ({visible.length})</h2>
        <div className="flex gap-1">
          {(['open', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[12px] font-medium px-3 py-1 rounded-lg transition-colors ${
                filter === f ? 'bg-surface-3 text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {f === 'open' ? 'Openstaand' : 'Alles'}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="bg-surface-1 rounded-2xl border border-border-subtle p-12 text-center">
          <p className="text-text-tertiary text-[13px]">
            {orders.length === 0 ? 'Nog geen bestellingen geregistreerd.' : 'Geen openstaande bestellingen.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((o, i) => {
            const totalQty = o.lines.reduce((s, l) => s + l.quantity, 0)
            const unassigned = o.lines.filter(l => l.product_id === null).length
            const isOpen = expanded.has(o.id)
            return (
              <div
                key={o.id}
                className="bg-surface-1 rounded-2xl border border-border-subtle p-4 animate-row"
                style={{ animationDelay: `${Math.min(i * 20, 400)}ms` }}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button onClick={() => toggle(o.id)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-text-tertiary text-[11px]">{isOpen ? '▾' : '▸'}</span>
                      <span className="text-text-primary text-[13px] font-semibold">
                        #{o.id}{o.supplier_ref && ` — ${o.supplier_ref}`}
                      </span>
                      <span className={`text-[11px] font-semibold ${STATUS_COLORS[o.status]}`}>{ORDER_STATUS_LABELS[o.status]}</span>
                      {unassigned > 0 && (
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-warning/10 text-warning border border-warning/20">
                          {unassigned} {unassigned === 1 ? 'regel' : 'regels'} nog toewijzen
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-secondary ml-4">
                      <span>Besteld: {formatDate(o.order_date)}</span>
                      <span>{o.lines.length} {o.lines.length === 1 ? 'regel' : 'regels'}, {totalQty.toLocaleString('nl-NL')} stuks</span>
                      {o.expected_arrival && <span>Verwacht: {formatDate(o.expected_arrival)}</span>}
                      {o.notes && <span className="text-text-tertiary">{o.notes}</span>}
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <select
                      value={o.status}
                      onChange={e => changeStatus(o, e.target.value as OrderStatus)}
                      className="text-[12px] px-2 py-1.5 rounded-lg bg-surface-0 border border-border-subtle text-text-primary"
                    >
                      {ORDER_STATUSES.map(s => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
                    </select>
                    <button onClick={() => setMailOrderId(o.id)} className={btn}>Mail fulfilment</button>
                    <button onClick={() => onEdit(o)} className={btn}>Bewerken</button>
                    <button
                      onClick={() => remove(o)}
                      className="text-[12px] font-medium px-3 py-1.5 rounded-lg text-danger hover:bg-danger/10 transition-all duration-150"
                    >
                      Verwijder
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div className="mt-3 ml-4 space-y-1">
                    {o.lines.map(l => (
                      <div key={l.id} className="flex flex-wrap items-center gap-x-3 text-[12px]">
                        {l.product_id === null
                          ? <span className="text-warning font-medium">Nog niet toegewezen</span>
                          : <span className="text-text-primary">{l.sku} — {l.name}</span>}
                        <span className="text-text-secondary tabular-nums">{l.quantity.toLocaleString('nl-NL')} stuks</span>
                        {(l.supplier_code || l.supplier_description) && (
                          <span className="text-text-tertiary">({[l.supplier_code, l.supplier_description].filter(Boolean).join(' · ')})</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
