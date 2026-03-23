import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import Anthropic from '@anthropic-ai/sdk'
import { log } from '@/lib/logger'

function getSettingInt(db: ReturnType<typeof getDb>, key: string, fallback: number): number {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? parseInt(row.value, 10) || fallback : fallback
}

function addTokenUsage(db: ReturnType<typeof getDb>, input: number, output: number) {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
  const currentInput = getSettingInt(db, 'ai_total_input_tokens', 0)
  const currentOutput = getSettingInt(db, 'ai_total_output_tokens', 0)
  upsert.run('ai_total_input_tokens', String(currentInput + input), String(currentInput + input))
  upsert.run('ai_total_output_tokens', String(currentOutput + output), String(currentOutput + output))
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const { id } = await req.json()
  if (!id) {
    return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
  }

  const db = getDb()
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as {
    id: number; name: string; parent_id: number | null; expected_date: string | null
  } | undefined

  if (!event) {
    log('error', `AI lookup: event id=${id} (type=${typeof id}) niet gevonden`)
    return NextResponse.json({ error: `Event met id ${id} niet gevonden` }, { status: 404 })
  }

  const apiKey = (db.prepare("SELECT value FROM settings WHERE key = 'claude_api_key'").get() as { value: string } | undefined)?.value
  if (!apiKey) {
    return NextResponse.json({ error: 'Claude API key niet geconfigureerd. Ga naar Instellingen.' }, { status: 400 })
  }

  const maxTokens = getSettingInt(db, 'ai_max_tokens_per_lookup', 100)

  // Build context: if sub-event, include parent name
  let eventLabel = event.name
  if (event.parent_id) {
    const parent = db.prepare('SELECT name FROM events WHERE id = ?').get(event.parent_id) as { name: string } | undefined
    if (parent) {
      eventLabel = `${parent.name} — ${event.name}`
    }
  }

  const now = new Date()
  const currentYear = now.getFullYear()
  const nextYear = currentYear + 1

  try {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: `What is the next upcoming date for "${eventLabel}"? Today is ${now.toISOString().slice(0, 10)}. If it's an annual event, give the ${currentYear} date if it hasn't passed yet, otherwise the ${nextYear} date. Respond with ONLY the date in YYYY-MM-DD format, nothing else. If you don't know, respond with UNKNOWN.`,
      }],
    })

    // Track token usage
    addTokenUsage(db, message.usage.input_tokens, message.usage.output_tokens)

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    const dateMatch = text.match(/^\d{4}-\d{2}-\d{2}$/)

    db.prepare('UPDATE events SET last_checked_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)

    const tokensUsed = message.usage.input_tokens + message.usage.output_tokens

    if (dateMatch) {
      db.prepare('UPDATE events SET expected_date = ? WHERE id = ?').run(dateMatch[0], id)
      log('info', `AI datum gevonden voor "${eventLabel}": ${dateMatch[0]} (tokens: ${tokensUsed})`)
      return NextResponse.json({ success: true, date: dateMatch[0] })
    } else {
      log('warn', `AI kon datum niet vinden voor "${eventLabel}": ${text} (tokens: ${tokensUsed})`)
      return NextResponse.json({ success: true, date: null, message: 'Datum niet gevonden' })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('error', `AI datum lookup mislukt voor "${eventLabel}": ${msg}`)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
