import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import Anthropic from '@anthropic-ai/sdk'
import { log } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const { id } = await req.json()
  if (!id) {
    return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
  }

  const db = getDb()
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as {
    id: number; name: string; expected_date: string | null
  } | undefined

  if (!event) {
    return NextResponse.json({ error: 'Event niet gevonden' }, { status: 404 })
  }

  const apiKey = (db.prepare("SELECT value FROM settings WHERE key = 'claude_api_key'").get() as { value: string } | undefined)?.value
  if (!apiKey) {
    return NextResponse.json({ error: 'Claude API key niet geconfigureerd. Ga naar Instellingen.' }, { status: 400 })
  }

  const now = new Date()
  const currentYear = now.getFullYear()
  const nextYear = currentYear + 1

  try {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `What is the next upcoming date for "${event.name}"? Today is ${now.toISOString().slice(0, 10)}. If it's an annual event, give the ${currentYear} date if it hasn't passed yet, otherwise the ${nextYear} date. Respond with ONLY the date in YYYY-MM-DD format, nothing else. If you don't know, respond with UNKNOWN.`,
      }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    const dateMatch = text.match(/^\d{4}-\d{2}-\d{2}$/)

    db.prepare('UPDATE events SET last_checked_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)

    if (dateMatch) {
      db.prepare('UPDATE events SET expected_date = ? WHERE id = ?').run(dateMatch[0], id)
      log('info', `AI datum gevonden voor "${event.name}": ${dateMatch[0]}`)
      return NextResponse.json({ success: true, date: dateMatch[0] })
    } else {
      log('warn', `AI kon datum niet vinden voor "${event.name}": ${text}`)
      return NextResponse.json({ success: true, date: null, message: 'Datum niet gevonden' })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('error', `AI datum lookup mislukt voor "${event.name}": ${msg}`)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
