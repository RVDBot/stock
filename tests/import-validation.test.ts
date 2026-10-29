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
