'use client'

import { useState, useEffect } from 'react'

export default function LoginPage() {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/auth')
      .then(r => r.json())
      .then(data => {
        if (data.authenticated) {
          window.location.href = '/'
          return
        }
        setNeedsSetup(data.needsSetup)
      })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (needsSetup && password !== confirm) {
      setError('Wachtwoorden komen niet overeen')
      return
    }
    if (password.length < 8) {
      setError('Wachtwoord moet minimaal 8 tekens zijn')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: needsSetup ? 'setup' : 'login',
          password,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Er ging iets mis')
        return
      }
      window.location.href = '/'
    } catch {
      setError('Verbinding mislukt')
    } finally {
      setLoading(false)
    }
  }

  if (needsSetup === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-3 justify-center mb-8">
          <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center">
            <svg className="w-5 h-5 text-white" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1L1 4.5v7L8 15l7-3.5v-7L8 1zm0 1.2l5.5 2.8L8 7.8 2.5 5 8 2.2zM2 5.9l5.5 2.8v5.5L2 11.4V5.9zm7 8.3V8.7L14.5 5.9v5.5L9 14.2z" />
            </svg>
          </div>
          <h1 className="text-[18px] font-bold text-text-primary">Stock Dashboard</h1>
        </div>

        <div className="bg-surface-1 rounded-2xl border border-border-subtle p-6 shadow-lg shadow-black/5">
          <h2 className="text-text-primary text-[15px] font-semibold mb-1">
            {needsSetup ? 'Wachtwoord instellen' : 'Inloggen'}
          </h2>
          <p className="text-text-tertiary text-[13px] mb-5">
            {needsSetup
              ? 'Kies een wachtwoord om je dashboard te beveiligen.'
              : 'Voer je wachtwoord in om verder te gaan.'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider">
                Wachtwoord
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
                className="w-full bg-surface-0 text-text-primary text-[13px] px-3 py-2.5 rounded-xl outline-none border border-border hover:border-text-tertiary focus:border-accent placeholder:text-text-tertiary transition-colors duration-150"
              />
            </div>

            {needsSetup && (
              <div className="space-y-1.5">
                <label htmlFor="confirm" className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wider">
                  Bevestig wachtwoord
                </label>
                <input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  className="w-full bg-surface-0 text-text-primary text-[13px] px-3 py-2.5 rounded-xl outline-none border border-border hover:border-text-tertiary focus:border-accent placeholder:text-text-tertiary transition-colors duration-150"
                />
              </div>
            )}

            {error && (
              <p className="text-danger text-[13px] font-medium">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold py-2.5 rounded-xl transition-colors duration-150 disabled:opacity-50"
            >
              {loading ? 'Even geduld...' : needsSetup ? 'Wachtwoord instellen' : 'Inloggen'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
