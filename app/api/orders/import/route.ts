import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getDb } from '@/lib/db'
import { log } from '@/lib/logger'
import { isPositiveInt } from '@/lib/validate'
import { getAiConfig, getClaudeApiKey, checkTokenCap, addTokenUsage, checkRateLimit } from '@/lib/ai'
import { getAliases, getAliasMap } from '@/lib/aliases'
import { analyzeOrderDocument, resolveMatches, validateImportFile, type ImportProduct } from '@/lib/order-import'

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Te veel verzoeken. Probeer het over een minuut opnieuw.' }, { status: 429 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Upload kon niet gelezen worden' }, { status: 400 })
  }
  const supplierId = parseInt(String(form.get('supplier_id') || ''), 10)
  const file = form.get('file')
  if (!isPositiveInt(supplierId)) return NextResponse.json({ error: 'supplier_id is verplicht' }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'Geen bestand ontvangen' }, { status: 400 })

  const fileError = validateImportFile(file.type, file.size)
  if (fileError) return NextResponse.json({ error: fileError }, { status: 400 })

  const db = getDb()
  const apiKey = getClaudeApiKey(db)
  if (!apiKey) return NextResponse.json({ error: 'Claude API key niet geconfigureerd. Ga naar Instellingen.' }, { status: 400 })
  const capError = checkTokenCap(db)
  if (capError) return NextResponse.json({ error: capError }, { status: 429 })

  const products = db.prepare('SELECT id, sku, name FROM products WHERE supplier_id = ? AND active = 1 AND archived = 0 ORDER BY name')
    .all(supplierId) as ImportProduct[]
  if (products.length === 0) {
    return NextResponse.json({ error: 'Deze leverancier heeft geen actieve producten' }, { status: 400 })
  }

  const { model, maxTokens } = getAiConfig(db, 'order_import')
  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
    const { extraction, truncated, usage } = await analyzeOrderDocument({
      apiKey, model, maxTokens, mediaType: file.type, base64, products, aliases: getAliases(db, supplierId),
    })
    addTokenUsage(db, 'order_import', usage.input, usage.output)

    const result = resolveMatches(extraction, new Set(products.map(p => p.id)), getAliasMap(db, supplierId))
    const counts = result.lines.reduce<Record<string, number>>((acc, l) => { acc[l.match] = (acc[l.match] || 0) + 1; return acc }, {})
    log(truncated ? 'warn' : 'info', `Bestelling uit document (leverancier ${supplierId}): ${result.lines.length} regels ${JSON.stringify(counts)}${truncated ? ', afgekapt' : ''} (tokens: ${usage.input + usage.output}, ${model})`)

    return NextResponse.json({ ...result, truncated })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('error', `Bestelling uit document mislukt (leverancier ${supplierId}, ${model}): ${msg}`)
    return NextResponse.json({ error: 'Analyse mislukt. Controleer de API key en het model in Instellingen en probeer opnieuw.' }, { status: 500 })
  }
}
