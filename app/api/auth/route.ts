import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { hashPassword, verifyPassword, isPasswordSet, createSession, validateSession } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get('session')?.value || ''
  return NextResponse.json({
    needsSetup: !isPasswordSet(),
    authenticated: validateSession(sessionToken),
  })
}

export async function POST(req: NextRequest) {
  const { action, password } = await req.json()

  if (action === 'setup') {
    if (isPasswordSet()) {
      return NextResponse.json({ error: 'Wachtwoord is al ingesteld' }, { status: 400 })
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ error: 'Wachtwoord moet minimaal 8 tekens zijn' }, { status: 400 })
    }
    const db = getDb()
    const hash = hashPassword(password)
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
      .run('auth_password_hash', hash, hash)
    const token = createSession()
    const res = NextResponse.json({ ok: true })
    res.cookies.set('session', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false,
      maxAge: 60 * 60 * 24 * 30,
    })
    return res
  }

  if (action === 'login') {
    if (!isPasswordSet()) {
      return NextResponse.json({ error: 'Stel eerst een wachtwoord in' }, { status: 400 })
    }
    const db = getDb()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('auth_password_hash') as { value: string } | undefined
    if (!row || !verifyPassword(password, row.value)) {
      return NextResponse.json({ error: 'Onjuist wachtwoord' }, { status: 401 })
    }
    const token = createSession()
    const res = NextResponse.json({ ok: true })
    res.cookies.set('session', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false,
      maxAge: 60 * 60 * 24 * 30,
    })
    return res
  }

  return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
}
