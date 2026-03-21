import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'

const SECRET_KEYS = ['auth_password_hash', 'auth_session_token']
const READ_SECRET_KEYS = ['auth_password_hash', 'auth_session_token', 'woo_consumer_secret']

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const db = getDb()
  const rows = db.prepare('SELECT * FROM settings').all() as { key: string; value: string }[]

  const settings: Record<string, string> = {}
  let hasWooConsumerSecret = false
  for (const row of rows) {
    if (row.key === 'woo_consumer_secret' && row.value) {
      hasWooConsumerSecret = true
    }
    if (!READ_SECRET_KEYS.includes(row.key)) {
      settings[row.key] = row.value
    }
  }
  settings.has_woo_consumer_secret = hasWooConsumerSecret ? '1' : '0'
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
        if (SECRET_KEYS.includes(key)) continue
        upsert.run(key, String(value), String(value))
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

  if (SECRET_KEYS.includes(key)) {
    return NextResponse.json({ error: 'Deze instelling kan niet via deze route worden aangepast' }, { status: 403 })
  }

  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
    .run(key, String(value), String(value))

  return NextResponse.json({ success: true })
}
