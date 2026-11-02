import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { clampInt } from '@/lib/validate'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const level = req.nextUrl.searchParams.get('level')
  const limit = clampInt(parseInt(req.nextUrl.searchParams.get('limit') || '', 10), 1, 500, 100)

  const db = getDb()

  let query = 'SELECT * FROM logs'
  const params: (string | number)[] = []

  if (level) {
    query += ' WHERE level = ?'
    params.push(level)
  }

  query += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit)

  const logs = db.prepare(query).all(...params)
  return NextResponse.json(logs)
}

export async function DELETE(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const db = getDb()
  db.prepare('DELETE FROM logs').run()
  return NextResponse.json({ success: true })
}
