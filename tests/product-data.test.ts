import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db'
import { importProductData, parseCsv, parseEuro, parseProductSheet, updateProductData, validateProductData } from '@/lib/product-data'
import { buildFulfilmentMail } from '@/lib/fulfilment-mail'
import { createOrder, setOrderStatus } from '@/lib/orders'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  db.prepare("INSERT INTO suppliers (id, name, lead_time_days) VALUES (1, 'Fab', 30)").run()
  db.prepare(`INSERT INTO products (id, woo_product_id, sku, name, supplier_id, current_stock) VALUES
    (10, 1, 'A1', 'Rope — Red / 3m', 1, 5),
    (11, 2, 'B1', 'New <Rope> — Blue', 1, 0),
    (12, 3, 'C1', 'Plain rope', 1, 0),
    (13, 4, 'A+B', 'Bundel', 1, 0),
    (14, 5, 'TEMP1', 'Tijdelijk', 1, 0)`).run()
})

const SHEET = `﻿SKU,Omschrijving,Variant,Variant,Variant,Barcode,COGM,COGS (Cost of goods sold),Country of origin,HS-Code,Old barcode,,
A1,Rope,Red,3m,,0123456789012,"€ 1,50","€ 1.234,50",NL,9506919000,,,
B1,"Rope, new",Blue,,,0123456789012,-,"€ 0,00",CHN,9506919000,,,
OLD,Oude rope,Red,,,999,,,CHN,1,,,
GONE,Weg,Red,,,uitverkocht,,,CHN,1,,,
`

describe('productsheet', () => {
  it('leest quotes en BOM', () => {
    expect(parseCsv('﻿a,"b,""c"\r\n1,2\r\n')).toEqual([['a', 'b,"c'], ['1', '2']])
  })

  it('leest bedragen en behandelt 0 en - als onbekend', () => {
    expect(parseEuro('€ 1,50')).toBe(1.5)
    expect(parseEuro('€ 1.234,50')).toBe(1234.5)
    expect(parseEuro('€ 0,00')).toBeNull()
    expect(parseEuro('-')).toBeNull()
    expect(parseEuro('')).toBeNull()
  })

  it('weigert een CSV zonder SKU of barcode', () => {
    expect(parseProductSheet('Naam,Prijs\nx,1\n')).toBeNull()
  })

  it('werkt alleen bestaande producten bij en meldt de rest', () => {
    const result = importProductData(db, parseProductSheet(SHEET)!)
    expect(result).toMatchObject({ updated: 2, not_in_dashboard: 1, discontinued: 1 })
    expect(result.duplicate_barcodes).toEqual([{ barcode: '0123456789012', skus: ['A1', 'B1'] }])
    expect(result.active_without_barcode).toEqual(['C1'])
    expect(db.prepare("SELECT barcode, variant, cogm, cogs, country_of_origin, hs_code FROM products WHERE sku = 'A1'").get())
      .toEqual({ barcode: '0123456789012', variant: 'Red / 3m', cogm: 1.5, cogs: 1234.5, country_of_origin: 'NLD', hs_code: '9506919000' })
    expect(db.prepare("SELECT cogm, cogs FROM products WHERE sku = 'B1'").get()).toEqual({ cogm: null, cogs: null })
  })

  it('wist bestaande waarden niet bij lege cellen', () => {
    updateProductData(db, 11, validateProductData({ barcode: '111', cogs: '2,5' })!)
    importProductData(db, parseProductSheet('SKU,Barcode,COGS\nB1,,\n')!)
    expect(db.prepare('SELECT barcode, cogs FROM products WHERE id = 11').get()).toEqual({ barcode: '111', cogs: 2.5 })
  })

  it('weigert een ongeldig bedrag', () => {
    expect(validateProductData({ cogm: 'abc' })).toBeNull()
  })
})

describe('fulfilmentmail', () => {
  const base = { supplier_id: 1, order_date: '2026-10-01', supplier_ref: null, notes: null }

  it('noemt nieuwe producten en zet alle kolommen in de tabel', () => {
    importProductData(db, parseProductSheet(SHEET)!)
    const id = createOrder(db, { ...base, expected_arrival: '2026-11-15', lines: [
      { product_id: 10, quantity: 100 },
      { product_id: 11, quantity: 5 },
      { product_id: null, quantity: 7, supplier_description: 'Nieuwe fabrikantkabel' },
    ] })
    const mail = buildFulfilmentMail(db, id)!
    expect(mail.subject).toBe('Inkomende bestelling – verwachte aankomst 15-11-2026')
    expect(mail.text).toContain('Hi Peter,')
    expect(mail.text).toContain('Er zitten 2 nieuwe producten in:')
    expect(mail.text).toContain('- B1 – New <Rope> (Blue)')
    expect(mail.text).toContain('- Nieuwe fabrikantkabel')
    expect(mail.text).not.toContain('- A1')
    expect(mail.text).toContain('SKU\tNaam\tVariant\tBarcode\tHS-code\tLand van herkomst\tAantal')
    expect(mail.text).toContain('A1\tRope\tRed / 3m\t0123456789012\t9506919000\tNLD\t100')
    expect(mail.html).toContain('New &lt;Rope&gt;')
    expect(mail.html).not.toContain('<Rope>')
  })

  it('valt terug op de productnaam voor de variant en waarschuwt bij een ontbrekende barcode', () => {
    const id = createOrder(db, { ...base, expected_arrival: null, lines: [{ product_id: 11, quantity: 1 }] })
    const mail = buildFulfilmentMail(db, id)!
    expect(mail.subject).toBe('Inkomende bestelling')
    expect(mail.text).toContain('Er komt een bestelling aan.')
    expect(mail.text).toContain('Er zit 1 nieuw product in:')
    expect(mail.text).toContain('B1\tNew <Rope>\tBlue\t\t\t\t1')
    expect(mail.missing_barcodes).toEqual(['B1'])
  })

  it('telt een product met verkopen, voorraadhistorie of eerdere ontvangst niet als nieuw', () => {
    db.prepare("INSERT INTO sales_history (product_id, date, quantity) VALUES (11, '2026-01-01', 2)").run()
    db.prepare("INSERT INTO stock_snapshots (product_id, date, stock_level) VALUES (12, '2026-01-01', 3)").run()
    const earlier = createOrder(db, { ...base, expected_arrival: null, lines: [{ product_id: 13, quantity: 1 }] })
    setOrderStatus(db, earlier, 'received')
    const id = createOrder(db, { ...base, expected_arrival: null, lines: [{ product_id: 11, quantity: 1 }, { product_id: 12, quantity: 1 }, { product_id: 13, quantity: 1 }] })
    expect(buildFulfilmentMail(db, id)!.text).not.toContain('nieuw')
  })

  it('blijft een product nieuw zolang alleen deze order ontvangen is', () => {
    const id = createOrder(db, { ...base, expected_arrival: null, lines: [{ product_id: 11, quantity: 1 }] })
    setOrderStatus(db, id, 'received')
    expect(buildFulfilmentMail(db, id)!.text).toContain('Er zit 1 nieuw product in:')
  })

  it('geeft null voor een onbekende order', () => {
    expect(buildFulfilmentMail(db, 999)).toBeNull()
  })
})
