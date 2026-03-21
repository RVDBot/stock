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
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  initSchema(_db)
  return _db
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      lead_time_days INTEGER NOT NULL,
      contact_info   TEXT,
      notes          TEXT,
      created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
      product_id       INTEGER NOT NULL REFERENCES products(id),
      quantity         INTEGER NOT NULL,
      order_date       TEXT NOT NULL,
      expected_arrival TEXT,
      status           TEXT NOT NULL DEFAULT 'ordered',
      notes            TEXT,
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS events (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT NOT NULL,
      expected_date     TEXT,
      duration_days     INTEGER NOT NULL DEFAULT 7,
      impact_percentage INTEGER NOT NULL DEFAULT 100,
      recurring         INTEGER NOT NULL DEFAULT 1,
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
}
