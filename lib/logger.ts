import { getDb } from '@/lib/db'

export function log(level: 'info' | 'error' | 'warn', message: string, meta?: string) {
  const db = getDb()
  db.prepare('INSERT INTO logs (level, message, meta) VALUES (?, ?, ?)').run(level, message, meta || null)
}
