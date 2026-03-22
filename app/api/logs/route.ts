import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const level = req.nextUrl.searchParams.get('level')
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100', 10)

  const db = getDb()

  let query = 'SELECT * FROM logs'
  const params: (string | number)[] = []

  if (level) {
    query += ' WHERE level = ?'
    params.push(level)
  }

  query += ' ORDER BY created_at DESC LIMIT ?'
  params.push(Math.min(limit, 500))

  const logs = db.prepare(query).all(...params)
  return NextResponse.json(logs)
}

export async function DELETE(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const db = getDb()
  db.prepare('DELETE FROM logs').run()
  return NextResponse.json({ success: true })
}
