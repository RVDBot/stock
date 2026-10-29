import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { getClaudeApiKey } from '@/lib/ai'
import { FALLBACK_MODELS } from '@/lib/ai-config'
import { log } from '@/lib/logger'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const apiKey = getClaudeApiKey(getDb())
  if (!apiKey) return NextResponse.json({ models: FALLBACK_MODELS, source: 'fallback' })

  try {
    const client = new Anthropic({ apiKey })
    const page = await client.models.list({ limit: 100 })
    const models = page.data.map(m => ({ id: m.id, name: m.display_name }))
    if (models.length === 0) return NextResponse.json({ models: FALLBACK_MODELS, source: 'fallback' })
    return NextResponse.json({ models, source: 'live' })
  } catch (e) {
    log('warn', `Modellenlijst ophalen mislukt: ${e instanceof Error ? e.message : String(e)}`)
    return NextResponse.json({ models: FALLBACK_MODELS, source: 'fallback' })
  }
}
