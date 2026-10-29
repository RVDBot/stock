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
