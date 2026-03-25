// Lightweight input validation helpers (no external deps)

export function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

export function isPositiveInt(v: unknown): v is number {
  return isInt(v) && v > 0
}

export function isIntOrNull(v: unknown): v is number | null {
  return v === null || isInt(v)
}

export function isString(v: unknown): v is string {
  return typeof v === 'string'
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

export function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === 'string'
}

export function isIntArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.length > 0 && v.length <= 10_000 && v.every(isInt)
}

export function isDateString(v: unknown): v is string {
  if (typeof v !== 'string') return false
  return /^\d{4}-\d{2}-\d{2}$/.test(v)
}

export function isDateStringOrNull(v: unknown): v is string | null {
  return v === null || isDateString(v)
}

export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (!isInt(v)) return fallback
  return Math.max(min, Math.min(max, v))
}
