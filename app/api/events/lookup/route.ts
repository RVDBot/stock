import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import Anthropic from '@anthropic-ai/sdk'
import { log } from '@/lib/logger'
import { getAiConfig, getClaudeApiKey, checkTokenCap, addTokenUsage, checkRateLimit } from '@/lib/ai'

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Te veel verzoeken. Probeer het over een minuut opnieuw.' }, { status: 429 })
  }

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

  const apiKey = getClaudeApiKey(db)
  if (!apiKey) {
    return NextResponse.json({ error: 'Claude API key niet geconfigureerd. Ga naar Instellingen.' }, { status: 400 })
  }

  const capError = checkTokenCap(db)
  if (capError) {
    return NextResponse.json({ error: capError }, { status: 429 })
  }

  const { model, maxTokens } = getAiConfig(db, 'event_lookup')

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
      model: model,
      max_tokens: maxTokens,
      tools: [{ type: 'web_search_20250305' as const, name: 'web_search', max_uses: 3 }],
      messages: [{
        role: 'user',
        content: `Find the exact date(s) for "${eventLabel}" in ${currentYear} or ${nextYear}. Today is ${now.toISOString().slice(0, 10)}. Search the web for the most up-to-date information. If it's an annual event, give the ${currentYear} date if it hasn't passed yet, otherwise the ${nextYear} date. For multi-day events, give the START date. Respond with ONLY the date in YYYY-MM-DD format as your final answer, nothing else. If you truly cannot find it, respond with UNKNOWN.`,
      }],
    })

    // Track token usage
    addTokenUsage(db, 'event_lookup', message.usage.input_tokens, message.usage.output_tokens)

    // Extract text from response (may include tool use blocks for web search)
    const textBlocks = message.content.filter(b => b.type === 'text')
    const text = textBlocks.map(b => b.type === 'text' ? b.text : '').join('').trim()
    const dateMatch = text.match(/\d{4}-\d{2}-\d{2}/)

    db.prepare('UPDATE events SET last_checked_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)

    const tokensUsed = message.usage.input_tokens + message.usage.output_tokens

    if (dateMatch) {
      db.prepare('UPDATE events SET expected_date = ? WHERE id = ?').run(dateMatch[0], id)
      log('info', `AI datum gevonden voor "${eventLabel}": ${dateMatch[0]} (tokens: ${tokensUsed}, ${model})`)
      return NextResponse.json({ success: true, date: dateMatch[0] })
    } else {
      log('warn', `AI kon datum niet vinden voor "${eventLabel}": ${text} (tokens: ${tokensUsed}, ${model})`)
      return NextResponse.json({ success: true, date: null, message: 'Datum niet gevonden' })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('error', `AI datum lookup mislukt voor "${eventLabel}": ${msg}`)
    return NextResponse.json({ error: 'AI lookup mislukt. Controleer de API key en probeer opnieuw.' }, { status: 500 })
  }
}
