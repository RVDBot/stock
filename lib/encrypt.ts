import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const PREFIX = 'enc:'

function getKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) return null
  return crypto.scryptSync(raw, 'stock-dashboard-salt', 32)
}

export function encryptValue(plaintext: string): string {
  const key = getKey()
  if (!key) return plaintext
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted.toString('hex')
}

export function decryptValue(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored // plaintext fallback
  const key = getKey()
  if (!key) return stored // can't decrypt without key, return as-is
  const parts = stored.slice(PREFIX.length).split(':')
  if (parts.length !== 3) return stored
  const [ivHex, tagHex, encHex] = parts
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8')
}

export function isEncryptionEnabled(): boolean {
  return !!process.env.ENCRYPTION_KEY
}
