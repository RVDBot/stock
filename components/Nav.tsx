'use client'

import { usePathname } from 'next/navigation'

interface NavProps {
  lastSyncAt?: string
  lastSyncStatus?: string
  onSync?: () => void
  syncing?: boolean
}

const NAV_ITEMS = [
  { href: '/', label: 'Alerts' },
  { href: '/suppliers', label: 'Fabrikanten' },
  { href: '/events', label: 'Events' },
  { href: '/settings', label: 'Instellingen' },
]

export default function Nav({ lastSyncAt, lastSyncStatus, onSync, syncing }: NavProps) {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-40 bg-surface-0/80 backdrop-blur-xl border-b border-border-subtle">
      <div className="max-w-[1100px] mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
            <svg className="w-4 h-4 text-white" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1L1 4.5v7L8 15l7-3.5v-7L8 1zm0 1.2l5.5 2.8L8 7.8 2.5 5 8 2.2zM2 5.9l5.5 2.8v5.5L2 11.4V5.9zm7 8.3V8.7L14.5 5.9v5.5L9 14.2z" />
            </svg>
          </div>
          <nav className="flex bg-surface-1 rounded-lg p-0.5 border border-border-subtle">
            {NAV_ITEMS.map(item => {
              const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={`text-[12px] font-medium px-3 py-1.5 rounded-md transition-all duration-150 ${
                    isActive
                      ? 'bg-surface-3 text-text-primary shadow-sm'
                      : 'text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  {item.label}
                </a>
              )
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {lastSyncAt && (
            <span className={`text-[11px] tabular-nums ${lastSyncStatus === 'success' ? 'text-text-tertiary' : 'text-danger'}`}>
              Sync: {new Date(lastSyncAt).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              {lastSyncStatus && lastSyncStatus !== 'success' && ` (${lastSyncStatus})`}
            </span>
          )}
          {onSync && (
            <button
              onClick={onSync}
              disabled={syncing}
              className="p-2 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-2 disabled:opacity-40 transition-all duration-150"
              title="Sync nu"
            >
              <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2.5 8a5.5 5.5 0 0 1 9.3-4M13.5 8a5.5 5.5 0 0 1-9.3 4" />
                <path d="M12 1.5v3h-3M4 11.5v3h3" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
