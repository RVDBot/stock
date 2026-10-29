import type Database from 'better-sqlite3'

// Supplier codes vary in punctuation/spacing between documents ("SR-PRO 3m" vs "srpro3m")
export function normalizeCode(code: string): string {
  return code.trim().toLowerCase().replace(/[\s\-._/]+/g, '')
}

export function normalizeDescription(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Code is the reliable key; fall back to the description when a document has no codes
export function aliasKey(code?: string | null, description?: string | null): string | null {
  const c = code ? normalizeCode(code) : ''
  if (c) return c
  const d = description ? normalizeDescription(description) : ''
  return d ? `name:${d}` : null
}

export interface AliasRow {
  supplier_code: string | null
  supplier_description: string | null
  product_id: number
}

export function upsertAlias(db: Database.Database, supplierId: number, productId: number, code?: string | null, description?: string | null) {
  const key = aliasKey(code, description)
  if (!key) return
  db.prepare(`
    INSERT INTO supplier_product_aliases (supplier_id, alias_key, supplier_code, supplier_description, product_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(supplier_id, alias_key) DO UPDATE SET
      product_id = excluded.product_id,
      supplier_code = excluded.supplier_code,
      supplier_description = excluded.supplier_description,
      updated_at = CURRENT_TIMESTAMP
  `).run(supplierId, key, code || null, description || null, productId)
}

export function getAliases(db: Database.Database, supplierId: number): AliasRow[] {
  return db.prepare('SELECT supplier_code, supplier_description, product_id FROM supplier_product_aliases WHERE supplier_id = ? ORDER BY updated_at DESC')
    .all(supplierId) as AliasRow[]
}

export function getAliasMap(db: Database.Database, supplierId: number): Map<string, number> {
  const rows = db.prepare('SELECT alias_key, product_id FROM supplier_product_aliases WHERE supplier_id = ?')
    .all(supplierId) as { alias_key: string; product_id: number }[]
  return new Map(rows.map(r => [r.alias_key, r.product_id]))
}
