import type Database from 'better-sqlite3'
import { decryptValue } from '@/lib/encrypt'
import { AI_FUNCTIONS, MAX_TOKENS_LIMIT, maxTokensSettingKey, modelSettingKey, usageSettingKey, type AiFunction } from '@/lib/ai-config'

export function getSetting(db: Database.Database, key: string): string | undefined {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value
}

export function getSettingInt(db: Database.Database, key: string, fallback: number): number {
  const row = getSetting(db, key)
  if (row === undefined) return fallback
  const n = parseInt(row, 10)
  return Number.isNaN(n) ? fallback : n
}

export function getAiConfig(db: Database.Database, fn: AiFunction): { model: string; maxTokens: number } {
  const defaults = AI_FUNCTIONS[fn]
  const model = getSetting(db, modelSettingKey(fn))?.trim() || defaults.defaultModel
  const maxTokens = Math.min(MAX_TOKENS_LIMIT, getSettingInt(db, maxTokensSettingKey(fn), defaults.defaultMaxTokens))
  return { model, maxTokens: maxTokens > 0 ? maxTokens : defaults.defaultMaxTokens }
}

export function getClaudeApiKey(db: Database.Database): string | undefined {
  const raw = getSetting(db, 'claude_api_key')
  return raw ? decryptValue(raw) : undefined
}

// Returns an error message when the total cap is reached, otherwise null
export function checkTokenCap(db: Database.Database): string | null {
  const cap = getSettingInt(db, 'ai_token_cap', 0)
  if (cap <= 0) return null
  const used = getSettingInt(db, 'ai_total_input_tokens', 0) + getSettingInt(db, 'ai_total_output_tokens', 0)
  if (used < cap) return null
  return `Token limiet bereikt (${used.toLocaleString('nl-NL')} / ${cap.toLocaleString('nl-NL')}). Verhoog het limiet in Instellingen.`
}

export function addTokenUsage(db: Database.Database, fn: AiFunction, input: number, output: number) {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  const add = (key: string, n: number) => upsert.run(key, String(getSettingInt(db, key, 0) + n))
  db.transaction(() => {
    // Before the first non-event usage is recorded, freeze the event lookup's share (all usage so far) so initSchema never copies this usage into it
    if (fn !== 'event_lookup') {
      for (const kind of ['input', 'output'] as const) {
        const key = usageSettingKey('event_lookup', kind)
        if (getSetting(db, key) === undefined) {
          upsert.run(key, String(getSettingInt(db, kind === 'input' ? 'ai_total_input_tokens' : 'ai_total_output_tokens', 0)))
        }
      }
    }
    add('ai_total_input_tokens', input)
    add('ai_total_output_tokens', output)
    add(usageSettingKey(fn, 'input'), input)
    add(usageSettingKey(fn, 'output'), output)
  })()
}

const RATE_WINDOW_MS = 60_000
const MAX_CALLS = 10
const callCounts = new Map<string, { count: number; firstCall: number }>()

export function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = callCounts.get(ip)
  if (entry && now - entry.firstCall < RATE_WINDOW_MS) {
    entry.count++
    return entry.count <= MAX_CALLS
  }
  callCounts.set(ip, { count: 1, firstCall: now })
  return true
}
