import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { encryptValue, decryptValue, isEncryptionEnabled } from '@/lib/encrypt'

const READ_SECRET_KEYS = ['auth_password_hash', 'auth_session_token', 'woo_consumer_secret', 'claude_api_key']
const ENCRYPTED_KEYS = new Set(['woo_consumer_secret', 'claude_api_key'])

const ALLOWED_WRITE_KEYS = new Set([
  'woo_url', 'woo_consumer_key', 'woo_consumer_secret',
  'claude_api_key', 'ai_max_tokens_per_lookup', 'ai_token_cap',
  'warehouse_inbound_days', 'safety_margin_days',
  'last_sync_at', 'last_sync_status',
  'ai_total_input_tokens', 'ai_total_output_tokens',
])

function storeValue(key: string, value: string): string {
  if (ENCRYPTED_KEYS.has(key) && value) return encryptValue(value)
  return value
}

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const db = getDb()
  const rows = db.prepare('SELECT * FROM settings').all() as { key: string; value: string }[]

  const settings: Record<string, string> = {}
  let hasWooConsumerSecret = false
  let hasClaudeApiKey = false
  for (const row of rows) {
    if (row.key === 'woo_consumer_secret' && row.value) {
      hasWooConsumerSecret = true
    }
    if (row.key === 'claude_api_key' && row.value) {
      hasClaudeApiKey = true
    }
    if (!READ_SECRET_KEYS.includes(row.key)) {
      settings[row.key] = row.value
    }
  }
  settings.has_woo_consumer_secret = hasWooConsumerSecret ? '1' : '0'
  settings.has_claude_api_key = hasClaudeApiKey ? '1' : '0'
  settings.encryption_enabled = isEncryptionEnabled() ? '1' : '0'
  return NextResponse.json({ settings })
}

export async function PUT(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const body = await req.json()
  const db = getDb()

  // Bulk update: { settings: { key: value, ... } }
  if (body.settings && typeof body.settings === 'object') {
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
    const tx = db.transaction((entries: [string, string][]) => {
      for (const [key, value] of entries) {
        if (!ALLOWED_WRITE_KEYS.has(key)) continue
        const stored = storeValue(key, String(value))
        upsert.run(key, stored, stored)
      }
    })
    tx(Object.entries(body.settings))
    return NextResponse.json({ success: true })
  }

  // Single update: { key, value }
  const { key, value } = body

  if (!key) {
    return NextResponse.json({ error: 'key is verplicht' }, { status: 400 })
  }

  if (!ALLOWED_WRITE_KEYS.has(key)) {
    return NextResponse.json({ error: 'Deze instelling kan niet via deze route worden aangepast' }, { status: 403 })
  }

  const stored = storeValue(key, String(value))
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
    .run(key, stored, stored)

  return NextResponse.json({ success: true })
}
