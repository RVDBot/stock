import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(process.cwd(), 'data', 'stock-dashboard.db')

const dir = path.dirname(DB_PATH)
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true })
}

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db
  const isNew = !fs.existsSync(DB_PATH)
  _db = new Database(DB_PATH)
  if (isNew) {
    try { fs.chmodSync(DB_PATH, 0o600) } catch {}
  }
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  initSchema(_db)
  return _db
}

export function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT NOT NULL,
      lead_time_days    INTEGER NOT NULL,
      inspection        TEXT NOT NULL DEFAULT 'never',
      contact_name      TEXT,
      contact_email     TEXT,
      phone             TEXT,
      preferred_contact TEXT NOT NULL DEFAULT 'email',
      contact_info      TEXT,
      notes             TEXT,
      created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      woo_product_id  INTEGER NOT NULL,
      sku             TEXT NOT NULL UNIQUE,
      name            TEXT NOT NULL,
      current_stock   INTEGER NOT NULL DEFAULT 0,
      price           REAL NOT NULL DEFAULT 0,
      is_composite    INTEGER NOT NULL DEFAULT 0,
      composite_sku   TEXT,
      supplier_id     INTEGER REFERENCES suppliers(id),
      manual_daily_sales REAL,
      active          INTEGER NOT NULL DEFAULT 1,
      updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_snapshots (
      product_id  INTEGER NOT NULL REFERENCES products(id),
      date        TEXT NOT NULL,
      stock_level INTEGER NOT NULL,
      PRIMARY KEY (product_id, date)
    );

    CREATE TABLE IF NOT EXISTS sales_history (
      product_id INTEGER NOT NULL REFERENCES products(id),
      date       TEXT NOT NULL,
      quantity   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (product_id, date)
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id      INTEGER NOT NULL REFERENCES suppliers(id),
      product_id       INTEGER REFERENCES products(id),
      quantity         INTEGER NOT NULL,
      order_date       TEXT NOT NULL,
      expected_arrival TEXT,
      status           TEXT NOT NULL DEFAULT 'ordered',
      notes            TEXT,
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS events (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id         INTEGER REFERENCES events(id) ON DELETE CASCADE,
      name              TEXT NOT NULL,
      expected_date     TEXT,
      duration_days     INTEGER NOT NULL DEFAULT 7,
      impact_percentage INTEGER NOT NULL DEFAULT 100,
      recurring         INTEGER NOT NULL DEFAULT 1,
      ai_lookup         INTEGER NOT NULL DEFAULT 1,
      ai_skip_months    INTEGER NOT NULL DEFAULT 6,
      last_checked_at   DATETIME,
      notes             TEXT,
      created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      level      TEXT NOT NULL DEFAULT 'info',
      message    TEXT NOT NULL,
      meta       TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // Migrations for existing databases
  const cols = db.prepare("PRAGMA table_info(suppliers)").all() as { name: string }[]
  const colNames = new Set(cols.map(c => c.name))
  if (!colNames.has('inspection')) {
    db.exec(`
      ALTER TABLE suppliers ADD COLUMN inspection TEXT NOT NULL DEFAULT 'never';
      ALTER TABLE suppliers ADD COLUMN contact_name TEXT;
      ALTER TABLE suppliers ADD COLUMN contact_email TEXT;
      ALTER TABLE suppliers ADD COLUMN phone TEXT;
      ALTER TABLE suppliers ADD COLUMN preferred_contact TEXT NOT NULL DEFAULT 'email';
    `)
    // Migrate old contact_info to contact_email if it looks like an email
    const suppliers = db.prepare('SELECT id, contact_info FROM suppliers WHERE contact_info IS NOT NULL').all() as { id: number; contact_info: string }[]
    for (const s of suppliers) {
      if (s.contact_info.includes('@')) {
        db.prepare('UPDATE suppliers SET contact_email = ? WHERE id = ?').run(s.contact_info, s.id)
      }
    }
  }

  // Spec templates table
  db.exec(`
    CREATE TABLE IF NOT EXISTS spec_templates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      fields      TEXT NOT NULL DEFAULT '[]',
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // Add specs columns to products
  const productCols = db.prepare("PRAGMA table_info(products)").all() as { name: string }[]
  const productColNames = new Set(productCols.map(c => c.name))
  if (!productColNames.has('spec_template_id')) {
    db.exec(`
      ALTER TABLE products ADD COLUMN spec_template_id INTEGER REFERENCES spec_templates(id);
      ALTER TABLE products ADD COLUMN specs TEXT NOT NULL DEFAULT '{}';
    `)
  }
  // archived = no longer published in WooCommerce (set by sync); separate from active = manually ignored
  if (!productColNames.has('archived')) {
    db.exec(`ALTER TABLE products ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;`)
  }
  // Product sheet data: barcode etc. for fulfilment mails, costs for ads, HS code for export
  if (!productColNames.has('barcode')) {
    db.exec(`
      ALTER TABLE products ADD COLUMN barcode TEXT;
      ALTER TABLE products ADD COLUMN variant TEXT;
      ALTER TABLE products ADD COLUMN cogm REAL;
      ALTER TABLE products ADD COLUMN cogs REAL;
      ALTER TABLE products ADD COLUMN country_of_origin TEXT;
      ALTER TABLE products ADD COLUMN hs_code TEXT;
    `)
  }

  // Supplier order_cycle_days migration
  if (!colNames.has('order_cycle_days')) {
    db.exec(`ALTER TABLE suppliers ADD COLUMN order_cycle_days INTEGER NOT NULL DEFAULT 30;`)
  }

  // Events AI columns migration
  const eventCols = db.prepare("PRAGMA table_info(events)").all() as { name: string }[]
  const eventColNames = new Set(eventCols.map(c => c.name))
  if (!eventColNames.has('ai_lookup')) {
    db.exec(`
      ALTER TABLE events ADD COLUMN ai_lookup INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE events ADD COLUMN ai_skip_months INTEGER NOT NULL DEFAULT 6;
    `)
  }
  if (!eventColNames.has('parent_id')) {
    db.exec(`ALTER TABLE events ADD COLUMN parent_id INTEGER REFERENCES events(id) ON DELETE CASCADE;`)
  }

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

  // Order lines may be unassigned (product not in WooCommerce yet). SQLite can't drop NOT NULL
  // in place, so rebuild the table once for databases created before that.
  const productCol = (db.prepare("PRAGMA table_info(purchase_orders)").all() as { name: string; notnull: number }[])
    .find(c => c.name === 'product_id')
  if (productCol?.notnull) {
    const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1
    db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE purchase_orders_new (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            supplier_id          INTEGER NOT NULL REFERENCES suppliers(id),
            product_id           INTEGER REFERENCES products(id),
            quantity             INTEGER NOT NULL,
            order_date           TEXT NOT NULL,
            expected_arrival     TEXT,
            status               TEXT NOT NULL DEFAULT 'ordered',
            notes                TEXT,
            created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            order_id             INTEGER REFERENCES orders(id) ON DELETE CASCADE,
            supplier_code        TEXT,
            supplier_description TEXT
          );
          INSERT INTO purchase_orders_new (id, supplier_id, product_id, quantity, order_date, expected_arrival, status, notes, created_at, order_id, supplier_code, supplier_description)
            SELECT id, supplier_id, product_id, quantity, order_date, expected_arrival, status, notes, created_at, order_id, supplier_code, supplier_description FROM purchase_orders;
          DROP TABLE purchase_orders;
          ALTER TABLE purchase_orders_new RENAME TO purchase_orders;
        `)
      })()
    } finally {
      if (fkWasOn) db.pragma('foreign_keys = ON')
    }
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
}
