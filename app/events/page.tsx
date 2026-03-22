'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import Nav from '@/components/Nav'

interface Event {
  id: number
  name: string
  expected_date: string | null
  duration_days: number
  impact_percentage: number
  recurring: number
  ai_lookup: number
  ai_skip_months: number
  last_checked_at: string | null
  notes: string | null
  created_at: string
}

interface Peak {
  weekStart: string
  weekEnd: string
  weekNum: number
  totalSales: number
  avgWeeklySales: number
  ratio: number
}

interface EventForm {
  name: string
  expected_date: string
  duration_days: string
  impact_percentage: string
  recurring: boolean
  ai_lookup: boolean
  ai_skip_months: string
  notes: string
}

const EMPTY_FORM: EventForm = {
  name: '',
  expected_date: '',
  duration_days: '7',
  impact_percentage: '100',
  recurring: true,
  ai_lookup: true,
  ai_skip_months: '6',
  notes: '',
}

function formatNumber(n: number): string {
  return n.toLocaleString('nl-NL')
}

function isExpired(date: string | null): boolean {
  if (!date) return false
  return new Date(date) < new Date(new Date().toDateString())
}

function needsAttention(event: Event): boolean {
  if (!event.expected_date) return true
  if (isExpired(event.expected_date) && event.recurring === 1) return true
  return false
}

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [lastSyncStatus, setLastSyncStatus] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<EventForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [filterAttention, setFilterAttention] = useState(false)
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const [peaks, setPeaks] = useState<Record<string, Peak[]>>({})
  const [peaksLoading, setPeaksLoading] = useState(true)
  const formRef = useRef<HTMLDivElement>(null)

  function loadData() {
    setLoading(true)
    Promise.all([
      fetch('/api/events').then(r => r.json()),
      fetch('/api/settings').then(r => r.json()),
    ]).then(([eventsData, settData]) => {
      setEvents(Array.isArray(eventsData) ? eventsData : [])
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

  useEffect(() => { loadData(); loadPeaks() }, [])

  function loadPeaks() {
    setPeaksLoading(true)
    fetch('/api/peaks').then(r => r.json()).then(data => {
      setPeaks(data.peaks || {})
    }).finally(() => setPeaksLoading(false))
  }

  function createEventFromPeak(peak: Peak) {
    setShowForm(true)
    setEditingId(null)
    setForm({
      name: '',
      expected_date: peak.weekStart,
      duration_days: '7',
      impact_percentage: String(Math.round((peak.ratio - 1) * 100)),
      recurring: true,
      ai_lookup: true,
      ai_skip_months: '6',
      notes: '',
    })
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  const sortedEvents = useMemo(() => {
    const now = new Date(new Date().toDateString())
    const upcoming: Event[] = []
    const past: Event[] = []
    const noDate: Event[] = []

    for (const e of events) {
      if (!e.expected_date) {
        noDate.push(e)
      } else if (new Date(e.expected_date) >= now) {
        upcoming.push(e)
      } else {
        past.push(e)
      }
    }

    upcoming.sort((a, b) => new Date(a.expected_date!).getTime() - new Date(b.expected_date!).getTime())
    past.sort((a, b) => new Date(b.expected_date!).getTime() - new Date(a.expected_date!).getTime())

    return [...upcoming, ...past, ...noDate]
  }, [events])

  const displayEvents = useMemo(() => {
    if (!filterAttention) return sortedEvents
    return sortedEvents.filter(needsAttention)
  }, [sortedEvents, filterAttention])

  const attentionCount = useMemo(() => events.filter(needsAttention).length, [events])

  function startEdit(event: Event) {
    setEditingId(event.id)
    setShowForm(false)
    setForm({
      name: event.name,
      expected_date: event.expected_date || '',
      duration_days: String(event.duration_days),
      impact_percentage: String(event.impact_percentage),
      recurring: event.recurring === 1,
      ai_lookup: event.ai_lookup === 1,
      ai_skip_months: String(event.ai_skip_months),
      notes: event.notes || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  function startAdd() {
    setShowForm(true)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)

    const body = {
      ...(editingId ? { id: editingId } : {}),
      name: form.name.trim(),
      expected_date: form.expected_date || null,
      duration_days: parseInt(form.duration_days) || 7,
      impact_percentage: parseInt(form.impact_percentage) || 100,
      recurring: form.recurring ? 1 : 0,
      ai_lookup: form.ai_lookup ? 1 : 0,
      ai_skip_months: parseInt(form.ai_skip_months) || 6,
      notes: form.notes.trim() || null,
    }

    try {
      await fetch('/api/events', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
      loadData()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    setDeleting(id)
    try {
      await fetch('/api/events', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      setConfirmDelete(null)
      loadData()
    } finally {
      setDeleting(null)
    }
  }

  function handleCheckDates() {
    setFilterAttention(prev => !prev)
  }

  function renderForm(isInline = false) {
    return (
      <form onSubmit={handleSubmit} className={isInline ? '' : 'bg-surface-1 rounded-2xl border border-border-subtle p-5 mb-4'}>
        {!isInline && (
          <h2 className="text-text-primary text-[14px] font-semibold mb-4">
            {editingId ? 'Event bewerken' : 'Nieuw event'}
          </h2>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider block mb-1">Naam *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-surface-0 border border-border rounded-xl px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent transition-colors"
              placeholder="Bijv. Black Friday, Kerst, Zomervakantie"
              required
            />
          </div>
          <div>
            <label className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider block mb-1">Verwachte datum</label>
            <input
              type="date"
              value={form.expected_date}
              onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))}
              className="w-full bg-surface-0 border border-border rounded-xl px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider block mb-1">Duur (dagen)</label>
            <input
              type="number"
              min="1"
              value={form.duration_days}
              onChange={e => setForm(f => ({ ...f, duration_days: e.target.value }))}
              className="w-full bg-surface-0 border border-border rounded-xl px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider block mb-1">Impact percentage</label>
            <input
              type="number"
              min="0"
              value={form.impact_percentage}
              onChange={e => setForm(f => ({ ...f, impact_percentage: e.target.value }))}
              className="w-full bg-surface-0 border border-border rounded-xl px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent transition-colors"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer pb-2">
              <input
                type="checkbox"
                checked={form.recurring}
                onChange={e => setForm(f => ({ ...f, recurring: e.target.checked }))}
                className="w-4 h-4 rounded accent-accent"
              />
              <span className="text-text-secondary text-[13px]">Terugkerend (jaarlijks)</span>
            </label>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer pb-2">
              <input
                type="checkbox"
                checked={form.ai_lookup}
                onChange={e => setForm(f => ({ ...f, ai_lookup: e.target.checked }))}
                className="w-4 h-4 rounded accent-accent"
              />
              <span className="text-text-secondary text-[13px]">AI datum opzoeken</span>
            </label>
          </div>
          {form.ai_lookup && (
            <div>
              <label className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider block mb-1">Overslaan (maanden)</label>
              <input
                type="number"
                min="1"
                value={form.ai_skip_months}
                onChange={e => setForm(f => ({ ...f, ai_skip_months: e.target.value }))}
                className="w-full bg-surface-0 border border-border rounded-xl px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent transition-colors"
              />
              <span className="text-text-tertiary text-[11px] mt-0.5 block">Na opzoeken, X maanden overslaan</span>
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider block mb-1">Notities</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full bg-surface-0 border border-border rounded-xl px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent transition-colors resize-none"
              placeholder="Optionele opmerkingen..."
            />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4">
          <button
            type="submit"
            disabled={saving || !form.name.trim()}
            className="bg-accent hover:bg-accent-hover text-white text-[13px] font-medium px-4 py-2 rounded-xl transition-colors disabled:opacity-40"
          >
            {saving ? 'Opslaan...' : editingId ? 'Bijwerken' : 'Toevoegen'}
          </button>
          <button
            type="button"
            onClick={() => { setShowForm(false); cancelEdit() }}
            className="bg-surface-2 hover:bg-surface-3 text-text-secondary text-[13px] font-medium px-4 py-2 rounded-xl transition-colors"
          >
            Annuleren
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="min-h-screen">
      <Nav lastSyncAt={lastSyncAt} lastSyncStatus={lastSyncStatus} onSync={handleSync} syncing={syncing} />

      <main className="max-w-[1100px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-[16px] font-semibold text-text-primary">Events</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCheckDates}
              className={`text-[13px] font-medium px-4 py-2 rounded-xl transition-colors ${
                filterAttention
                  ? 'bg-warning/10 text-warning border border-warning/20 hover:bg-warning/20'
                  : 'bg-surface-2 hover:bg-surface-3 text-text-secondary'
              }`}
            >
              Datums controleren
              {attentionCount > 0 && (
                <span className={`ml-1.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${
                  filterAttention ? 'bg-warning/20 text-warning' : 'bg-warning/10 text-warning'
                }`}>
                  {attentionCount}
                </span>
              )}
            </button>
            {!showForm && editingId === null && (
              <button
                onClick={startAdd}
                className="bg-accent hover:bg-accent-hover text-white text-[13px] font-medium px-4 py-2 rounded-xl transition-colors"
              >
                + Event toevoegen
              </button>
            )}
          </div>
        </div>

        {/* Add form */}
        <div ref={formRef}>
          {showForm && renderForm()}
        </div>

        {/* Summary */}
        <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5 mb-4">
          <div className="flex items-center gap-8">
            <div>
              <p className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-0.5">Totaal events</p>
              <p className="text-[22px] font-bold text-text-primary tracking-tight leading-none tabular-nums">{events.length}</p>
            </div>
            <div>
              <p className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-0.5">Aandacht nodig</p>
              <p className={`text-[22px] font-bold tracking-tight leading-none tabular-nums ${attentionCount > 0 ? 'text-warning' : 'text-success'}`}>
                {attentionCount}
              </p>
            </div>
            <div>
              <p className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-0.5">Terugkerend</p>
              <p className="text-[22px] font-bold text-text-primary tracking-tight leading-none tabular-nums">
                {events.filter(e => e.recurring === 1).length}
              </p>
            </div>
          </div>
        </div>

        {/* Events list */}
        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-surface-1 rounded-2xl border border-border-subtle p-4">
                <div className="flex justify-between"><div className="skeleton h-5 w-60" /><div className="skeleton h-6 w-20" /></div>
              </div>
            ))}
          </div>
        ) : displayEvents.length === 0 ? (
          <div className="bg-surface-1 rounded-2xl border border-border-subtle p-16 text-center">
            {filterAttention ? (
              <>
                <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-success" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M3 8.5l3 3 7-7" />
                  </svg>
                </div>
                <p className="text-text-primary text-[14px] font-semibold mb-1">Alle datums zijn actueel</p>
                <p className="text-text-tertiary text-[13px]">Geen events die aandacht nodig hebben.</p>
              </>
            ) : (
              <>
                <p className="text-text-primary text-[14px] font-semibold mb-1">Geen events</p>
                <p className="text-text-tertiary text-[13px]">Voeg events toe zoals Black Friday, Kerst of seizoenspieken.</p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {displayEvents.map((event, i) => {
              const attention = needsAttention(event)
              const expired = event.expected_date && isExpired(event.expected_date) && event.recurring === 1
              const noDate = !event.expected_date
              const isEditing = editingId === event.id

              return (
                <div
                  key={event.id}
                  ref={el => { if (el) cardRefs.current.set(event.id, el); else cardRefs.current.delete(event.id) }}
                  className={`bg-surface-1 rounded-2xl border p-4 animate-row ${
                    attention ? 'border-warning/30' : 'border-border-subtle'
                  }`}
                  style={{ animationDelay: `${Math.min(i * 20, 400)}ms` }}
                >
                  {isEditing ? (
                    /* Inline edit form */
                    <div>
                      <h3 className="text-text-primary text-[14px] font-semibold mb-3">Event bewerken</h3>
                      {renderForm(true)}
                    </div>
                  ) : (
                    /* Event card display */
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-text-primary text-[14px] font-semibold">{event.name}</span>
                          {event.recurring === 1 && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg border bg-accent/10 text-accent border-accent/20">
                              Terugkerend
                            </span>
                          )}
                          {noDate && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg border bg-warning/10 text-warning border-warning/20">
                              Datum onbekend
                            </span>
                          )}
                          {expired && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg border bg-warning/10 text-warning border-warning/20">
                              Datum verlopen — bijwerken
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-secondary mt-1">
                          {event.expected_date && (
                            <span>
                              Datum: <strong>{new Date(event.expected_date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
                            </span>
                          )}
                          <span>Duur: <strong>{formatNumber(event.duration_days)} dagen</strong></span>
                          <span>Impact: <strong>+{formatNumber(event.impact_percentage)}%</strong></span>
                        </div>
                        {event.notes && (
                          <p className="text-[12px] text-text-tertiary mt-1.5">{event.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => startEdit(event)}
                          className="bg-surface-2 hover:bg-surface-3 text-text-secondary text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Bewerken
                        </button>
                        {confirmDelete === event.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(event.id)}
                              disabled={deleting === event.id}
                              className="text-danger hover:bg-danger/10 text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                            >
                              {deleting === event.id ? 'Verwijderen...' : 'Bevestigen'}
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="text-text-tertiary hover:text-text-secondary text-[12px] font-medium px-2 py-1.5 rounded-lg transition-colors"
                            >
                              Annuleer
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(event.id)}
                            className="text-danger hover:bg-danger/10 text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors"
                          >
                            Verwijder
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {/* Historische pieken */}
        <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5 mt-6">
          <h2 className="text-[14px] font-semibold text-text-primary mb-4">Historische pieken</h2>
          {peaksLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex justify-between items-center p-2">
                  <div className="skeleton h-4 w-48" />
                  <div className="skeleton h-4 w-24" />
                </div>
              ))}
            </div>
          ) : Object.keys(peaks).length === 0 ? (
            <p className="text-text-tertiary text-[13px]">Geen verkooppieken gevonden in de historische data.</p>
          ) : (
            <div className="space-y-4">
              {Object.keys(peaks).sort((a, b) => b.localeCompare(a)).map(year => (
                <div key={year}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[13px] font-semibold text-text-primary">{year}</span>
                    <span className="text-[12px] text-text-tertiary">({peaks[year].length} {peaks[year].length === 1 ? 'piek' : 'pieken'})</span>
                  </div>
                  <div className="space-y-1.5">
                    {peaks[year].map((peak, i) => {
                      const startDate = new Date(peak.weekStart)
                      const endDate = new Date(peak.weekEnd)
                      const startStr = startDate.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
                      const endStr = endDate.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
                      const isHigh = peak.ratio > 3
                      const isMedium = peak.ratio >= 2 && peak.ratio <= 3

                      return (
                        <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-surface-0 border border-border-subtle">
                          <div className="flex-1 min-w-0">
                            <span className="text-text-primary text-[13px]">{startStr} — {endStr}</span>
                            <span className="text-text-secondary text-[12px] ml-3">
                              {formatNumber(peak.totalSales)} verkocht (gem. {formatNumber(peak.avgWeeklySales)}/week)
                            </span>
                          </div>
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg border shrink-0 ${
                            isHigh
                              ? 'bg-danger/10 text-danger border-danger/20'
                              : isMedium
                                ? 'bg-warning/10 text-warning border-warning/20'
                                : 'bg-accent/10 text-accent border-accent/20'
                          }`}>
                            {peak.ratio}× gemiddeld
                          </span>
                          <button
                            onClick={() => createEventFromPeak(peak)}
                            className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover transition-all duration-150 shrink-0"
                          >
                            Event aanmaken
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
