'use client'

import { useEffect, useState } from 'react'
import Nav from '@/components/Nav'

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [lastSyncStatus, setLastSyncStatus] = useState('')
  const [lastSyncType, setLastSyncType] = useState('')

  // WooCommerce settings
  const [wooUrl, setWooUrl] = useState('')
  const [wooConsumerKey, setWooConsumerKey] = useState('')
  const [wooConsumerSecret, setWooConsumerSecret] = useState('')
  const [hasWooSecret, setHasWooSecret] = useState(false)
  const [wooSaving, setWooSaving] = useState(false)
  const [wooMsg, setWooMsg] = useState('')
  const [wooExpanded, setWooExpanded] = useState(false)

  // Claude AI settings
  const [claudeApiKey, setClaudeApiKey] = useState('')
  const [hasClaudeKey, setHasClaudeKey] = useState(false)
  const [claudeSaving, setClaudeSaving] = useState(false)
  const [claudeMsg, setClaudeMsg] = useState('')
  const [claudeExpanded, setClaudeExpanded] = useState(false)

  // Event settings
  const [aiMaxTokens, setAiMaxTokens] = useState('100')
  const [eventSaving, setEventSaving] = useState(false)
  const [eventMsg, setEventMsg] = useState('')
  const [totalInputTokens, setTotalInputTokens] = useState(0)
  const [totalOutputTokens, setTotalOutputTokens] = useState(0)

  // Stock settings
  const [warehouseInboundDays, setWarehouseInboundDays] = useState('14')
  const [safetyMarginDays, setSafetyMarginDays] = useState('7')
  const [stockSaving, setStockSaving] = useState(false)
  const [stockMsg, setStockMsg] = useState('')

  // Sync
  const [historicalSyncing, setHistoricalSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  function loadData() {
    setLoading(true)
    fetch('/api/settings').then(r => r.json()).then(settData => {
      const settings = settData.settings || {}
      setLastSyncAt(settings.last_sync_at || '')
      setLastSyncStatus(settings.last_sync_status || '')
      setLastSyncType(settings.last_sync_type || '')
      setWooUrl(settings.woo_url || '')
      setWooConsumerKey(settings.woo_consumer_key || '')
      setHasWooSecret(settings.has_woo_consumer_secret === '1')
      setHasClaudeKey(settings.has_claude_api_key === '1')
      setAiMaxTokens(settings.ai_max_tokens_per_lookup || '100')
      setTotalInputTokens(parseInt(settings.ai_total_input_tokens || '0', 10))
      setTotalOutputTokens(parseInt(settings.ai_total_output_tokens || '0', 10))
      setWarehouseInboundDays(settings.warehouse_inbound_days || '14')
      setSafetyMarginDays(settings.safety_margin_days || '7')
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

  async function saveClaudeSettings() {
    setClaudeSaving(true)
    setClaudeMsg('')
    try {
      if (claudeApiKey) {
        await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'claude_api_key', value: claudeApiKey }),
        })
        setHasClaudeKey(true)
        setClaudeApiKey('')
        setClaudeMsg('Opgeslagen')
        setTimeout(() => setClaudeMsg(''), 3000)
      }
    } finally {
      setClaudeSaving(false)
    }
  }

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

  async function saveEventSettings() {
    setEventSaving(true)
    setEventMsg('')
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { ai_max_tokens_per_lookup: aiMaxTokens } }),
      })
      setEventMsg('Opgeslagen')
      setTimeout(() => setEventMsg(''), 3000)
    } finally {
      setEventSaving(false)
    }
  }

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
      if (data.success) {
        setSyncMsg(`Import voltooid: ${data.ordersProcessed || 0} verkoopregels verwerkt`)
      } else {
        setSyncMsg(`Fout: ${data.error || 'onbekend'} — zie Logs voor details`)
      }
      loadData()
    } catch (e) {
      setSyncMsg(`Fout bij historische import: ${e instanceof Error ? e.message : 'onbekend'} — zie Logs`)
    } finally {
      setHistoricalSyncing(false)
    }
  }

  const inputClass = 'w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary outline-none focus:border-accent transition-colors'
  const labelClass = 'text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1'
  const primaryBtn = 'text-[12px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-all duration-150'
  const secondaryBtn = 'text-[12px] font-medium px-3 py-1.5 rounded-lg bg-surface-2 border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-all duration-150'

  return (
    <div className="min-h-screen">
      <Nav lastSyncAt={lastSyncAt} lastSyncStatus={lastSyncStatus} onSync={handleSync} syncing={syncing} />

      <main className="max-w-[1100px] mx-auto px-6 py-6">
        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-surface-1 rounded-2xl border border-border-subtle p-5">
                <div className="skeleton h-5 w-48 mb-3" />
                <div className="skeleton h-9 w-full mb-2" />
                <div className="skeleton h-9 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Token usage overzicht */}
            {(totalInputTokens > 0 || totalOutputTokens > 0) && (
              <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5">
                <h2 className="text-[14px] font-semibold text-text-primary mb-3">AI token gebruik</h2>
                <div className="flex items-center gap-8">
                  <div>
                    <p className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-0.5">Input tokens</p>
                    <p className="text-[22px] font-bold text-text-primary tracking-tight leading-none tabular-nums">{totalInputTokens.toLocaleString('nl-NL')}</p>
                  </div>
                  <div>
                    <p className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-0.5">Output tokens</p>
                    <p className="text-[22px] font-bold text-text-primary tracking-tight leading-none tabular-nums">{totalOutputTokens.toLocaleString('nl-NL')}</p>
                  </div>
                  <div>
                    <p className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-0.5">Totaal</p>
                    <p className="text-[22px] font-bold text-accent tracking-tight leading-none tabular-nums">{(totalInputTokens + totalOutputTokens).toLocaleString('nl-NL')}</p>
                  </div>
                </div>
              </div>
            )}

            {/* WooCommerce verbinding */}
            <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-[14px] font-semibold text-text-primary">WooCommerce verbinding</h2>
                  {(() => {
                    const hasUrl = !!wooUrl
                    const hasKey = !!wooConsumerKey
                    const hasSecret = hasWooSecret
                    const isConfigured = hasUrl && hasKey && hasSecret
                    const hasErrors = lastSyncStatus.startsWith('error')
                    const color = !isConfigured ? 'bg-danger' : hasErrors ? 'bg-warning' : 'bg-success'
                    return (
                      <span className={`w-2.5 h-2.5 rounded-full ${color} shrink-0`} title={
                        !isConfigured ? 'Niet geconfigureerd' : hasErrors ? 'Verbonden met fouten' : 'Verbonden'
                      } />
                    )
                  })()}
                </div>
                <button
                  onClick={() => setWooExpanded(!wooExpanded)}
                  className={secondaryBtn}
                >
                  {wooExpanded ? 'Sluiten' : 'Wijzigen'}
                </button>
              </div>
              {wooExpanded && (
                <div className="mt-4">
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
              )}
            </div>

            {/* Claude AI */}
            <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-[14px] font-semibold text-text-primary">Claude AI</h2>
                  <span className={`w-2.5 h-2.5 rounded-full ${hasClaudeKey ? 'bg-success' : 'bg-danger'} shrink-0`} title={
                    hasClaudeKey ? 'API key geconfigureerd' : 'Geen API key'
                  } />
                </div>
                <button
                  onClick={() => setClaudeExpanded(!claudeExpanded)}
                  className={secondaryBtn}
                >
                  {claudeExpanded ? 'Sluiten' : 'Wijzigen'}
                </button>
              </div>
              {claudeExpanded && (
                <div className="mt-4">
                  <div className="mb-3">
                    <label className={labelClass}>API Key</label>
                    <input
                      type="password"
                      className={inputClass}
                      value={claudeApiKey}
                      onChange={e => setClaudeApiKey(e.target.value)}
                      placeholder={hasClaudeKey ? 'Bewaard (typ om te wijzigen)' : 'sk-ant-...'}
                    />
                    {hasClaudeKey && !claudeApiKey && (
                      <span className="text-success text-[12px] mt-0.5 block">Bewaard</span>
                    )}
                  </div>
                  <p className="text-text-tertiary text-[12px] mb-3">
                    Wordt gebruikt om automatisch evenementdatums op te zoeken. Haal een key op via console.anthropic.com.
                  </p>
                  <div className="flex items-center gap-2">
                    <button className={primaryBtn} disabled={claudeSaving || !claudeApiKey} onClick={saveClaudeSettings}>
                      {claudeSaving ? 'Opslaan...' : 'Opslaan'}
                    </button>
                    {claudeMsg && <span className="text-success text-[12px]">{claudeMsg}</span>}
                  </div>
                </div>
              )}
            </div>

            {/* Evenement instellingen */}
            <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5">
              <h2 className="text-[14px] font-semibold text-text-primary mb-3">Evenement instellingen</h2>
              <div className="mb-3">
                <label className={labelClass}>Max tokens per AI lookup</label>
                <input
                  type="number"
                  className={`${inputClass} max-w-xs`}
                  value={aiMaxTokens}
                  onChange={e => setAiMaxTokens(e.target.value)}
                  min="10"
                  max="4096"
                />
                <p className="text-text-tertiary text-[12px] mt-1">
                  Maximum aantal output tokens dat Claude mag gebruiken per datum opzoeking. Standaard: 100.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button className={primaryBtn} disabled={eventSaving} onClick={saveEventSettings}>
                  {eventSaving ? 'Opslaan...' : 'Opslaan'}
                </button>
                {eventMsg && <span className="text-success text-[12px]">{eventMsg}</span>}
              </div>
            </div>

            {/* Voorraad instellingen */}
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

            {/* Data */}
            <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5">
              <h2 className="text-[14px] font-semibold text-text-primary mb-3">Data</h2>
              <div className="mb-3">
                <p className="text-text-secondary text-[13px]">
                  Laatste sync: {lastSyncAt ? (
                    <>
                      <span className="font-medium">{new Date(lastSyncAt).toLocaleString('nl-NL')}</span>
                      {' \u2014 '}
                      <span className={lastSyncStatus === 'success' ? 'text-success' : 'text-danger'}>{lastSyncStatus}</span>
                      {lastSyncType && (
                        <span className="text-text-tertiary ml-2">
                          ({lastSyncType === 'manual' ? 'handmatig' : lastSyncType === 'automated' ? 'geautomatiseerd' : lastSyncType === 'historical' ? 'historische import' : lastSyncType})
                        </span>
                      )}
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
          </div>
        )}
      </main>
    </div>
  )
}
