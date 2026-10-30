import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { log } from '@/lib/logger'
import { importProductData, parseProductSheet } from '@/lib/product-data'

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const body = await req.json()
  const rows = typeof body?.csv === 'string' ? parseProductSheet(body.csv) : null
  if (!rows) return NextResponse.json({ error: 'Geen geldige CSV: de kolommen SKU en Barcode zijn verplicht' }, { status: 400 })

  const result = importProductData(getDb(), rows)
  log('info', `Productgegevens geïmporteerd: ${result.updated} bijgewerkt, ${result.not_in_dashboard} niet in dashboard, ${result.discontinued} uitverkocht`)
  return NextResponse.json(result)
}
