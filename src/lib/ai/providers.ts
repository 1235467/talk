export type AiProviderId =
  | 'deepseek'
  | 'openai'
  | 'gemini'
  | 'anthropic'
  | 'xai'
  | 'qwen'
  | 'glm'
  | 'minimax'
  | 'kimi'
  | 'custom'

export interface AiProviderAdapter {
  id: AiProviderId
  label: string
  stability: 'stable' | 'experimental' | 'custom'
  defaultBaseUrl: string
  models: 'supported' | 'unknown'
  tokenParameter: 'max_tokens' | 'max_completion_tokens'
  responseFormat: 'supported' | 'ignored' | 'unknown'
  temperature: { min: number; max: number; omit?: boolean }
  thinking: 'deepseek' | 'reasoning_effort' | 'enable_thinking' | 'anthropic' | 'none'
  reasoningFields: string[]
  systemRole: 'native' | 'hoist'
}

/**
 * Named providers are pinned to their registry endpoint — the settings UI
 * shows their Base URL read-only, and any legacy stored override is ignored
 * here. Custom (and anthropic, which is commonly proxied) treat the user
 * input as the base URL verbatim.
 */
export const BASE_URL_EDITABLE: ReadonlySet<AiProviderId> = new Set<AiProviderId>(['custom', 'anthropic'])

export const AI_PROVIDERS: Record<AiProviderId, AiProviderAdapter> = {
  deepseek: { id: 'deepseek', label: 'DeepSeek', stability: 'stable', defaultBaseUrl: 'https://api.deepseek.com', models: 'supported', tokenParameter: 'max_tokens', responseFormat: 'supported', temperature: { min: 0, max: 2 }, thinking: 'deepseek', reasoningFields: ['reasoning_content'], systemRole: 'native' },
  openai: { id: 'openai', label: 'OpenAI / GPT', stability: 'experimental', defaultBaseUrl: 'https://api.openai.com/v1', models: 'supported', tokenParameter: 'max_completion_tokens', responseFormat: 'supported', temperature: { min: 0, max: 2 }, thinking: 'reasoning_effort', reasoningFields: ['reasoning', 'reasoning_content'], systemRole: 'native' },
  gemini: { id: 'gemini', label: 'Google Gemini', stability: 'experimental', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: 'supported', tokenParameter: 'max_completion_tokens', responseFormat: 'supported', temperature: { min: 0, max: 2 }, thinking: 'reasoning_effort', reasoningFields: ['reasoning', 'reasoning_content', 'thought_summary'], systemRole: 'native' },
  anthropic: { id: 'anthropic', label: 'Anthropic Claude', stability: 'experimental', defaultBaseUrl: 'https://api.anthropic.com/v1', models: 'unknown', tokenParameter: 'max_tokens', responseFormat: 'ignored', temperature: { min: 0, max: 1, omit: true }, thinking: 'anthropic', reasoningFields: ['reasoning', 'reasoning_content'], systemRole: 'hoist' },
  xai: { id: 'xai', label: 'xAI Grok', stability: 'experimental', defaultBaseUrl: 'https://api.x.ai/v1', models: 'supported', tokenParameter: 'max_tokens', responseFormat: 'unknown', temperature: { min: 0, max: 2 }, thinking: 'reasoning_effort', reasoningFields: ['reasoning', 'reasoning_content'], systemRole: 'native' },
  qwen: { id: 'qwen', label: '阿里 Qwen', stability: 'experimental', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: 'supported', tokenParameter: 'max_tokens', responseFormat: 'supported', temperature: { min: 0.01, max: 1 }, thinking: 'enable_thinking', reasoningFields: ['reasoning_content'], systemRole: 'native' },
  glm: { id: 'glm', label: '智谱 GLM', stability: 'experimental', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: 'supported', tokenParameter: 'max_tokens', responseFormat: 'unknown', temperature: { min: 0.01, max: 1 }, thinking: 'none', reasoningFields: ['reasoning_content'], systemRole: 'native' },
  minimax: { id: 'minimax', label: 'MiniMax', stability: 'experimental', defaultBaseUrl: 'https://api.minimaxi.com/v1', models: 'unknown', tokenParameter: 'max_completion_tokens', responseFormat: 'unknown', temperature: { min: 0, max: 1 }, thinking: 'none', reasoningFields: ['reasoning_content'], systemRole: 'native' },
  kimi: { id: 'kimi', label: 'Moonshot / Kimi', stability: 'experimental', defaultBaseUrl: 'https://api.moonshot.cn/v1', models: 'supported', tokenParameter: 'max_tokens', responseFormat: 'unknown', temperature: { min: 0, max: 1 }, thinking: 'none', reasoningFields: ['reasoning_content'], systemRole: 'native' },
  custom: { id: 'custom', label: '自定义 OpenAI 兼容接口', stability: 'custom', defaultBaseUrl: '', models: 'unknown', tokenParameter: 'max_tokens', responseFormat: 'unknown', temperature: { min: 0, max: 2 }, thinking: 'none', reasoningFields: ['reasoning_content', 'reasoning'], systemRole: 'native' },
}

export const AI_PROVIDER_OPTIONS = Object.values(AI_PROVIDERS)

/**
 * The input IS the base URL: it is appended with /chat/completions verbatim.
 * No version-path completion, no trailing-slash fixing, no full-endpoint
 * detection — SillyTavern-style. Users see the final URL in the settings
 * preview, so surprises are visible instead of being "helpfully" fixed.
 */
export function resolveChatCompletionsUrl(input: string, providerId: AiProviderId): string {
  const adapter = AI_PROVIDERS[providerId]
  const source = (BASE_URL_EDITABLE.has(providerId) ? input.trim() : '') || adapter.defaultBaseUrl
  if (!source) throw new Error('请填写 Base URL')
  if (!/^https?:\/\//i.test(source)) throw new Error('Base URL 必须以 http:// 或 https:// 开头')
  return `${source}/chat/completions`
}

export function resolveModelsUrl(input: string, providerId: AiProviderId): string | null {
  if (AI_PROVIDERS[providerId].models === 'unknown') return null
  return resolveChatCompletionsUrl(input, providerId).replace(/\/chat\/completions$/i, '/models')
}

export function clampProviderTemperature(providerId: AiProviderId, value: number | undefined): number | undefined {
  const adapter = AI_PROVIDERS[providerId]
  if (adapter.temperature.omit) return undefined
  const candidate = Number.isFinite(value) ? Number(value) : 1
  return Math.min(adapter.temperature.max, Math.max(adapter.temperature.min, candidate))
}
