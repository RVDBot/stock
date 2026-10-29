// AI function config — safe to import from client components

export type AiFunction = 'event_lookup' | 'order_import'

export const AI_FUNCTIONS: Record<AiFunction, { label: string; defaultModel: string; defaultMaxTokens: number }> = {
  event_lookup: { label: 'Datum opzoeken (events)', defaultModel: 'claude-haiku-4-5-20251001', defaultMaxTokens: 1024 },
  order_import: { label: 'Bestelling uit document', defaultModel: 'claude-sonnet-5-5', defaultMaxTokens: 16000 },
}

export const AI_FUNCTION_KEYS = Object.keys(AI_FUNCTIONS) as AiFunction[]

// Used when the live model list can't be fetched
export const FALLBACK_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
]

// The Anthropic SDK refuses non-streaming calls above ~21k max_tokens
export const MAX_TOKENS_LIMIT = 16000

export const modelSettingKey = (fn: AiFunction) => `ai_model_${fn}`
export const maxTokensSettingKey = (fn: AiFunction) => `ai_max_tokens_${fn}`
export const usageSettingKey = (fn: AiFunction, kind: 'input' | 'output') => `ai_tokens_${fn}_${kind}`
