import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db'
import { getAiConfig, addTokenUsage, checkTokenCap, getSettingInt } from '@/lib/ai'

let db: Database.Database
const set = (k: string, v: string) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v)

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
})

describe('getAiConfig', () => {
  it('valt terug op de defaults', () => {
    expect(getAiConfig(db, 'event_lookup')).toEqual({ model: 'claude-haiku-4-5-20251001', maxTokens: 1024 })
    expect(getAiConfig(db, 'order_import')).toEqual({ model: 'claude-sonnet-5-5', maxTokens: 4096 })
  })
  it('leest instellingen en begrenst max tokens', () => {
    set('ai_model_order_import', 'claude-opus-5-5')
    set('ai_max_tokens_order_import', '999999')
    expect(getAiConfig(db, 'order_import')).toEqual({ model: 'claude-opus-5-5', maxTokens: 16000 })
    set('ai_max_tokens_order_import', '0')
    expect(getAiConfig(db, 'order_import').maxTokens).toBe(4096)
  })
})

describe('tokenverbruik', () => {
  it('telt op bij het totaal en bij de functie', () => {
    addTokenUsage(db, 'order_import', 100, 20)
    addTokenUsage(db, 'order_import', 1, 2)
    expect(getSettingInt(db, 'ai_total_input_tokens', 0)).toBe(101)
    expect(getSettingInt(db, 'ai_total_output_tokens', 0)).toBe(22)
    expect(getSettingInt(db, 'ai_tokens_order_import_input', 0)).toBe(101)
    expect(getSettingInt(db, 'ai_tokens_event_lookup_input', 0)).toBe(0)
  })
  it('meldt wanneer de limiet bereikt is', () => {
    expect(checkTokenCap(db)).toBeNull()
    set('ai_token_cap', '100')
    addTokenUsage(db, 'event_lookup', 80, 20)
    expect(checkTokenCap(db)).toMatch(/Token limiet bereikt/)
  })
  it('schrijft geen verbruik van order_import weg als event_lookup bij een herstart', () => {
    addTokenUsage(db, 'order_import', 50, 5)
    initSchema(db)
    expect(getSettingInt(db, 'ai_tokens_event_lookup_input', -1)).toBe(0)
  })
})
