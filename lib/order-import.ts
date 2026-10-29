import Anthropic from '@anthropic-ai/sdk'
import { aliasKey, type AliasRow } from '@/lib/aliases'
import { isDateString } from '@/lib/validate'
import type { ImportResult, ImportedLine, MatchKind } from '@/lib/order-types'

export const ALLOWED_IMPORT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // Anthropic image limit

export interface ImportProduct { id: number; sku: string; name: string }

export interface ExtractedLine {
  supplier_code: string | null
  supplier_description: string
  quantity: number
  product_id: number | null
  confidence: 'high' | 'low'
}

export interface Extraction {
  order_date: string | null
  supplier_ref: string | null
  lines: ExtractedLine[]
}

const TOOL_NAME = 'register_order'

const EXTRACT_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'Registreer de bestelling zoals die in het document staat.',
  input_schema: {
    type: 'object',
    properties: {
      order_date: { type: ['string', 'null'], description: 'Besteldatum of documentdatum als YYYY-MM-DD, null als die er niet staat' },
      supplier_ref: { type: ['string', 'null'], description: 'Order-, proforma- of factuurnummer van de fabrikant, null als het ontbreekt' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            supplier_code: { type: ['string', 'null'], description: 'Artikelcode van de fabrikant zoals in het document' },
            supplier_description: { type: 'string', description: 'Omschrijving zoals in het document, inclusief kleur/variant' },
            quantity: { type: 'number', description: 'Bestelde aantal stuks' },
            product_id: { type: ['integer', 'null'], description: 'id uit de productlijst, of null als je het niet zeker weet' },
            confidence: { type: 'string', enum: ['high', 'low'], description: 'high alleen als naam én kleur/variant duidelijk overeenkomen' },
          },
          required: ['supplier_code', 'supplier_description', 'quantity', 'product_id', 'confidence'],
        },
      },
    },
    required: ['order_date', 'supplier_ref', 'lines'],
  },
}

export function buildImportPrompt(products: ImportProduct[], aliases: AliasRow[]): string {
  const productList = products.map(p => `${p.id} | ${p.sku} | ${p.name}`).join('\n')
  const aliasList = aliases.length > 0
    ? aliases.map(a => `${a.supplier_code ?? '-'} | ${a.supplier_description ?? '-'} → ${a.product_id}`).join('\n')
    : '(nog geen)'
  return `Dit document is een bestelling, orderbevestiging, proforma of factuur van een fabrikant.
Haal elke bestelde productregel eruit en registreer de bestelling met de tool ${TOOL_NAME}.

De fabrikant gebruikt eigen artikelcodes. Koppel elke regel aan een product uit onderstaande lijst op basis van productnaam en kleur/variant (bijv. lengte, maat).
- Kies alleen een id uit de lijst; verzin nooit een id.
- Twijfel je tussen meerdere producten, of past geen product: product_id = null.
- confidence = "high" alleen als naam én kleur/variant duidelijk overeenkomen, anders "low".
- Sla regels over die geen product zijn (verzendkosten, korting, btw, totalen).

Producten van deze leverancier (id | SKU | naam):
${productList}

Eerder bevestigde koppelingen (fabrikantcode | omschrijving → id):
${aliasList}`
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, max)
  return t || null
}

// Tool input may be partial when the response hit max_tokens — keep only well-formed lines
export function sanitizeExtraction(raw: unknown): Extraction {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const lines: ExtractedLine[] = []
  for (const item of Array.isArray(r.lines) ? r.lines : []) {
    if (!item || typeof item !== 'object') continue
    const l = item as Record<string, unknown>
    const description = text(l.supplier_description, 500)
    if (!description) continue
    const qty = Math.round(Number(l.quantity))
    lines.push({
      supplier_code: text(l.supplier_code, 200),
      supplier_description: description,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 0,
      product_id: Number.isInteger(l.product_id) ? (l.product_id as number) : null,
      confidence: l.confidence === 'high' ? 'high' : 'low',
    })
  }
  return {
    order_date: isDateString(r.order_date) ? r.order_date : null,
    supplier_ref: text(r.supplier_ref, 100),
    lines,
  }
}

export function resolveMatches(extraction: Extraction, validProductIds: Set<number>, aliasMap: Map<string, number>): Omit<ImportResult, 'truncated'> {
  const lines: ImportedLine[] = extraction.lines.map(l => {
    const key = aliasKey(l.supplier_code, l.supplier_description)
    const remembered = key ? aliasMap.get(key) : undefined
    let productId: number | null
    let match: MatchKind
    if (remembered !== undefined && validProductIds.has(remembered)) {
      productId = remembered
      match = 'memory'
    } else if (l.product_id !== null && validProductIds.has(l.product_id)) {
      productId = l.product_id
      match = l.confidence === 'high' ? 'confident' : 'uncertain'
    } else {
      productId = null
      match = 'none'
    }
    return { supplier_code: l.supplier_code, supplier_description: l.supplier_description, quantity: l.quantity, product_id: productId, match }
  })
  return { order_date: extraction.order_date, supplier_ref: extraction.supplier_ref, lines }
}

export async function analyzeOrderDocument(opts: {
  apiKey: string; model: string; maxTokens: number
  mediaType: string; base64: string
  products: ImportProduct[]; aliases: AliasRow[]
}): Promise<{ extraction: Extraction; truncated: boolean; usage: { input: number; output: number } }> {
  const client = new Anthropic({ apiKey: opts.apiKey })
  const documentBlock: Anthropic.ContentBlockParam = opts.mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: opts.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: opts.mediaType as 'image/png' | 'image/jpeg' | 'image/webp', data: opts.base64 } }

  const message = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{
      role: 'user',
      content: [documentBlock, { type: 'text', text: buildImportPrompt(opts.products, opts.aliases) }],
    }],
  })

  const toolUse = message.content.find(b => b.type === 'tool_use')
  return {
    extraction: sanitizeExtraction(toolUse?.type === 'tool_use' ? toolUse.input : undefined),
    truncated: message.stop_reason === 'max_tokens',
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
  }
}
