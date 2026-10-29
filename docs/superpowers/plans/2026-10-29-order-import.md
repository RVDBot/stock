# Bestelling uit document — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Orders met meerdere regels + orderhistorie per leverancier, een bestelling laten klaarzetten uit een screenshot/pdf via Claude met een koppelgeheugen per leverancier, en per AI-functie model + max tokens in Instellingen.

**Architecture:** Nieuwe tabel `orders` boven de bestaande `purchase_orders` (die orderregels worden), plus `supplier_product_aliases` als koppelgeheugen. Server-logica zit in kleine `lib/`-modules die een `db` meekrijgen (testbaar met in-memory SQLite); client-veilige types/constanten staan apart. Eén Claude-aanroep met geforceerde tool-output, daarna server-side nabewerking waarin het geheugen altijd wint. UI in twee nieuwe componenten die de leverancierspagina gebruikt.

**Tech Stack:** Next.js 15.5 (app router), React 19, better-sqlite3, @anthropic-ai/sdk 0.80, Tailwind 4, Vitest (nieuw).

**Spec:** `docs/superpowers/specs/2026-10-29-order-import-design.md`

## Global Constraints

- Alle UI-teksten en API-foutmeldingen in het Nederlands, in de toon van de bestaande code.
- Producten van een leverancier altijd filteren op `active = 1 AND archived = 0`.
- Orderstatussen exact: `ordered`, `shipped`, `received`; "onderweg" = `ordered` of `shipped`.
- Upload: `image/png`, `image/jpeg`, `image/webp`, `application/pdf`; max 10 MB per bestand; afbeeldingen max 5 MB (Anthropic-limiet) — de browser verkleint grotere afbeeldingen eerst.
- Het geüploade bestand wordt nooit opgeslagen.
- Defaults: `event_lookup` = `claude-haiku-4-5-20251001` / 1024 tokens; `order_import` = `claude-sonnet-5-5` / 4096 tokens. Bestaande `ai_max_tokens_per_lookup` migreert naar `ai_max_tokens_event_lookup` met minimum 1024.
- `ai_token_cap` geldt voor het totaal van alle functies.
- Werk op branch `feature/order-import`; deploy start alleen bij push naar `main`. Elke commit wordt gepusht (branch). Versie naar `0.4.0` in de laatste commit vóór merge.
- Commits eindigen met `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Stijl: volg de bestaande Tailwind-klassen (`bg-surface-1`, `border-border-subtle`, `text-text-tertiary`, `text-[13px]`, `rounded-2xl`, enz.) en het `apiFetch`-patroon.

## Review Focus

1. Upload groter dan 10 MB of afbeelding > 5 MB → duidelijke melding, geen afgekapt verzoek. Next-middleware kapt bodies standaard op 10 MB af; `middlewareClientMaxBodySize` moet omhoog. (Task 5 test de grenscontrole; Task 9 controleert handmatig.)
2. Claude geeft een `product_id` terug die niet van deze leverancier is (of verzonnen) → moet `null`/`none` worden. (Task 4 test.)
3. Afgekapt antwoord (`max_tokens`) met half gevulde tool-input → geen crash, `truncated: true`, geldige regels blijven. (Task 4 test op `sanitizeExtraction`.)
4. Product wordt bij sync samengevoegd/verwijderd terwijl er aliassen of orderregels naar wijzen → aliassen verhuizen mee in plaats van te verdwijnen. (Task 2 past `lib/sync.ts` aan.)
5. Bestaande losse bestellingen na migratie: twee keer opstarten maakt geen dubbele orders, en "onderweg" telt `received` niet mee. (Task 1 en 2 testen.)

---

## File Structure

| Bestand | Status | Verantwoordelijkheid |
|---|---|---|
| `vitest.config.ts` | nieuw | testconfig met `@`-alias |
| `lib/db.ts` | wijzig | `initSchema` exporteren; migraties orders/aliases/settings |
| `lib/order-types.ts` | nieuw | client-veilige types, statussen, labels |
| `lib/aliases.ts` | nieuw | normaliseren, aliassleutel, upsert/opvragen geheugen |
| `lib/orders.ts` | nieuw | order-CRUD, validatie, `getPendingOrders` |
| `lib/stock-status.ts`, `lib/order-calculator.ts` | wijzig | "onderweg" via `getPendingOrders` |
| `lib/sync.ts` | wijzig | aliassen meenemen bij product-merge |
| `lib/ai-config.ts` | nieuw | client-veilige AI-functies, defaults, fallback-modellen |
| `lib/ai.ts` | nieuw | server: settings, API-key, token-cap, verbruik, rate limit |
| `lib/order-import.ts` | nieuw | prompt, Claude-aanroep, sanitize, matching |
| `lib/image-resize.ts` | nieuw | client: afbeelding verkleinen vóór upload |
| `app/api/orders/route.ts` | nieuw | GET/POST/PUT/DELETE orders |
| `app/api/orders/import/route.ts` | nieuw | upload → analyse |
| `app/api/ai/models/route.ts` | nieuw | modellenlijst |
| `app/api/purchase-orders/route.ts` | verwijder | vervangen door `/api/orders` |
| `app/api/events/lookup/route.ts` | wijzig | model/max tokens/verbruik via `lib/ai.ts` |
| `app/api/settings/route.ts` | wijzig | whitelist |
| `app/settings/page.tsx` | wijzig | AI per functie + verbruik per functie |
| `components/OrderForm.tsx` | nieuw | upload + regeltabel |
| `components/OrderHistory.tsx` | nieuw | orderhistorie |
| `app/suppliers/[id]/page.tsx` | wijzig | componenten inbouwen, oude form/lijst weg |
| `next.config.ts` | wijzig | `middlewareClientMaxBodySize` |
| `tests/*.test.ts` | nieuw | unit tests |

---

### Task 0: Branch

- [ ] **Step 1:** `cd ~/Developer/stock && git checkout -b feature/order-import && git push -u origin feature/order-import`

---

### Task 1: Vitest + schema-migratie

**Files:**
- Create: `vitest.config.ts`, `tests/db-migration.test.ts`
- Modify: `package.json`, `lib/db.ts`

**Interfaces:**
- Produces: `export function initSchema(db: Database.Database): void` in `lib/db.ts`; tabellen `orders`, `supplier_product_aliases`; kolommen `purchase_orders.order_id`, `.supplier_code`, `.supplier_description`; settings `ai_max_tokens_event_lookup`, `ai_tokens_event_lookup_input`, `ai_tokens_event_lookup_output`.

- [ ] **Step 1: Vitest installeren**

Run: `npm install -D vitest@3.2.4`
Voeg aan `package.json` scripts toe: `"test": "vitest run"`.

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname) } },
})
```

- [ ] **Step 2: Failing test schrijven** — `tests/db-migration.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db'

function freshDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  db.prepare("INSERT INTO suppliers (id, name, lead_time_days) VALUES (1, 'Fab', 30)").run()
  db.prepare("INSERT INTO products (id, woo_product_id, sku, name, supplier_id) VALUES (10, 1, 'SKU-A', 'Rope A', 1), (11, 2, 'SKU-B', 'Rope B', 1)").run()
  return db
}

describe('orders migration', () => {
  it('maakt van elke losse bestelling een order met één regel, en is idempotent', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO purchase_orders (supplier_id, product_id, quantity, order_date, expected_arrival, status, notes)
      VALUES (1, 10, 50, '2026-09-01', '2026-10-15', 'shipped', 'eerste'), (1, 11, 20, '2026-09-05', NULL, 'ordered', NULL)`).run()

    initSchema(db)
    initSchema(db)

    const orders = db.prepare('SELECT * FROM orders ORDER BY id').all() as { supplier_id: number; order_date: string; expected_arrival: string | null; status: string; notes: string | null }[]
    expect(orders).toHaveLength(2)
    expect(orders[0]).toMatchObject({ supplier_id: 1, order_date: '2026-09-01', expected_arrival: '2026-10-15', status: 'shipped', notes: 'eerste' })
    expect(orders[1]).toMatchObject({ order_date: '2026-09-05', status: 'ordered' })

    const unlinked = db.prepare('SELECT COUNT(*) as n FROM purchase_orders WHERE order_id IS NULL').get() as { n: number }
    expect(unlinked.n).toBe(0)
  })

  it('migreert max tokens van de datumzoeker met een minimum van 1024', () => {
    const db = freshDb()
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_max_tokens_per_lookup', '100')").run()
    initSchema(db)
    const get = (k: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value
    expect(get('ai_max_tokens_event_lookup')).toBe('1024')
    expect(get('ai_max_tokens_per_lookup')).toBeUndefined()
  })

  it('neemt een hogere oude waarde over', () => {
    const db = freshDb()
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_max_tokens_per_lookup', '2048')").run()
    initSchema(db)
    const row = db.prepare("SELECT value FROM settings WHERE key = 'ai_max_tokens_event_lookup'").get() as { value: string }
    expect(row.value).toBe('2048')
  })

  it('kent bestaand totaalverbruik eenmalig toe aan de datumzoeker', () => {
    const db = freshDb()
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_total_input_tokens', '500'), ('ai_total_output_tokens', '70')").run()
    initSchema(db)
    db.prepare("UPDATE settings SET value = '900' WHERE key = 'ai_total_input_tokens'").run()
    initSchema(db)
    const get = (k: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string }).value
    expect(get('ai_tokens_event_lookup_input')).toBe('500')
    expect(get('ai_tokens_event_lookup_output')).toBe('70')
  })
})
```

- [ ] **Step 3: Run** `npm test` — Expected: FAIL (`initSchema` is not exported).

- [ ] **Step 4: Implementatie in `lib/db.ts`**

Verander `function initSchema(db: Database.Database) {` in `export function initSchema(db: Database.Database) {`. Voeg aan het einde van `initSchema` (na de events-migraties) toe:

```ts
  // Orders: purchase_orders become order lines grouped under an order
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id      INTEGER NOT NULL REFERENCES suppliers(id),
      order_date       TEXT NOT NULL,
      supplier_ref     TEXT,
      expected_arrival TEXT,
      status           TEXT NOT NULL DEFAULT 'ordered',
      notes            TEXT,
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS supplier_product_aliases (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id          INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      alias_key            TEXT NOT NULL,
      supplier_code        TEXT,
      supplier_description TEXT,
      product_id           INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (supplier_id, alias_key)
    );
  `)

  const poCols = new Set((db.prepare("PRAGMA table_info(purchase_orders)").all() as { name: string }[]).map(c => c.name))
  if (!poCols.has('order_id')) {
    db.exec(`
      ALTER TABLE purchase_orders ADD COLUMN order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE;
      ALTER TABLE purchase_orders ADD COLUMN supplier_code TEXT;
      ALTER TABLE purchase_orders ADD COLUMN supplier_description TEXT;
    `)
  }

  // Each legacy single-product order becomes an order with one line
  const loose = db.prepare('SELECT * FROM purchase_orders WHERE order_id IS NULL').all() as {
    id: number; supplier_id: number; order_date: string; expected_arrival: string | null
    status: string; notes: string | null; created_at: string
  }[]
  if (loose.length > 0) {
    const insertOrder = db.prepare('INSERT INTO orders (supplier_id, order_date, expected_arrival, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    const link = db.prepare('UPDATE purchase_orders SET order_id = ? WHERE id = ?')
    db.transaction(() => {
      for (const po of loose) {
        const r = insertOrder.run(po.supplier_id, po.order_date, po.expected_arrival, po.status, po.notes, po.created_at)
        link.run(r.lastInsertRowid, po.id)
      }
    })()
  }

  // AI settings per function: old event-lookup max tokens (was never applied; web search needs ≥1024)
  const oldMax = db.prepare("SELECT value FROM settings WHERE key = 'ai_max_tokens_per_lookup'").get() as { value: string } | undefined
  if (oldMax) {
    const value = Math.max(1024, parseInt(oldMax.value, 10) || 0)
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_max_tokens_event_lookup', ?)").run(String(value))
    db.prepare("DELETE FROM settings WHERE key = 'ai_max_tokens_per_lookup'").run()
  }
  // All usage so far came from the event lookup
  const hasFnUsage = db.prepare("SELECT 1 FROM settings WHERE key = 'ai_tokens_event_lookup_input'").get()
  if (!hasFnUsage) {
    db.prepare(`INSERT INTO settings (key, value)
      SELECT 'ai_tokens_event_lookup_input', value FROM settings WHERE key = 'ai_total_input_tokens'`).run()
    db.prepare(`INSERT INTO settings (key, value)
      SELECT 'ai_tokens_event_lookup_output', value FROM settings WHERE key = 'ai_total_output_tokens'`).run()
  }
```

- [ ] **Step 5: Run** `npm test` — Expected: 4 passed.

- [ ] **Step 6: Commit + push**
```bash
git add package.json package-lock.json vitest.config.ts lib/db.ts tests/db-migration.test.ts
git commit -m "Add orders/aliases schema with migration of legacy purchase orders"
git push
```

---

### Task 2: Orders-domein, geheugen en "onderweg"

**Files:**
- Create: `lib/order-types.ts`, `lib/aliases.ts`, `lib/orders.ts`, `tests/aliases.test.ts`, `tests/orders.test.ts`
- Modify: `lib/stock-status.ts:52-57`, `lib/order-calculator.ts:103-106,122`, `lib/sync.ts:138`

**Interfaces:**
- Consumes: `initSchema` (Task 1).
- Produces:
  - `lib/order-types.ts`: `OrderStatus`, `ORDER_STATUSES`, `ORDER_STATUS_LABELS`, `MatchKind`, `OrderLine`, `Order`, `OrderLineInput`, `OrderInput`, `ImportedLine`, `ImportResult` (zie code).
  - `lib/aliases.ts`: `normalizeCode(s)`, `normalizeDescription(s)`, `aliasKey(code, description): string | null`, `upsertAlias(db, supplierId, productId, code, description): void`, `getAliases(db, supplierId): AliasRow[]`, `getAliasMap(db, supplierId): Map<string, number>`.
  - `lib/orders.ts`: `getPendingOrders(db, productId)`, `listOrders(db, supplierId, filter)`, `createOrder(db, input): number`, `updateOrder(db, id, input): boolean`, `setOrderStatus(db, id, status): boolean`, `deleteOrder(db, id): boolean`, `validateOrderInput(body): { ok: true; value: OrderInput } | { ok: false; error: string }`.

- [ ] **Step 1: Types** — `lib/order-types.ts` (client-veilig, geen imports)

```ts
// Shared order types — safe to import from client components

export type OrderStatus = 'ordered' | 'shipped' | 'received'
export const ORDER_STATUSES: OrderStatus[] = ['ordered', 'shipped', 'received']
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  ordered: 'Besteld',
  shipped: 'Verzonden',
  received: 'Ontvangen',
}

export type MatchKind = 'memory' | 'confident' | 'uncertain' | 'none'

export interface OrderLine {
  id: number
  product_id: number
  sku: string
  name: string
  quantity: number
  supplier_code: string | null
  supplier_description: string | null
}

export interface Order {
  id: number
  supplier_id: number
  order_date: string
  supplier_ref: string | null
  expected_arrival: string | null
  status: OrderStatus
  notes: string | null
  created_at: string
  lines: OrderLine[]
}

export interface OrderLineInput {
  product_id: number
  quantity: number
  supplier_code?: string | null
  supplier_description?: string | null
  remember?: boolean
}

export interface OrderInput {
  supplier_id: number
  order_date: string
  supplier_ref?: string | null
  expected_arrival?: string | null
  notes?: string | null
  lines: OrderLineInput[]
}

export interface ImportedLine {
  supplier_code: string | null
  supplier_description: string
  quantity: number
  product_id: number | null
  match: MatchKind
}

export interface ImportResult {
  order_date: string | null
  supplier_ref: string | null
  lines: ImportedLine[]
  truncated: boolean
}
```

- [ ] **Step 2: Failing tests** — `tests/aliases.test.ts`

```ts
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
```

`tests/orders.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db'
import { createOrder, updateOrder, setOrderStatus, deleteOrder, listOrders, getPendingOrders, validateOrderInput } from '@/lib/orders'
import { getAliasMap } from '@/lib/aliases'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  db.prepare("INSERT INTO suppliers (id, name, lead_time_days) VALUES (1, 'Fab', 30)").run()
  db.prepare("INSERT INTO products (id, woo_product_id, sku, name, supplier_id) VALUES (10, 1, 'SKU-A', 'Rope A', 1), (11, 2, 'SKU-B', 'Rope B', 1)").run()
})

const base = { supplier_id: 1, order_date: '2026-10-01', supplier_ref: 'PI-1', expected_arrival: '2026-11-15', notes: null }

describe('orders', () => {
  it('maakt een order met regels en geeft hem terug in de lijst', () => {
    const id = createOrder(db, { ...base, lines: [{ product_id: 10, quantity: 50, supplier_code: 'X1', supplier_description: 'Rope black' }, { product_id: 11, quantity: 5 }] })
    const [order] = listOrders(db, 1, 'all')
    expect(order.id).toBe(id)
    expect(order.supplier_ref).toBe('PI-1')
    expect(order.lines.map(l => [l.product_id, l.quantity, l.sku])).toEqual([[10, 50, 'SKU-A'], [11, 5, 'SKU-B']])
  })

  it('onthoudt alleen regels met remember', () => {
    createOrder(db, { ...base, lines: [{ product_id: 10, quantity: 1, supplier_code: 'X1', remember: true }, { product_id: 11, quantity: 1, supplier_code: 'X2' }] })
    const map = getAliasMap(db, 1)
    expect(map.get('x1')).toBe(10)
    expect(map.has('x2')).toBe(false)
  })

  it('telt alleen besteld en verzonden als onderweg', () => {
    const a = createOrder(db, { ...base, lines: [{ product_id: 10, quantity: 50 }] })
    createOrder(db, { ...base, expected_arrival: null, lines: [{ product_id: 10, quantity: 7 }] })
    expect(getPendingOrders(db, 10).reduce((s, o) => s + o.quantity, 0)).toBe(57)
    setOrderStatus(db, a, 'received')
    expect(getPendingOrders(db, 10)).toEqual([{ quantity: 7, expected_arrival: null }])
  })

  it('filtert open orders', () => {
    const a = createOrder(db, { ...base, lines: [{ product_id: 10, quantity: 1 }] })
    createOrder(db, { ...base, lines: [{ product_id: 11, quantity: 1 }] })
    setOrderStatus(db, a, 'received')
    expect(listOrders(db, 1, 'open')).toHaveLength(1)
    expect(listOrders(db, 1, 'all')).toHaveLength(2)
  })

  it('vervangt regels bij update en verwijdert order met regels', () => {
    const id = createOrder(db, { ...base, lines: [{ product_id: 10, quantity: 1 }] })
    expect(updateOrder(db, id, { ...base, supplier_ref: 'PI-2', lines: [{ product_id: 11, quantity: 9 }] })).toBe(true)
    const [order] = listOrders(db, 1, 'all')
    expect(order.supplier_ref).toBe('PI-2')
    expect(order.lines.map(l => l.product_id)).toEqual([11])
    expect(deleteOrder(db, id)).toBe(true)
    expect((db.prepare('SELECT COUNT(*) n FROM purchase_orders').get() as { n: number }).n).toBe(0)
    expect(updateOrder(db, 999, { ...base, lines: [{ product_id: 10, quantity: 1 }] })).toBe(false)
  })
})

describe('validateOrderInput', () => {
  const ok = { supplier_id: 1, order_date: '2026-10-01', lines: [{ product_id: 10, quantity: 3 }] }
  it('accepteert een geldige order en maakt lege velden null', () => {
    const r = validateOrderInput({ ...ok, supplier_ref: '', expected_arrival: '', notes: '' })
    expect(r).toEqual({ ok: true, value: { ...ok, supplier_ref: null, expected_arrival: null, notes: null, lines: [{ product_id: 10, quantity: 3, supplier_code: null, supplier_description: null, remember: false }] } })
  })
  it('weigert een order zonder regels, met aantal 0, of met ongeldige datum', () => {
    expect(validateOrderInput({ ...ok, lines: [] }).ok).toBe(false)
    expect(validateOrderInput({ ...ok, lines: [{ product_id: 10, quantity: 0 }] }).ok).toBe(false)
    expect(validateOrderInput({ ...ok, order_date: '1-10-2026' }).ok).toBe(false)
    expect(validateOrderInput(null).ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run** `npm test` — Expected: FAIL (modules ontbreken).

- [ ] **Step 4: `lib/aliases.ts`**

```ts
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
```

- [ ] **Step 5: `lib/orders.ts`**

```ts
import type Database from 'better-sqlite3'
import { upsertAlias } from '@/lib/aliases'
import { isPositiveInt, isDateString } from '@/lib/validate'
import { ORDER_STATUSES, type Order, type OrderInput, type OrderLine, type OrderLineInput, type OrderStatus } from '@/lib/order-types'

const PENDING_STATUSES = "('ordered', 'shipped')"

// Stock on its way for one product — shared by stock-status and order-calculator
export function getPendingOrders(db: Database.Database, productId: number): { quantity: number; expected_arrival: string | null }[] {
  return db.prepare(`
    SELECT po.quantity, o.expected_arrival
    FROM purchase_orders po
    JOIN orders o ON o.id = po.order_id
    WHERE po.product_id = ? AND o.status IN ${PENDING_STATUSES}
  `).all(productId) as { quantity: number; expected_arrival: string | null }[]
}

export function listOrders(db: Database.Database, supplierId: number, filter: 'open' | 'all'): Order[] {
  const where = filter === 'open' ? `AND status IN ${PENDING_STATUSES}` : ''
  const orders = db.prepare(`SELECT * FROM orders WHERE supplier_id = ? ${where} ORDER BY order_date DESC, id DESC`)
    .all(supplierId) as Omit<Order, 'lines'>[]
  const linesStmt = db.prepare(`
    SELECT po.id, po.product_id, p.sku, p.name, po.quantity, po.supplier_code, po.supplier_description
    FROM purchase_orders po
    JOIN products p ON p.id = po.product_id
    WHERE po.order_id = ?
    ORDER BY po.id
  `)
  return orders.map(o => ({ ...o, lines: linesStmt.all(o.id) as OrderLine[] }))
}

function insertLines(db: Database.Database, orderId: number, input: OrderInput) {
  // order_date is still NOT NULL on the legacy line columns; status/arrival live on the order
  const insert = db.prepare(`
    INSERT INTO purchase_orders (order_id, supplier_id, product_id, quantity, order_date, supplier_code, supplier_description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  for (const line of input.lines) {
    insert.run(orderId, input.supplier_id, line.product_id, line.quantity, input.order_date, line.supplier_code || null, line.supplier_description || null)
    if (line.remember) upsertAlias(db, input.supplier_id, line.product_id, line.supplier_code, line.supplier_description)
  }
}

export function createOrder(db: Database.Database, input: OrderInput): number {
  return db.transaction(() => {
    const r = db.prepare('INSERT INTO orders (supplier_id, order_date, supplier_ref, expected_arrival, notes) VALUES (?, ?, ?, ?, ?)')
      .run(input.supplier_id, input.order_date, input.supplier_ref || null, input.expected_arrival || null, input.notes || null)
    const orderId = Number(r.lastInsertRowid)
    insertLines(db, orderId, input)
    return orderId
  })()
}

export function updateOrder(db: Database.Database, id: number, input: OrderInput): boolean {
  return db.transaction(() => {
    const r = db.prepare('UPDATE orders SET supplier_id = ?, order_date = ?, supplier_ref = ?, expected_arrival = ?, notes = ? WHERE id = ?')
      .run(input.supplier_id, input.order_date, input.supplier_ref || null, input.expected_arrival || null, input.notes || null, id)
    if (r.changes === 0) return false
    db.prepare('DELETE FROM purchase_orders WHERE order_id = ?').run(id)
    insertLines(db, id, input)
    return true
  })()
}

export function setOrderStatus(db: Database.Database, id: number, status: OrderStatus): boolean {
  return db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id).changes > 0
}

export function deleteOrder(db: Database.Database, id: number): boolean {
  return db.transaction(() => {
    db.prepare('DELETE FROM purchase_orders WHERE order_id = ?').run(id)
    return db.prepare('DELETE FROM orders WHERE id = ?').run(id).changes > 0
  })()
}

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === 'string' && (ORDER_STATUSES as string[]).includes(v)
}

function optionalText(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string') return undefined
  return v.trim().slice(0, max) || null
}

export function validateOrderInput(body: unknown): { ok: true; value: OrderInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Ongeldige invoer' }
  const b = body as Record<string, unknown>
  if (!isPositiveInt(b.supplier_id)) return { ok: false, error: 'supplier_id is verplicht' }
  if (!isDateString(b.order_date)) return { ok: false, error: 'Besteldatum is verplicht (JJJJ-MM-DD)' }
  if (b.expected_arrival !== undefined && b.expected_arrival !== null && b.expected_arrival !== '' && !isDateString(b.expected_arrival)) {
    return { ok: false, error: 'Ongeldige verwachte aankomst' }
  }
  const supplierRef = optionalText(b.supplier_ref, 100)
  const notes = optionalText(b.notes, 2000)
  if (supplierRef === undefined || notes === undefined) return { ok: false, error: 'Ongeldige tekstvelden' }
  if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 500) {
    return { ok: false, error: 'Een bestelling heeft minimaal één regel nodig' }
  }
  const lines: OrderLineInput[] = []
  for (const raw of b.lines) {
    const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    if (!isPositiveInt(l.product_id)) return { ok: false, error: 'Elke regel heeft een product nodig' }
    if (!isPositiveInt(l.quantity) || l.quantity > 1_000_000) return { ok: false, error: 'Elke regel heeft een aantal van minimaal 1 nodig' }
    const code = optionalText(l.supplier_code, 200)
    const description = optionalText(l.supplier_description, 500)
    if (code === undefined || description === undefined) return { ok: false, error: 'Ongeldige regelgegevens' }
    lines.push({ product_id: l.product_id, quantity: l.quantity, supplier_code: code, supplier_description: description, remember: l.remember === true })
  }
  return {
    ok: true,
    value: {
      supplier_id: b.supplier_id,
      order_date: b.order_date,
      supplier_ref: supplierRef,
      expected_arrival: isDateString(b.expected_arrival) ? b.expected_arrival : null,
      notes,
      lines,
    },
  }
}
```

- [ ] **Step 6: Run** `npm test` — Expected: alle tests PASS.

- [ ] **Step 7: Consumers aanpassen**

`lib/stock-status.ts` — import toevoegen `import { getPendingOrders } from '@/lib/orders'` en het blok

```ts
  const pendingOrders = db.prepare(`
    SELECT quantity, expected_arrival
    FROM purchase_orders
    WHERE product_id = ? AND status IN ('ordered', 'shipped')
  `).all(productId) as { quantity: number; expected_arrival: string | null }[]
```
vervangen door
```ts
  const pendingOrders = getPendingOrders(db, productId)
```

`lib/order-calculator.ts` — import `getPendingOrders`; het `pendingStmt`-blok (regel ~102-106, incl. de comment) verwijderen en regel ~122 wordt:
```ts
    // Stock already on its way counts towards what we need (same statuses as stock-status.ts)
    const pendingQty = getPendingOrders(db, product.id).reduce((s, o) => s + o.quantity, 0)
```

`lib/sync.ts` — direct na `db.prepare('UPDATE purchase_orders SET product_id = ? WHERE product_id = ?').run(keepId, oldId)`:
```ts
          db.prepare('UPDATE supplier_product_aliases SET product_id = ? WHERE product_id = ?').run(keepId, oldId)
```

- [ ] **Step 8: Run** `npm test && npx tsc --noEmit` — Expected: PASS, geen typefouten (de leverancierspagina gebruikt nog `/api/purchase-orders`; die blijft tot Task 8 bestaan).

- [ ] **Step 9: Commit + push**
```bash
git add lib/order-types.ts lib/aliases.ts lib/orders.ts lib/stock-status.ts lib/order-calculator.ts lib/sync.ts tests/aliases.test.ts tests/orders.test.ts
git commit -m "Add order domain with line items, alias memory and pending-stock via order status"
git push
```

---

### Task 3: AI-config per functie

**Files:**
- Create: `lib/ai-config.ts`, `lib/ai.ts`, `app/api/ai/models/route.ts`, `tests/ai.test.ts`
- Modify: `app/api/events/lookup/route.ts`, `app/api/settings/route.ts:9-15`

**Interfaces:**
- Produces:
  - `lib/ai-config.ts`: `type AiFunction = 'event_lookup' | 'order_import'`, `AI_FUNCTIONS: Record<AiFunction, { label: string; defaultModel: string; defaultMaxTokens: number }>`, `AI_FUNCTION_KEYS: AiFunction[]`, `FALLBACK_MODELS: { id: string; name: string }[]`, `MAX_TOKENS_LIMIT = 32000`, `modelSettingKey(fn)`, `maxTokensSettingKey(fn)`, `usageSettingKey(fn, 'input' | 'output')`.
  - `lib/ai.ts`: `getSettingInt(db, key, fallback)`, `getAiConfig(db, fn): { model: string; maxTokens: number }`, `getClaudeApiKey(db): string | undefined`, `checkTokenCap(db): string | null`, `addTokenUsage(db, fn, input, output)`, `checkRateLimit(ip): boolean`.

- [ ] **Step 1: `lib/ai-config.ts`**

```ts
// AI function config — safe to import from client components

export type AiFunction = 'event_lookup' | 'order_import'

export const AI_FUNCTIONS: Record<AiFunction, { label: string; defaultModel: string; defaultMaxTokens: number }> = {
  event_lookup: { label: 'Datum opzoeken (events)', defaultModel: 'claude-haiku-4-5-20251001', defaultMaxTokens: 1024 },
  order_import: { label: 'Bestelling uit document', defaultModel: 'claude-sonnet-5-5', defaultMaxTokens: 4096 },
}

export const AI_FUNCTION_KEYS = Object.keys(AI_FUNCTIONS) as AiFunction[]

// Used when the live model list can't be fetched
export const FALLBACK_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
]

export const MAX_TOKENS_LIMIT = 32000

export const modelSettingKey = (fn: AiFunction) => `ai_model_${fn}`
export const maxTokensSettingKey = (fn: AiFunction) => `ai_max_tokens_${fn}`
export const usageSettingKey = (fn: AiFunction, kind: 'input' | 'output') => `ai_tokens_${fn}_${kind}`
```

- [ ] **Step 2: Failing test** — `tests/ai.test.ts`

```ts
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
    expect(getAiConfig(db, 'order_import')).toEqual({ model: 'claude-opus-5-5', maxTokens: 32000 })
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
})
```

- [ ] **Step 3: Run** `npm test` — Expected: FAIL (`@/lib/ai` ontbreekt).

- [ ] **Step 4: `lib/ai.ts`** (overgenomen uit `app/api/events/lookup/route.ts` en uitgebreid)

```ts
import type Database from 'better-sqlite3'
import { decryptValue } from '@/lib/encrypt'
import { AI_FUNCTIONS, MAX_TOKENS_LIMIT, maxTokensSettingKey, modelSettingKey, usageSettingKey, type AiFunction } from '@/lib/ai-config'

export function getSetting(db: Database.Database, key: string): string | undefined {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value
}

export function getSettingInt(db: Database.Database, key: string, fallback: number): number {
  const row = getSetting(db, key)
  return row ? parseInt(row, 10) || fallback : fallback
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
```

- [ ] **Step 5: Run** `npm test` — Expected: PASS.

- [ ] **Step 6: `app/api/events/lookup/route.ts` ombouwen**

Verwijder `LOOKUP_WINDOW_MS`, `MAX_LOOKUPS`, `lookupCounts`, `getSettingInt`, `addTokenUsage` en de `decryptValue`-import. Imports worden:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import Anthropic from '@anthropic-ai/sdk'
import { log } from '@/lib/logger'
import { getAiConfig, getClaudeApiKey, checkTokenCap, addTokenUsage, checkRateLimit } from '@/lib/ai'
```
Rate limit-blok wordt:
```ts
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Te veel verzoeken. Probeer het over een minuut opnieuw.' }, { status: 429 })
  }
```
API-key + cap-blok wordt:
```ts
  const apiKey = getClaudeApiKey(db)
  if (!apiKey) {
    return NextResponse.json({ error: 'Claude API key niet geconfigureerd. Ga naar Instellingen.' }, { status: 400 })
  }

  const capError = checkTokenCap(db)
  if (capError) {
    return NextResponse.json({ error: capError }, { status: 429 })
  }

  const { model, maxTokens } = getAiConfig(db, 'event_lookup')
```
In `messages.create`: `model: model,` en `max_tokens: maxTokens,`. Token-registratie: `addTokenUsage(db, 'event_lookup', message.usage.input_tokens, message.usage.output_tokens)`. In de twee `log(...)`-regels `web search)` → `${model})` zodat het model in de log staat.

- [ ] **Step 7: Settings-whitelist** — in `app/api/settings/route.ts` wordt `ALLOWED_WRITE_KEYS`:
```ts
const ALLOWED_WRITE_KEYS = new Set([
  'woo_url', 'woo_consumer_key', 'woo_consumer_secret',
  'claude_api_key', 'ai_token_cap',
  ...AI_FUNCTION_KEYS.flatMap(fn => [modelSettingKey(fn), maxTokensSettingKey(fn)]),
  'warehouse_inbound_days', 'safety_margin_days',
  'last_sync_at', 'last_sync_status',
  'ai_total_input_tokens', 'ai_total_output_tokens',
])
```
met `import { AI_FUNCTION_KEYS, modelSettingKey, maxTokensSettingKey } from '@/lib/ai-config'`.

- [ ] **Step 8: `app/api/ai/models/route.ts`**

```ts
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
```

- [ ] **Step 9: Run** `npm test && npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 10: Commit + push**
```bash
git add lib/ai-config.ts lib/ai.ts app/api/ai/models/route.ts app/api/events/lookup/route.ts app/api/settings/route.ts tests/ai.test.ts
git commit -m "Add per-function AI model and max tokens; event lookup now honours them"
git push
```

---

### Task 4: Documentanalyse

**Files:**
- Create: `lib/order-import.ts`, `tests/order-import.test.ts`

**Interfaces:**
- Consumes: `aliasKey`, `AliasRow` (Task 2); `ImportedLine`, `ImportResult`, `MatchKind` (Task 2).
- Produces:
  - `interface Extraction { order_date: string | null; supplier_ref: string | null; lines: ExtractedLine[] }`, `interface ExtractedLine { supplier_code: string | null; supplier_description: string; quantity: number; product_id: number | null; confidence: 'high' | 'low' }`
  - `sanitizeExtraction(raw: unknown): Extraction`
  - `resolveMatches(extraction: Extraction, validProductIds: Set<number>, aliasMap: Map<string, number>): Omit<ImportResult, 'truncated'>`
  - `buildImportPrompt(products: ImportProduct[], aliases: AliasRow[]): string`, `interface ImportProduct { id: number; sku: string; name: string }`
  - `analyzeOrderDocument(opts: { apiKey: string; model: string; maxTokens: number; mediaType: string; base64: string; products: ImportProduct[]; aliases: AliasRow[] }): Promise<{ extraction: Extraction; truncated: boolean; usage: { input: number; output: number } }>`
  - `ALLOWED_IMPORT_TYPES: Set<string>`, `MAX_IMPORT_BYTES = 10 * 1024 * 1024`, `MAX_IMAGE_BYTES = 5 * 1024 * 1024`

- [ ] **Step 1: Failing test** — `tests/order-import.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { sanitizeExtraction, resolveMatches, buildImportPrompt } from '@/lib/order-import'

describe('sanitizeExtraction', () => {
  it('maakt van afgekapte of rommelige input een geldige extractie', () => {
    expect(sanitizeExtraction(undefined)).toEqual({ order_date: null, supplier_ref: null, lines: [] })
    const r = sanitizeExtraction({
      order_date: '12-10-2026',
      supplier_ref: '  PI-4521 ',
      lines: [
        { supplier_code: 'A1', supplier_description: 'Rope black', quantity: '120', product_id: 10, confidence: 'high' },
        { supplier_description: 'Handle', quantity: 3.6, product_id: 'x' },
        { quantity: 5 },
        'rommel',
      ],
    })
    expect(r.order_date).toBeNull()
    expect(r.supplier_ref).toBe('PI-4521')
    expect(r.lines).toEqual([
      { supplier_code: 'A1', supplier_description: 'Rope black', quantity: 120, product_id: 10, confidence: 'high' },
      { supplier_code: null, supplier_description: 'Handle', quantity: 4, product_id: null, confidence: 'low' },
    ])
  })
})

describe('resolveMatches', () => {
  const valid = new Set([10, 11])
  const line = (o: object) => ({ supplier_code: null, supplier_description: 'x', quantity: 1, product_id: null, confidence: 'high' as const, ...o })

  it('laat het geheugen winnen van Claude', () => {
    const r = resolveMatches({ order_date: '2026-10-12', supplier_ref: null, lines: [line({ supplier_code: 'AB-12', product_id: 11 })] }, valid, new Map([['ab12', 10]]))
    expect(r.lines[0]).toMatchObject({ product_id: 10, match: 'memory' })
    expect(r.order_date).toBe('2026-10-12')
  })

  it('gebruikt het geheugen op omschrijving als er geen code is', () => {
    const r = resolveMatches({ order_date: null, supplier_ref: null, lines: [line({ supplier_description: 'Rope  Black' })] }, valid, new Map([['name:rope black', 11]]))
    expect(r.lines[0]).toMatchObject({ product_id: 11, match: 'memory' })
  })

  it('negeert product_ids buiten deze leverancier, ook uit het geheugen', () => {
    const r = resolveMatches({ order_date: null, supplier_ref: null, lines: [line({ supplier_code: 'Z', product_id: 99 })] }, valid, new Map([['z', 42]]))
    expect(r.lines[0]).toMatchObject({ product_id: null, match: 'none' })
  })

  it('vertaalt zekerheid naar confident/uncertain', () => {
    const r = resolveMatches({ order_date: null, supplier_ref: null, lines: [line({ product_id: 10 }), line({ product_id: 11, confidence: 'low' })] }, valid, new Map())
    expect(r.lines.map(l => l.match)).toEqual(['confident', 'uncertain'])
  })
})

describe('buildImportPrompt', () => {
  it('bevat producten en bekende koppelingen', () => {
    const p = buildImportPrompt([{ id: 10, sku: 'SKU-A', name: 'Rope A Black' }], [{ supplier_code: 'X1', supplier_description: 'Rope blk', product_id: 10 }])
    expect(p).toContain('10 | SKU-A | Rope A Black')
    expect(p).toContain('X1')
  })
})
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL (module ontbreekt).

- [ ] **Step 3: `lib/order-import.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk'
import { aliasKey, type AliasRow } from '@/lib/aliases'
import { isDateString } from '@/lib/validate'
import type { ImportResult, ImportedLine, MatchKind } from '@/lib/order-types'

export const ALLOWED_IMPORT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // Anthropic image limit

export interface ImportProduct { id: number; sku: string; name: string }

export interface ExtractedLine {
  supplier_code: string | null
  supplier_description: string
  quantity: number
  product_id: number | null
  confidence: 'high' | 'low'
}

export interface Extraction {
  order_date: string | null
  supplier_ref: string | null
  lines: ExtractedLine[]
}

const TOOL_NAME = 'register_order'

const EXTRACT_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'Registreer de bestelling zoals die in het document staat.',
  input_schema: {
    type: 'object',
    properties: {
      order_date: { type: ['string', 'null'], description: 'Besteldatum of documentdatum als YYYY-MM-DD, null als die er niet staat' },
      supplier_ref: { type: ['string', 'null'], description: 'Order-, proforma- of factuurnummer van de fabrikant, null als het ontbreekt' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            supplier_code: { type: ['string', 'null'], description: 'Artikelcode van de fabrikant zoals in het document' },
            supplier_description: { type: 'string', description: 'Omschrijving zoals in het document, inclusief kleur/variant' },
            quantity: { type: 'number', description: 'Bestelde aantal stuks' },
            product_id: { type: ['integer', 'null'], description: 'id uit de productlijst, of null als je het niet zeker weet' },
            confidence: { type: 'string', enum: ['high', 'low'], description: 'high alleen als naam én kleur/variant duidelijk overeenkomen' },
          },
          required: ['supplier_code', 'supplier_description', 'quantity', 'product_id', 'confidence'],
        },
      },
    },
    required: ['order_date', 'supplier_ref', 'lines'],
  },
}

export function buildImportPrompt(products: ImportProduct[], aliases: AliasRow[]): string {
  const productList = products.map(p => `${p.id} | ${p.sku} | ${p.name}`).join('\n')
  const aliasList = aliases.length > 0
    ? aliases.map(a => `${a.supplier_code ?? '-'} | ${a.supplier_description ?? '-'} → ${a.product_id}`).join('\n')
    : '(nog geen)'
  return `Dit document is een bestelling, orderbevestiging, proforma of factuur van een fabrikant.
Haal elke bestelde productregel eruit en registreer de bestelling met de tool ${TOOL_NAME}.

De fabrikant gebruikt eigen artikelcodes. Koppel elke regel aan een product uit onderstaande lijst op basis van productnaam en kleur/variant (bijv. lengte, maat).
- Kies alleen een id uit de lijst; verzin nooit een id.
- Twijfel je tussen meerdere producten, of past geen product: product_id = null.
- confidence = "high" alleen als naam én kleur/variant duidelijk overeenkomen, anders "low".
- Sla regels over die geen product zijn (verzendkosten, korting, btw, totalen).

Producten van deze leverancier (id | SKU | naam):
${productList}

Eerder bevestigde koppelingen (fabrikantcode | omschrijving → id):
${aliasList}`
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, max)
  return t || null
}

// Tool input may be partial when the response hit max_tokens — keep only well-formed lines
export function sanitizeExtraction(raw: unknown): Extraction {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const lines: ExtractedLine[] = []
  for (const item of Array.isArray(r.lines) ? r.lines : []) {
    if (!item || typeof item !== 'object') continue
    const l = item as Record<string, unknown>
    const description = text(l.supplier_description, 500)
    if (!description) continue
    const qty = Math.round(Number(l.quantity))
    lines.push({
      supplier_code: text(l.supplier_code, 200),
      supplier_description: description,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 0,
      product_id: Number.isInteger(l.product_id) ? (l.product_id as number) : null,
      confidence: l.confidence === 'high' ? 'high' : 'low',
    })
  }
  return {
    order_date: isDateString(r.order_date) ? r.order_date : null,
    supplier_ref: text(r.supplier_ref, 100),
    lines,
  }
}

export function resolveMatches(extraction: Extraction, validProductIds: Set<number>, aliasMap: Map<string, number>): Omit<ImportResult, 'truncated'> {
  const lines: ImportedLine[] = extraction.lines.map(l => {
    const key = aliasKey(l.supplier_code, l.supplier_description)
    const remembered = key ? aliasMap.get(key) : undefined
    let productId: number | null
    let match: MatchKind
    if (remembered !== undefined && validProductIds.has(remembered)) {
      productId = remembered
      match = 'memory'
    } else if (l.product_id !== null && validProductIds.has(l.product_id)) {
      productId = l.product_id
      match = l.confidence === 'high' ? 'confident' : 'uncertain'
    } else {
      productId = null
      match = 'none'
    }
    return { supplier_code: l.supplier_code, supplier_description: l.supplier_description, quantity: l.quantity, product_id: productId, match }
  })
  return { order_date: extraction.order_date, supplier_ref: extraction.supplier_ref, lines }
}

export async function analyzeOrderDocument(opts: {
  apiKey: string; model: string; maxTokens: number
  mediaType: string; base64: string
  products: ImportProduct[]; aliases: AliasRow[]
}): Promise<{ extraction: Extraction; truncated: boolean; usage: { input: number; output: number } }> {
  const client = new Anthropic({ apiKey: opts.apiKey })
  const documentBlock: Anthropic.ContentBlockParam = opts.mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: opts.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: opts.mediaType as 'image/png' | 'image/jpeg' | 'image/webp', data: opts.base64 } }

  const message = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{
      role: 'user',
      content: [documentBlock, { type: 'text', text: buildImportPrompt(opts.products, opts.aliases) }],
    }],
  })

  const toolUse = message.content.find(b => b.type === 'tool_use')
  return {
    extraction: sanitizeExtraction(toolUse?.type === 'tool_use' ? toolUse.input : undefined),
    truncated: message.stop_reason === 'max_tokens',
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
  }
}
```

- [ ] **Step 4: Run** `npm test && npx tsc --noEmit` — Expected: PASS. (Als `Anthropic.Tool`'s `input_schema` geen `type: [...]`-unie accepteert in de typing, cast het schema-object met `as Anthropic.Tool['input_schema']`.)

- [ ] **Step 5: Commit + push**
```bash
git add lib/order-import.ts tests/order-import.test.ts
git commit -m "Add document analysis for orders with memory-first product matching"
git push
```

---

### Task 5: API-routes

**Files:**
- Create: `app/api/orders/route.ts`, `app/api/orders/import/route.ts`, `tests/import-validation.test.ts`
- Modify: `next.config.ts`, `lib/order-import.ts` (validatiehelper)
- Delete: `app/api/purchase-orders/route.ts` — pas in Task 8, als de pagina is omgezet.

**Interfaces:**
- Consumes: alles uit Task 2-4.
- Produces: `GET /api/orders?supplier_id=&status=open|all` → `Order[]`; `POST /api/orders` → `{ id }` (201); `PUT /api/orders` (`{ id, status }` of `{ id, ...OrderInput }`) → `{ success: true }`; `DELETE /api/orders` (`{ id }`); `POST /api/orders/import` (multipart `supplier_id`, `file`) → `ImportResult`. Plus `validateImportFile(type: string, size: number): string | null` in `lib/order-import.ts`.

- [ ] **Step 1: Failing test** — `tests/import-validation.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { validateImportFile } from '@/lib/order-import'

const MB = 1024 * 1024

describe('validateImportFile', () => {
  it('accepteert pdf tot 10 MB en afbeeldingen tot 5 MB', () => {
    expect(validateImportFile('application/pdf', 10 * MB)).toBeNull()
    expect(validateImportFile('image/png', 5 * MB)).toBeNull()
  })
  it('weigert te grote bestanden en verkeerde types', () => {
    expect(validateImportFile('application/pdf', 10 * MB + 1)).toMatch(/10 MB/)
    expect(validateImportFile('image/jpeg', 5 * MB + 1)).toMatch(/5 MB/)
    expect(validateImportFile('image/gif', 100)).toMatch(/png, jpg, webp of pdf/)
    expect(validateImportFile('application/pdf', 0)).toMatch(/leeg/)
  })
})
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.

- [ ] **Step 3:** voeg toe aan `lib/order-import.ts`:

```ts
export function validateImportFile(type: string, size: number): string | null {
  if (!ALLOWED_IMPORT_TYPES.has(type)) return 'Alleen png, jpg, webp of pdf'
  if (size === 0) return 'Bestand is leeg'
  if (size > MAX_IMPORT_BYTES) return 'Bestand is te groot (max 10 MB)'
  if (type !== 'application/pdf' && size > MAX_IMAGE_BYTES) return 'Afbeelding is te groot (max 5 MB)'
  return null
}
```

- [ ] **Step 4: Run** `npm test` — Expected: PASS.

- [ ] **Step 5: `app/api/orders/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { isPositiveInt } from '@/lib/validate'
import { listOrders, createOrder, updateOrder, setOrderStatus, deleteOrder, validateOrderInput, isOrderStatus } from '@/lib/orders'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const supplierId = parseInt(req.nextUrl.searchParams.get('supplier_id') || '', 10)
  if (!isPositiveInt(supplierId)) {
    return NextResponse.json({ error: 'supplier_id is verplicht' }, { status: 400 })
  }
  const filter = req.nextUrl.searchParams.get('status') === 'open' ? 'open' : 'all'
  return NextResponse.json(listOrders(getDb(), supplierId, filter))
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const parsed = validateOrderInput(await req.json())
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const id = createOrder(getDb(), parsed.value)
    return NextResponse.json({ id }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Opslaan mislukt: onbekend product of leverancier' }, { status: 400 })
  }
}

export async function PUT(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const body = await req.json()
  if (!isPositiveInt(body?.id)) {
    return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
  }
  const db = getDb()

  // Status-only update from the history list
  if (body.lines === undefined) {
    if (!isOrderStatus(body.status)) return NextResponse.json({ error: 'Ongeldige status' }, { status: 400 })
    return setOrderStatus(db, body.id, body.status)
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: 'Bestelling niet gevonden' }, { status: 404 })
  }

  const parsed = validateOrderInput(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    return updateOrder(db, body.id, parsed.value)
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: 'Bestelling niet gevonden' }, { status: 404 })
  } catch {
    return NextResponse.json({ error: 'Opslaan mislukt: onbekend product of leverancier' }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const { id } = await req.json()
  if (!isPositiveInt(id)) {
    return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
  }
  return deleteOrder(getDb(), id)
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: 'Bestelling niet gevonden' }, { status: 404 })
}
```

- [ ] **Step 6: `app/api/orders/import/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { log } from '@/lib/logger'
import { isPositiveInt } from '@/lib/validate'
import { getAiConfig, getClaudeApiKey, checkTokenCap, addTokenUsage, checkRateLimit } from '@/lib/ai'
import { getAliases, getAliasMap } from '@/lib/aliases'
import { analyzeOrderDocument, resolveMatches, validateImportFile, type ImportProduct } from '@/lib/order-import'

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Te veel verzoeken. Probeer het over een minuut opnieuw.' }, { status: 429 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Upload kon niet gelezen worden' }, { status: 400 })
  }
  const supplierId = parseInt(String(form.get('supplier_id') || ''), 10)
  const file = form.get('file')
  if (!isPositiveInt(supplierId)) return NextResponse.json({ error: 'supplier_id is verplicht' }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'Geen bestand ontvangen' }, { status: 400 })

  const fileError = validateImportFile(file.type, file.size)
  if (fileError) return NextResponse.json({ error: fileError }, { status: 400 })

  const db = getDb()
  const apiKey = getClaudeApiKey(db)
  if (!apiKey) return NextResponse.json({ error: 'Claude API key niet geconfigureerd. Ga naar Instellingen.' }, { status: 400 })
  const capError = checkTokenCap(db)
  if (capError) return NextResponse.json({ error: capError }, { status: 429 })

  const products = db.prepare('SELECT id, sku, name FROM products WHERE supplier_id = ? AND active = 1 AND archived = 0 ORDER BY name')
    .all(supplierId) as ImportProduct[]
  if (products.length === 0) {
    return NextResponse.json({ error: 'Deze leverancier heeft geen actieve producten' }, { status: 400 })
  }

  const { model, maxTokens } = getAiConfig(db, 'order_import')
  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
    const { extraction, truncated, usage } = await analyzeOrderDocument({
      apiKey, model, maxTokens, mediaType: file.type, base64, products, aliases: getAliases(db, supplierId),
    })
    addTokenUsage(db, 'order_import', usage.input, usage.output)

    const result = resolveMatches(extraction, new Set(products.map(p => p.id)), getAliasMap(db, supplierId))
    const counts = result.lines.reduce<Record<string, number>>((acc, l) => { acc[l.match] = (acc[l.match] || 0) + 1; return acc }, {})
    log(truncated ? 'warn' : 'info', `Bestelling uit document (leverancier ${supplierId}): ${result.lines.length} regels ${JSON.stringify(counts)}${truncated ? ', afgekapt' : ''} (tokens: ${usage.input + usage.output}, ${model})`)

    return NextResponse.json({ ...result, truncated })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('error', `Bestelling uit document mislukt (leverancier ${supplierId}, ${model}): ${msg}`)
    return NextResponse.json({ error: 'Analyse mislukt. Controleer de API key en het model in Instellingen en probeer opnieuw.' }, { status: 500 })
  }
}
```

- [ ] **Step 7: `next.config.ts`** — de middleware draait op alle routes en kapt bodies standaard af op 10 MB. Voeg toe aan `nextConfig`:
```ts
  experimental: {
    middlewareClientMaxBodySize: '12mb',
  },
```

- [ ] **Step 8: Run** `npm test && npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 9: Commit + push**
```bash
git add app/api/orders lib/order-import.ts next.config.ts tests/import-validation.test.ts
git commit -m "Add orders API and document import endpoint"
git push
```

---

### Task 6: Instellingen-UI

**Files:**
- Modify: `app/settings/page.tsx` (state r. 30-36, laden r. 67-71, `saveEventSettings` r. 187-200, tokenblok r. 273-292, "Evenement instellingen"-blok r. 416-459)

**Interfaces:**
- Consumes: `AI_FUNCTIONS`, `AI_FUNCTION_KEYS`, `FALLBACK_MODELS`, `MAX_TOKENS_LIMIT`, `modelSettingKey`, `maxTokensSettingKey`, `usageSettingKey`, `type AiFunction` (Task 3); `GET /api/ai/models`.

- [ ] **Step 1: State** — vervang `const [aiMaxTokens, setAiMaxTokens] = useState('100')` door:
```tsx
  const [aiConfig, setAiConfig] = useState<Record<AiFunction, { model: string; maxTokens: string }>>(() =>
    Object.fromEntries(AI_FUNCTION_KEYS.map(fn => [fn, { model: AI_FUNCTIONS[fn].defaultModel, maxTokens: String(AI_FUNCTIONS[fn].defaultMaxTokens) }])) as Record<AiFunction, { model: string; maxTokens: string }>
  )
  const [aiUsage, setAiUsage] = useState<Record<AiFunction, { input: number; output: number }>>(() =>
    Object.fromEntries(AI_FUNCTION_KEYS.map(fn => [fn, { input: 0, output: 0 }])) as Record<AiFunction, { input: number; output: number }>
  )
  const [aiModels, setAiModels] = useState<{ id: string; name: string }[]>(FALLBACK_MODELS)
```
Import bovenaan: `import { AI_FUNCTIONS, AI_FUNCTION_KEYS, FALLBACK_MODELS, MAX_TOKENS_LIMIT, modelSettingKey, maxTokensSettingKey, usageSettingKey, type AiFunction } from '@/lib/ai-config'`.

- [ ] **Step 2: Laden** — vervang `setAiMaxTokens(settings.ai_max_tokens_per_lookup || '100')` door:
```tsx
      setAiConfig(Object.fromEntries(AI_FUNCTION_KEYS.map(fn => [fn, {
        model: settings[modelSettingKey(fn)] || AI_FUNCTIONS[fn].defaultModel,
        maxTokens: settings[maxTokensSettingKey(fn)] || String(AI_FUNCTIONS[fn].defaultMaxTokens),
      }])) as Record<AiFunction, { model: string; maxTokens: string }>)
      setAiUsage(Object.fromEntries(AI_FUNCTION_KEYS.map(fn => [fn, {
        input: parseInt(settings[usageSettingKey(fn, 'input')] || '0', 10),
        output: parseInt(settings[usageSettingKey(fn, 'output')] || '0', 10),
      }])) as Record<AiFunction, { input: number; output: number }>)
      if (settings.has_claude_api_key === '1') {
        apiFetch('/api/ai/models').then(r => r.json()).then(d => { if (Array.isArray(d.models)) setAiModels(d.models) }).catch(() => {})
      }
```

- [ ] **Step 3: Opslaan** — in `saveEventSettings` wordt de body:
```tsx
        body: JSON.stringify({ settings: {
          ai_token_cap: aiTokenCap,
          ...Object.fromEntries(AI_FUNCTION_KEYS.flatMap(fn => [
            [modelSettingKey(fn), aiConfig[fn].model],
            [maxTokensSettingKey(fn), String(Math.min(MAX_TOKENS_LIMIT, Math.max(1, parseInt(aiConfig[fn].maxTokens, 10) || AI_FUNCTIONS[fn].defaultMaxTokens)))],
          ])),
        } }),
```

- [ ] **Step 4: Tokenblok** — direct na de bestaande `<div className="flex items-center gap-8">…</div>` binnen "AI token gebruik":
```tsx
                <div className="mt-4 pt-3 border-t border-border-subtle space-y-1">
                  {AI_FUNCTION_KEYS.map(fn => (
                    <div key={fn} className="flex items-center justify-between text-[12px]">
                      <span className="text-text-secondary">{AI_FUNCTIONS[fn].label}</span>
                      <span className="text-text-primary tabular-nums">
                        {(aiUsage[fn].input + aiUsage[fn].output).toLocaleString('nl-NL')}
                        <span className="text-text-tertiary"> ({aiUsage[fn].input.toLocaleString('nl-NL')} in / {aiUsage[fn].output.toLocaleString('nl-NL')} uit)</span>
                      </span>
                    </div>
                  ))}
                </div>
```

- [ ] **Step 5: "Evenement instellingen"-blok** — titel wordt `AI instellingen`; vervang het "Max tokens per AI lookup"-`<div>` (eerste kind van de grid) door de functietabel boven de grid, en laat het token-limiet-veld staan (grid wordt `grid-cols-1 sm:grid-cols-2`):
```tsx
              <div className="mb-4">
                <div className="grid grid-cols-[1fr_minmax(0,220px)_110px] gap-3 mb-1">
                  <span className={labelClass}>Functie</span>
                  <span className={labelClass}>Model</span>
                  <span className={labelClass}>Max tokens</span>
                </div>
                {AI_FUNCTION_KEYS.map(fn => {
                  const current = aiConfig[fn]
                  const options = aiModels.some(m => m.id === current.model) ? aiModels : [{ id: current.model, name: current.model }, ...aiModels]
                  return (
                    <div key={fn} className="grid grid-cols-[1fr_minmax(0,220px)_110px] gap-3 items-center mb-2">
                      <span className="text-[13px] text-text-primary">{AI_FUNCTIONS[fn].label}</span>
                      <select
                        className={inputClass}
                        value={current.model}
                        onChange={e => setAiConfig(prev => ({ ...prev, [fn]: { ...prev[fn], model: e.target.value } }))}
                      >
                        {options.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      <input
                        type="number"
                        className={inputClass}
                        value={current.maxTokens}
                        min="1"
                        max={MAX_TOKENS_LIMIT}
                        onChange={e => setAiConfig(prev => ({ ...prev, [fn]: { ...prev[fn], maxTokens: e.target.value } }))}
                      />
                    </div>
                  )
                })}
                <p className="text-text-tertiary text-[12px] mt-1">
                  Max output tokens per aanroep. Te laag = afgekapt antwoord.
                </p>
              </div>
```

- [ ] **Step 6: Run** `npx tsc --noEmit && npm run build` — Expected: build slaagt.

- [ ] **Step 7: Commit + push**
```bash
git add app/settings/page.tsx
git commit -m "Settings: model and max tokens per AI function, usage per function"
git push
```

---

### Task 7: OrderForm-component

**Files:**
- Create: `lib/image-resize.ts`, `components/OrderForm.tsx`

**Interfaces:**
- Consumes: `ImportResult`, `MatchKind`, `Order` (Task 2), `POST /api/orders/import`, `POST|PUT /api/orders`.
- Produces: `export default function OrderForm(props: { supplierId: number; products: { productId: number; sku: string; name: string }[]; order?: Order; onSaved: () => void; onCancel: () => void })` — zonder `order` = nieuw met upload; met `order` = bewerken zonder upload. `export async function prepareImageForUpload(file: File): Promise<File>` in `lib/image-resize.ts`.

- [ ] **Step 1: `lib/image-resize.ts`**

```ts
// Screenshots are often larger than Claude's 5 MB image limit — downscale in the browser first
const MAX_EDGE = 2400
const MAX_BYTES = 4 * 1024 * 1024

export async function prepareImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size <= MAX_BYTES) {
    bitmap.close()
    return file
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob) return file
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
}
```

- [ ] **Step 2: `components/OrderForm.tsx`**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { prepareImageForUpload } from '@/lib/image-resize'
import type { ImportResult, MatchKind, Order } from '@/lib/order-types'

interface ProductOption { productId: number; sku: string; name: string }

interface LineState {
  key: string
  product_id: number | ''
  quantity: string
  supplier_code: string | null
  supplier_description: string | null
  match: MatchKind | null // null = added by hand
  suggested_product_id: number | null
}

interface Props {
  supplierId: number
  products: ProductOption[]
  order?: Order
  onSaved: () => void
  onCancel: () => void
}

const MATCH_STYLES: Record<MatchKind, { dot: string; label: string }> = {
  memory: { dot: 'bg-success', label: 'Uit geheugen' },
  confident: { dot: 'bg-success/60', label: 'Gekoppeld' },
  uncertain: { dot: 'bg-warning', label: 'Controleren' },
  none: { dot: 'bg-danger', label: 'Kies product' },
}

const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf'
let keySeq = 0
const newKey = () => `l${++keySeq}`

function emptyLine(): LineState {
  return { key: newKey(), product_id: '', quantity: '', supplier_code: null, supplier_description: null, match: null, suggested_product_id: null }
}

const inputClass = 'w-full text-[13px] px-3 py-2 rounded-lg bg-surface-0 border border-border-subtle text-text-primary'
const labelClass = 'text-[11px] text-text-tertiary font-semibold uppercase tracking-wider block mb-1'

export default function OrderForm({ supplierId, products, order, onSaved, onCancel }: Props) {
  const today = new Date().toISOString().split('T')[0]
  const [orderDate, setOrderDate] = useState(order?.order_date || today)
  const [supplierRef, setSupplierRef] = useState(order?.supplier_ref || '')
  const [arrival, setArrival] = useState(order?.expected_arrival || '')
  const [notes, setNotes] = useState(order?.notes || '')
  const [lines, setLines] = useState<LineState[]>(() => order
    ? order.lines.map(l => ({ key: newKey(), product_id: l.product_id, quantity: String(l.quantity), supplier_code: l.supplier_code, supplier_description: l.supplier_description, match: null, suggested_product_id: l.product_id }))
    : [emptyLine()])
  const [analyzing, setAnalyzing] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'warn' | 'info'; text: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const sortedProducts = [...products].sort((a, b) => a.name.localeCompare(b.name, 'nl'))

  async function analyze(raw: File) {
    setMessage(null)
    setAnalyzing(true)
    try {
      const file = await prepareImageForUpload(raw)
      const body = new FormData()
      body.append('supplier_id', String(supplierId))
      body.append('file', file)
      const res = await apiFetch('/api/orders/import', { method: 'POST', body })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ kind: 'error', text: data.error || 'Analyse mislukt' })
        return
      }
      const result = data as ImportResult
      if (result.order_date) setOrderDate(result.order_date)
      if (result.supplier_ref) setSupplierRef(result.supplier_ref)
      if (result.lines.length === 0) {
        setLines([emptyLine()])
        setMessage({ kind: 'warn', text: 'Geen regels gevonden in het document. Vul de bestelling handmatig in.' })
        return
      }
      setLines(result.lines.map(l => ({
        key: newKey(),
        product_id: l.product_id ?? '',
        quantity: l.quantity > 0 ? String(l.quantity) : '',
        supplier_code: l.supplier_code,
        supplier_description: l.supplier_description,
        match: l.match,
        suggested_product_id: l.product_id,
      })))
      const open = result.lines.filter(l => l.match === 'none' || l.match === 'uncertain').length
      if (result.truncated) {
        setMessage({ kind: 'warn', text: 'Het antwoord is afgekapt, mogelijk ontbreken regels. Verhoog "max tokens" voor "Bestelling uit document" in Instellingen.' })
      } else if (open > 0) {
        setMessage({ kind: 'info', text: `${result.lines.length} regels gevonden, ${open} om te controleren.` })
      } else {
        setMessage({ kind: 'info', text: `${result.lines.length} regels gevonden.` })
      }
    } catch {
      setMessage({ kind: 'error', text: 'Analyse mislukt. Probeer het opnieuw.' })
    } finally {
      setAnalyzing(false)
    }
  }

  // Paste a screenshot straight from the clipboard (new orders only)
  useEffect(() => {
    if (order) return
    function onPaste(e: ClipboardEvent) {
      const file = Array.from(e.clipboardData?.files || []).find(f => ACCEPT.split(',').includes(f.type))
      if (!file) return
      e.preventDefault()
      analyze(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, supplierId])

  function updateLine(key: string, patch: Partial<LineState>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }

  const canSave = lines.length > 0 && lines.every(l => l.product_id !== '' && parseInt(l.quantity, 10) >= 1) && !saving && !analyzing

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    setMessage(null)
    try {
      const payload = {
        ...(order ? { id: order.id } : {}),
        supplier_id: supplierId,
        order_date: orderDate,
        supplier_ref: supplierRef,
        expected_arrival: arrival,
        notes,
        lines: lines.map(l => ({
          product_id: l.product_id,
          quantity: parseInt(l.quantity, 10),
          supplier_code: l.supplier_code,
          supplier_description: l.supplier_description,
          // Remember when the user picked or changed the product for a supplier line
          remember: !!(l.supplier_code || l.supplier_description) && l.product_id !== l.suggested_product_id,
        })),
      }
      const res = await apiFetch('/api/orders', {
        method: order ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setMessage({ kind: 'error', text: data.error || 'Opslaan mislukt' })
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const messageColor = message?.kind === 'error' ? 'text-danger' : message?.kind === 'warn' ? 'text-warning' : 'text-text-secondary'

  return (
    <div className="bg-surface-1 rounded-2xl border border-border-subtle p-4 mb-4 animate-row">
      <h3 className="text-[14px] font-semibold text-text-primary mb-3">{order ? `Bestelling #${order.id} bewerken` : 'Nieuwe bestelling'}</h3>

      {!order && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) analyze(f) }}
          onClick={() => !analyzing && fileInput.current?.click()}
          className={`mb-4 rounded-xl border border-dashed px-4 py-5 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-accent bg-accent/5' : 'border-border-subtle hover:bg-surface-2'
          }`}
        >
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) analyze(f); e.target.value = '' }}
          />
          {analyzing ? (
            <p className="text-[13px] text-text-secondary">Document analyseren…</p>
          ) : (
            <>
              <p className="text-[13px] text-text-primary font-medium">Sleep een screenshot of pdf hierheen, plak (⌘V) of klik om te kiezen</p>
              <p className="text-[12px] text-text-tertiary mt-0.5">Claude zet de bestelling voor je klaar. Png, jpg, webp of pdf, max 10 MB.</p>
            </>
          )}
        </div>
      )}

      {message && <p className={`text-[12px] mb-3 ${messageColor}`}>{message.text}</p>}

      <form onSubmit={handleSave}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div>
            <label className={labelClass}>Besteldatum</label>
            <input type="date" required value={orderDate} onChange={e => setOrderDate(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Ordernummer fabrikant</label>
            <input type="text" value={supplierRef} onChange={e => setSupplierRef(e.target.value)} className={inputClass} placeholder="Optioneel" />
          </div>
          <div>
            <label className={labelClass}>Verwachte aankomst</label>
            <input type="date" value={arrival} onChange={e => setArrival(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Notities</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} className={inputClass} placeholder="Optioneel" />
          </div>
        </div>

        <div className="space-y-2 mb-3">
          {lines.map(l => {
            const style = l.match ? MATCH_STYLES[l.match] : null
            const changed = l.match && l.product_id !== '' && l.product_id !== l.suggested_product_id
            return (
              <div key={l.key} className="flex flex-wrap items-center gap-2 bg-surface-0 rounded-xl border border-border-subtle px-3 py-2">
                {style && (
                  <span className="flex items-center gap-1.5 w-28 shrink-0" title={style.label}>
                    <span className={`w-2 h-2 rounded-full ${changed ? 'bg-accent' : style.dot}`} />
                    <span className="text-[11px] text-text-tertiary">{changed ? 'Aangepast' : style.label}</span>
                  </span>
                )}
                {(l.supplier_code || l.supplier_description) && (
                  <span className="text-[12px] text-text-secondary min-w-0 flex-1 basis-48 truncate" title={`${l.supplier_code ?? ''} ${l.supplier_description ?? ''}`}>
                    {l.supplier_code && <span className="font-mono text-text-tertiary mr-1.5">{l.supplier_code}</span>}
                    {l.supplier_description}
                  </span>
                )}
                <select
                  value={l.product_id}
                  onChange={e => updateLine(l.key, { product_id: e.target.value ? parseInt(e.target.value, 10) : '' })}
                  className={`${inputClass} flex-1 basis-56 ${l.product_id === '' ? 'border-danger/50' : ''}`}
                >
                  <option value="">Selecteer product...</option>
                  {sortedProducts.map(p => (
                    <option key={p.productId} value={p.productId}>{p.sku} — {p.name}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  value={l.quantity}
                  onChange={e => updateLine(l.key, { quantity: e.target.value })}
                  className={`${inputClass} w-24`}
                  placeholder="Aantal"
                />
                <button
                  type="button"
                  onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))}
                  className="text-[12px] font-medium px-2 py-1.5 rounded-lg text-danger hover:bg-danger/10 transition-all duration-150"
                  title="Regel verwijderen"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setLines(prev => [...prev, emptyLine()])}
            className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-surface-2 border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-all duration-150"
          >
            + Regel toevoegen
          </button>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!canSave}
              className="text-[12px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-all duration-150"
            >
              {saving ? 'Opslaan...' : 'Opslaan'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="text-[12px] font-medium px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle text-text-secondary hover:text-text-primary transition-all duration-150"
            >
              Annuleren
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Run** `npx tsc --noEmit` — Expected: geen fouten.

- [ ] **Step 4: Commit + push**
```bash
git add lib/image-resize.ts components/OrderForm.tsx
git commit -m "Add OrderForm with document upload, paste and editable line table"
git push
```

---

### Task 8: Orderhistorie + leverancierspagina

**Files:**
- Create: `components/OrderHistory.tsx`
- Modify: `app/suppliers/[id]/page.tsx` (interface r. 65-75, state r. 138 + 161-165, `loadData` r. 311/334, `getOrdersForProduct` r. 487-489, `handleSubmitOrder` r. 491-514, knop r. 838-843, formulier r. 848-913, per-product regels r. 1197-1209, bestellingenlijst r. 1608-1650)
- Delete: `app/api/purchase-orders/route.ts`

**Interfaces:**
- Consumes: `Order`, `ORDER_STATUSES`, `ORDER_STATUS_LABELS`, `OrderStatus` (Task 2); `OrderForm` (Task 7); `/api/orders`.
- Produces: `export default function OrderHistory(props: { orders: Order[]; onEdit: (order: Order) => void; onChanged: () => void })`.

- [ ] **Step 1: `components/OrderHistory.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import { ORDER_STATUSES, ORDER_STATUS_LABELS, type Order, type OrderStatus } from '@/lib/order-types'

interface Props {
  orders: Order[]
  onEdit: (order: Order) => void
  onChanged: () => void
}

const STATUS_COLORS: Record<OrderStatus, string> = {
  ordered: 'text-accent',
  shipped: 'text-warning',
  received: 'text-success',
}

const formatDate = (d: string) => new Date(d).toLocaleDateString('nl-NL')
const btn = 'text-[12px] font-medium px-3 py-1.5 rounded-lg bg-surface-2 border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-all duration-150'

export default function OrderHistory({ orders, onEdit, onChanged }: Props) {
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const visible = filter === 'open' ? orders.filter(o => o.status !== 'received') : orders

  function toggle(id: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function changeStatus(order: Order, status: OrderStatus) {
    await apiFetch('/api/orders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: order.id, status }),
    })
    onChanged()
  }

  async function remove(order: Order) {
    if (!confirm(`Bestelling #${order.id} verwijderen?`)) return
    await apiFetch('/api/orders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: order.id }),
    })
    onChanged()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[14px] font-semibold text-text-primary">Bestellingen ({visible.length})</h2>
        <div className="flex gap-1">
          {(['open', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[12px] font-medium px-3 py-1 rounded-lg transition-colors ${
                filter === f ? 'bg-surface-3 text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {f === 'open' ? 'Openstaand' : 'Alles'}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="bg-surface-1 rounded-2xl border border-border-subtle p-12 text-center">
          <p className="text-text-tertiary text-[13px]">
            {orders.length === 0 ? 'Nog geen bestellingen geregistreerd.' : 'Geen openstaande bestellingen.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((o, i) => {
            const totalQty = o.lines.reduce((s, l) => s + l.quantity, 0)
            const isOpen = expanded.has(o.id)
            return (
              <div
                key={o.id}
                className="bg-surface-1 rounded-2xl border border-border-subtle p-4 animate-row"
                style={{ animationDelay: `${Math.min(i * 20, 400)}ms` }}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button onClick={() => toggle(o.id)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-text-tertiary text-[11px]">{isOpen ? '▾' : '▸'}</span>
                      <span className="text-text-primary text-[13px] font-semibold">
                        #{o.id}{o.supplier_ref && ` — ${o.supplier_ref}`}
                      </span>
                      <span className={`text-[11px] font-semibold ${STATUS_COLORS[o.status]}`}>{ORDER_STATUS_LABELS[o.status]}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-secondary ml-4">
                      <span>Besteld: {formatDate(o.order_date)}</span>
                      <span>{o.lines.length} {o.lines.length === 1 ? 'regel' : 'regels'}, {totalQty.toLocaleString('nl-NL')} stuks</span>
                      {o.expected_arrival && <span>Verwacht: {formatDate(o.expected_arrival)}</span>}
                      {o.notes && <span className="text-text-tertiary">{o.notes}</span>}
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <select
                      value={o.status}
                      onChange={e => changeStatus(o, e.target.value as OrderStatus)}
                      className="text-[12px] px-2 py-1.5 rounded-lg bg-surface-0 border border-border-subtle text-text-primary"
                    >
                      {ORDER_STATUSES.map(s => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
                    </select>
                    <button onClick={() => onEdit(o)} className={btn}>Bewerken</button>
                    <button
                      onClick={() => remove(o)}
                      className="text-[12px] font-medium px-3 py-1.5 rounded-lg text-danger hover:bg-danger/10 transition-all duration-150"
                    >
                      Verwijder
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div className="mt-3 ml-4 space-y-1">
                    {o.lines.map(l => (
                      <div key={l.id} className="flex flex-wrap items-center gap-x-3 text-[12px]">
                        <span className="text-text-primary">{l.sku} — {l.name}</span>
                        <span className="text-text-secondary tabular-nums">{l.quantity.toLocaleString('nl-NL')} stuks</span>
                        {(l.supplier_code || l.supplier_description) && (
                          <span className="text-text-tertiary">({[l.supplier_code, l.supplier_description].filter(Boolean).join(' · ')})</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Leverancierspagina omzetten** (`app/suppliers/[id]/page.tsx`)

1. Imports toevoegen:
```tsx
import OrderForm from '@/components/OrderForm'
import OrderHistory from '@/components/OrderHistory'
import { ORDER_STATUS_LABELS, type Order } from '@/lib/order-types'
```
2. `interface PurchaseOrder {…}` verwijderen; `useState<PurchaseOrder[]>([])` → `useState<Order[]>([])`.
3. State `orderProductId`, `orderQty`, `orderArrival`, `submitting` verwijderen; toevoegen:
```tsx
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
```
4. In `loadData`: `` apiFetch(`/api/purchase-orders?supplier_id=${id}`) `` → `` apiFetch(`/api/orders?supplier_id=${id}&status=all`) ``.
5. `getOrdersForProduct` wordt:
```tsx
  function getOrdersForProduct(productId: number) {
    return orders
      .filter(o => o.status !== 'received')
      .flatMap(o => o.lines
        .filter(l => l.product_id === productId)
        .map(l => ({ id: o.id, quantity: l.quantity, expected_arrival: o.expected_arrival, status: o.status })))
  }
```
6. `handleSubmitOrder` volledig verwijderen.
7. Knop "Bestelling registreren": `onClick={() => { setEditingOrder(null); setShowOrderForm(!showOrderForm) }}`.
8. Het hele `{/* Order form */}{showOrderForm && (…)}`-blok vervangen door:
```tsx
            {/* Order form */}
            {(showOrderForm || editingOrder) && (
              <OrderForm
                key={editingOrder?.id ?? 'new'}
                supplierId={parseInt(id, 10)}
                products={products}
                order={editingOrder ?? undefined}
                onSaved={() => { setShowOrderForm(false); setEditingOrder(null); loadData() }}
                onCancel={() => { setShowOrderForm(false); setEditingOrder(null) }}
              />
            )}
```
9. In de per-product regels (r. ~1203) de status-span vervangen door:
```tsx
                                    <span className={`ml-1 ${o.status === 'shipped' ? 'text-warning' : 'text-accent'}`}>
                                      ({ORDER_STATUS_LABELS[o.status]})
                                    </span>
```
10. Het hele `{/* Orders overview */}<div>…</div>`-blok vervangen door:
```tsx
            {/* Orders overview */}
            <OrderHistory
              orders={orders}
              onEdit={o => { setShowOrderForm(false); setEditingOrder(o); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
              onChanged={loadData}
            />
```

- [ ] **Step 3: Oude route verwijderen** — `git rm app/api/purchase-orders/route.ts`; daarna `grep -rn "purchase-orders" app components lib` → Expected: geen resultaten.

- [ ] **Step 4: Run** `npm test && npx tsc --noEmit && npm run build` — Expected: alles slaagt.

- [ ] **Step 5: Commit + push**
```bash
git add components/OrderHistory.tsx app/suppliers/\[id\]/page.tsx
git commit -m "Supplier page: multi-line order form and order history with status"
git push
```

---

### Task 9: Handmatige verificatie, versie en merge

- [ ] **Step 1: Lokale testdata** — `data/` is leeg. Start `npm run dev` (poort 3100) zodat het schema wordt aangemaakt, stop hem weer, en seed via een script in de scratchpad (niet in de repo): één leverancier (id 1) met 4 producten in verschillende kleuren (bijv. "Speed Rope PRO 3m Zwart", "… Rood", "Handvat Aluminium Zilver", "Kabel 2,5mm"), en een sessie/wachtwoord volgens `lib/auth.ts` om in te loggen.

- [ ] **Step 2: Flow zonder AI** — op `/suppliers/1`: "Bestelling registreren" → handmatig twee regels → opslaan → order verschijnt onder "Openstaand" met 2 regels; status naar "Ontvangen" → verdwijnt uit "Openstaand" en de product-badge "Verwacht in Xd"/"Besteld" verdwijnt; bewerken (regel toevoegen) en verwijderen werken. Een upload zonder API-key geeft "Claude API key niet geconfigureerd".

- [ ] **Step 3: Grenzen** — upload een pdf van 11 MB → "Bestand is te groot (max 10 MB)" (en geen afgekapte-body-waarschuwing in de serverlog); een png-screenshot van > 5 MB wordt in de browser verkleind en gaat door.

- [ ] **Step 4: Flow met AI** — als er lokaal een Claude-key beschikbaar is (Instellingen → Claude AI): upload een voorbeeld-orderbevestiging (pdf) en een screenshot met eigen fabrikantcodes. Controleer de markeringen, kies het product bij een rode regel, sla op, upload hetzelfde document opnieuw → die regel is nu groen "Uit geheugen". Zonder lokale key: deze stap na de deploy samen met Ruben op productie doen.

- [ ] **Step 5: Instellingen** — model en max tokens per functie wijzigen en opslaan, herladen → waarden blijven staan; verbruik per functie zichtbaar na een AI-aanroep; de datumzoeker op `/events` werkt nog en de log toont het gekozen model.

- [ ] **Step 6: Versie + merge + deploy**
```bash
npm version minor --no-git-tag-version   # 0.3.0 → 0.4.0
git add package.json package-lock.json
git commit -m "Order import from documents, order history and per-function AI settings (0.4.0)"
git push
git checkout main && git merge --ff-only feature/order-import && git push
```
Volg daarna de deploy via `https://api.github.com/repos/RVDBot/stock/actions/runs?per_page=2` tot "Deploy to Hostinger" `success` is.
