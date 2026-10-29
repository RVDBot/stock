import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db'
import { normalizeCode, normalizeDescription, aliasKey, upsertAlias, getAliasMap } from '@/lib/aliases'

describe('normalisatie', () => {
  it('haalt spaties, streepjes, punten en slashes uit codes en maakt lowercase', () => {
    expect(normalizeCode(' SR-PRO.3m / BLK ')).toBe('srpro3mblk')
  })
  it('vouwt whitespace in omschrijvingen samen', () => {
    expect(normalizeDescription('  Speed   Rope\tPRO  Black ')).toBe('speed rope pro black')
  })
  it('gebruikt de code als sleutel, anders de omschrijving met name:-prefix', () => {
    expect(aliasKey('AB-12', 'Rope')).toBe('ab12')
    expect(aliasKey(null, 'Rope  Black')).toBe('name:rope black')
    expect(aliasKey('  ', 'Rope')).toBe('name:rope')
    expect(aliasKey(null, '  ')).toBeNull()
  })
})

describe('geheugen', () => {
  it('upsert overschrijft de koppeling voor dezelfde sleutel', () => {
    const db = new Database(':memory:')
    initSchema(db)
    db.prepare("INSERT INTO suppliers (id, name, lead_time_days) VALUES (1, 'Fab', 30)").run()
    db.prepare("INSERT INTO products (id, woo_product_id, sku, name, supplier_id) VALUES (10, 1, 'A', 'A', 1), (11, 2, 'B', 'B', 1)").run()

    upsertAlias(db, 1, 10, 'AB-12', 'Rope black')
    upsertAlias(db, 1, 11, 'ab 12', 'Rope black v2')

    const map = getAliasMap(db, 1)
    expect(map.size).toBe(1)
    expect(map.get('ab12')).toBe(11)
  })
})
