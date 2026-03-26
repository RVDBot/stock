'use client'

import { useEffect, useState } from 'react'
import Nav from '@/components/Nav'
import { apiFetch } from '@/lib/api'

interface LogEntry {
  id: number
  level: string
  message: string
  meta: string | null
  created_at: string
}

const LEVEL_STYLES: Record<string, { bg: string; text: string }> = {
  error: { bg: 'bg-danger/10', text: 'text-danger' },
  warn: { bg: 'bg-warning/10', text: 'text-warning' },
  info: { bg: 'bg-accent/10', text: 'text-accent' },
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [lastSyncStatus, setLastSyncStatus] = useState('')

  function loadData() {
    setLoading(true)
    const params = new URLSearchParams({ limit: '200' })
    if (filter) params.set('level', filter)
    Promise.all([
      apiFetch(`/api/logs?${params}`).then(r => r.json()),
      apiFetch('/api/settings').then(r => r.json()),
    ]).then(([logsData, settData]) => {
      setLogs(Array.isArray(logsData) ? logsData : [])
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

  async function clearLogs() {
    if (!confirm('Alle logs wissen?')) return
    await apiFetch('/api/logs', { method: 'DELETE' })
    loadData()
  }

  useEffect(() => { loadData() }, [filter])

  const counts = {
    error: logs.filter(l => l.level === 'error').length,
    warn: logs.filter(l => l.level === 'warn').length,
    info: logs.filter(l => l.level === 'info').length,
  }

  return (
    <div className="min-h-screen">
      <Nav lastSyncAt={lastSyncAt} lastSyncStatus={lastSyncStatus} onSync={handleSync} syncing={syncing} />

      <main className="max-w-[1100px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-[16px] font-semibold text-text-primary">Logboek</h1>
          <button
            onClick={clearLogs}
            className="text-[12px] font-medium px-3 py-1.5 rounded-lg text-danger hover:bg-danger/10 transition-all duration-150"
          >
            Logs wissen
          </button>
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-2 mb-4">
          {[
            { value: '', label: 'Alles', count: logs.length },
            { value: 'error', label: 'Fouten', count: counts.error },
            { value: 'warn', label: 'Waarschuwingen', count: counts.warn },
            { value: 'info', label: 'Info', count: counts.info },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`text-[12px] font-medium px-3 py-1.5 rounded-lg border transition-all duration-150 ${
                filter === f.value
                  ? 'bg-surface-3 text-text-primary border-border-subtle shadow-sm'
                  : 'bg-surface-1 text-text-tertiary border-border-subtle hover:text-text-secondary'
              }`}
            >
              {f.label}
              {f.count > 0 && (
                <span className={`ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                  f.value === 'error' ? 'bg-danger/10 text-danger' :
                  f.value === 'warn' ? 'bg-warning/10 text-warning' :
                  'bg-surface-2 text-text-tertiary'
                }`}>
                  {f.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-surface-1 rounded-2xl border border-border-subtle p-4">
                <div className="flex gap-3"><div className="skeleton h-5 w-16" /><div className="skeleton h-5 w-full" /></div>
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="bg-surface-1 rounded-2xl border border-border-subtle p-16 text-center">
            <p className="text-text-primary text-[14px] font-semibold mb-1">Geen logs</p>
            <p className="text-text-tertiary text-[13px]">Er zijn geen logberichten gevonden.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {logs.map((log, i) => {
              const style = LEVEL_STYLES[log.level] || LEVEL_STYLES.info
              const isExpanded = expandedId === log.id
              return (
                <div
                  key={log.id}
                  className={`bg-surface-1 rounded-xl border border-border-subtle animate-row ${log.meta ? 'cursor-pointer' : ''}`}
                  style={{ animationDelay: `${Math.min(i * 10, 200)}ms` }}
                  onClick={() => log.meta && setExpandedId(isExpanded ? null : log.id)}
                >
                  <div className="flex items-start gap-3 p-3">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 mt-0.5 ${style.bg} ${style.text}`}>
                      {log.level.toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary text-[13px] break-words">{log.message}</p>
                      {isExpanded && log.meta && (
                        <pre className="mt-2 text-[11px] text-text-tertiary bg-surface-0 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words border border-border-subtle">
                          {log.meta}
                        </pre>
                      )}
                    </div>
                    <span className="text-text-tertiary text-[11px] tabular-nums shrink-0">
                      {new Date(log.created_at + 'Z').toLocaleString('nl-NL', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
                      })}
                    </span>
                    {log.meta && (
                      <span className="text-text-tertiary text-[11px] shrink-0">
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    )}
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
