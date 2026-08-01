export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}
import { assertAutomaticAiBudget, estimateTokens, recordAiUsage } from './aiUsage'
import { v4 as uuid } from 'uuid'
import { db } from '../db/db'
import type { AdminAiTraceStage, AiUsagePurpose } from '../types'
import { friendlyConnectionError, httpFailureMessage, parseJsonText, requireApiKey, requireHttpUrl } from './connectionError'
import { useSettingsStore } from '../store/useSettingsStore'
import { foundationalWorldviewText } from './worldbook'
import { appFetch } from './appFetch'
import {
  AI_PROVIDERS,
  clampProviderTemperature,
  resolveChatCompletionsUrl,
  resolveModelsUrl,
  type AiProviderId,
} from './aiProviders'

/**
 * Merges consecutive same-role messages into one. Each AI turn is stored as
 * several separate assistant bubbles in the db (one per sentence/sticker),
 * so naively mapping history 1:1 produces long runs of back-to-back
 * "assistant" messages with no interleaved "user" turn — most chat APIs
 * (and the underlying chat template) expect strict user/assistant
 * alternation, and violating it visibly degrades reply quality from the
 * second turn onward. Coalescing restores one message per real turn.
 */
export function coalesceConsecutiveRoles(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  for (const m of messages) {
    const last = result[result.length - 1]
    if (last && last.role === m.role) {
      last.content = `${last.content}\n${m.content}`
    } else {
      result.push({ ...m })
    }
  }
  return result
}

async function traceAiCall(opts: { purpose: AiUsagePurpose; model: string; messages: ChatMessage[]; output?: string; error?: string; inputTokens: number; outputTokens: number; turnId?: string; stage?: AdminAiTraceStage; conversationId?: string; diagnostics?: Record<string, unknown> }) {
  try {
    await db.adminAiTraces.add({ id: uuid(), ...opts, createdAt: Date.now() })
    const count = await db.adminAiTraces.count()
    if (count > 500) {
      const staleIds = await db.adminAiTraces.orderBy('createdAt').limit(count - 500).primaryKeys()
      if (staleIds.length) await db.adminAiTraces.bulkDelete(staleIds)
    }
  } catch {}
}

export async function listModels(apiKey: string, baseUrl: string, provider: AiProviderId = useSettingsStore.getState().aiProvider): Promise<string[]> {
  try {
    const key = requireApiKey(apiKey, 'AI')
    requireHttpUrl(baseUrl || AI_PROVIDERS[provider].defaultBaseUrl, 'Base URL')
    const modelsUrl = resolveModelsUrl(baseUrl, provider)
    if (!modelsUrl) throw new Error(`${AI_PROVIDERS[provider].label} 未声明兼容的模型列表接口，请直接填写模型名称`)
    const res = await appFetch(modelsUrl, {
      headers: { Authorization: `Bearer ${key}` },
    })
    const text = await res.text()
    const json = parseJsonText(text, 'AI 接口') as { data?: unknown }
    if (!res.ok) throw new Error(httpFailureMessage('AI 接口', res.status, json))
    if (!Array.isArray(json?.data)) throw new Error('AI 接口返回的数据中没有模型列表，请检查 Base URL 是否兼容 OpenAI 接口')
    const list = json.data
      .flatMap((item) => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' ? [(item as { id: string }).id] : [])
      .sort()
    if (list.length === 0) throw new Error('AI 接口连接成功，但没有返回可用模型')
    return list
  } catch (error) {
    throw new Error(friendlyConnectionError(error, 'AI 接口'))
  }
}

export async function testConnection(
  apiKey: string,
  baseUrl: string,
  model: string,
  provider: AiProviderId = useSettingsStore.getState().aiProvider,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (!model.trim()) throw new Error('请先填写或选择模型')
    const result = await chatCompletion({
      apiKey,
      baseUrl,
      model,
      provider,
      messages: [{ role: 'user', content: '你好' }],
      maxTokens: 32,
      temperature: 0.2,
      purpose: 'other',
    })
    if (result.status !== 'ok' || !result.content.trim()) return { ok: false, message: completionStatusMessage(result) }
    return { ok: true, message: '连接成功，模型已正常返回回复' }
  } catch (err) {
    return { ok: false, message: friendlyConnectionError(err, 'AI 接口') }
  }
}

const FOUNDATIONAL_PURPOSES = new Set<AiUsagePurpose>(['chat', 'proactive', 'moments', 'lifeSimulation', 'persona', 'other'])

async function messagesWithFoundationalWorldview(messages: ChatMessage[], model: string, purpose: AiUsagePurpose): Promise<ChatMessage[]> {
  const settings = useSettingsStore.getState()
  if (model !== settings.model || !FOUNDATIONAL_PURPOSES.has(purpose)) return messages
  if (messages.some((message) => message.content.includes('【底层世界观——全局最高优先级正史】'))) return messages
  const worldview = await foundationalWorldviewText()
  if (!worldview) return messages
  const next = messages.map((message) => ({ ...message }))
  const systemIndex = next.findIndex((message) => message.role === 'system')
  if (systemIndex >= 0) next[systemIndex].content = `${worldview}\n\n${next[systemIndex].content}`
  else next.unshift({ role: 'system', content: worldview })
  return next
}

export type ChatCompletionStatus = 'ok' | 'empty' | 'blocked' | 'length' | 'malformed'

export interface ChatCompletionResult {
  status: ChatCompletionStatus
  content: string
  reasoning?: string
  finishReason?: string
  usage?: { promptTokens?: number; completionTokens?: number; reasoningTokens?: number; totalTokens?: number }
  provider: AiProviderId
  rawShapeSummary: Record<string, unknown>
  retried?: boolean
}

export interface ChatCompletionOptions {
  apiKey: string
  baseUrl: string
  model: string
  provider?: AiProviderId
  messages: ChatMessage[]
  signal?: AbortSignal
  /**
   * Only safe for genuinely single-turn calls (persona generation, memory
   * summarization) that never carry accumulated assistant history. On the
   * main multi-turn chat call, forcing json_object mode was measured to
   * make the model emit pure-whitespace/blank completions from the 2nd
   * turn onward — see coalesceConsecutiveRoles's neighbor note and project
   * memory. Leave this off there and rely on prompt instructions instead.
   */
  jsonMode?: boolean
  purpose?: AiUsagePurpose
  automatic?: boolean
  maxTokens?: number
  temperature?: number
  thinking?: 'enabled' | 'disabled'
  trace?: { turnId: string; stage: AdminAiTraceStage; conversationId?: string }
}

function stringAt(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.flatMap((part) => {
    if (typeof part === 'string') return [part]
    if (!part || typeof part !== 'object') return []
    const record = part as Record<string, unknown>
    if (typeof record.text === 'string') return [record.text]
    if (record.text && typeof record.text === 'object' && typeof (record.text as Record<string, unknown>).value === 'string') return [String((record.text as Record<string, unknown>).value)]
    if (typeof record.content === 'string') return [record.content]
    return []
  }).join('')
}

export function separateSupplierThinking(content: string, provider: AiProviderId): { content: string; reasoning?: string } {
  const thoughts: string[] = []
  let visible = content.replace(/<think>\s*([\s\S]*?)\s*<\/think>/gi, (_match, thought: string) => {
    if (thought.trim()) thoughts.push(thought.trim())
    return ''
  })
  // Gemini-compatible gateways sometimes serialize a thought summary in a
  // leading <thought> block. Keep Talk's own inline <thought> protocol intact;
  // only separate a standalone prefix when the remaining payload is JSON.
  if (provider === 'gemini') {
    visible = visible.replace(/^\s*<thought>\s*([\s\S]*?)\s*<\/thought>[ \t]*(?:\r?\n)+(?=\S)/i, (_match, thought: string) => {
      if (thought.trim()) thoughts.push(thought.trim())
      return ''
    })
  }
  return { content: visible.trim(), reasoning: thoughts.length ? thoughts.join('\n\n') : undefined }
}

function rawShapeSummary(json: Record<string, any>): Record<string, unknown> {
  const choice = Array.isArray(json.choices) ? json.choices[0] : undefined
  const message = choice?.message
  return {
    topLevelKeys: Object.keys(json).slice(0, 20),
    choicesCount: Array.isArray(json.choices) ? json.choices.length : undefined,
    choiceKeys: choice && typeof choice === 'object' ? Object.keys(choice).slice(0, 20) : [],
    messageKeys: message && typeof message === 'object' ? Object.keys(message).slice(0, 20) : [],
    contentType: Array.isArray(message?.content) ? 'array' : typeof message?.content,
  }
}

function extractCompletion(json: Record<string, any>, provider: AiProviderId): ChatCompletionResult {
  const choice = Array.isArray(json.choices) ? json.choices[0] : undefined
  const message = choice?.message
  const rawContent = stringAt(message?.content) || stringAt(choice?.text) || stringAt(json.output_text)
  const separated = separateSupplierThinking(rawContent, provider)
  const adapter = AI_PROVIDERS[provider]
  const reasoningParts = [separated.reasoning]
  for (const field of adapter.reasoningFields) {
    const value = stringAt(message?.[field]) || stringAt(choice?.[field]) || stringAt(json[field])
    if (value) reasoningParts.push(value)
  }
  const reasoning = Array.from(new Set(reasoningParts.filter((value): value is string => !!value?.trim()))).join('\n\n') || undefined
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : typeof json.finish_reason === 'string' ? json.finish_reason : undefined
  const usageRaw = json.usage && typeof json.usage === 'object' ? json.usage : {}
  const usage = {
    promptTokens: Number.isFinite(Number(usageRaw.prompt_tokens)) ? Number(usageRaw.prompt_tokens) : undefined,
    completionTokens: Number.isFinite(Number(usageRaw.completion_tokens)) ? Number(usageRaw.completion_tokens) : undefined,
    reasoningTokens: Number.isFinite(Number(usageRaw.completion_tokens_details?.reasoning_tokens)) ? Number(usageRaw.completion_tokens_details.reasoning_tokens) : undefined,
    totalTokens: Number.isFinite(Number(usageRaw.total_tokens)) ? Number(usageRaw.total_tokens) : undefined,
  }
  const normalizedFinish = finishReason?.toLowerCase() ?? ''
  const blocked = ['content_filter', 'safety', 'blocked'].includes(normalizedFinish)
    || json.output_sensitive === true
    || json.input_sensitive === true
    || message?.refusal && !separated.content
  const length = ['length', 'max_tokens', 'max_completion_tokens'].includes(normalizedFinish)
  const recognizable = !!message || typeof choice?.text === 'string' || typeof json.output_text === 'string'
  const status: ChatCompletionStatus = blocked
    ? 'blocked'
    : length
      ? 'length'
      : !recognizable
        ? 'malformed'
        : separated.content.trim()
          ? 'ok'
          : 'empty'
  return { status, content: separated.content, reasoning, finishReason, usage, provider, rawShapeSummary: rawShapeSummary(json) }
}

function completionStatusMessage(result: ChatCompletionResult): string {
  if (result.status === 'blocked') return '模型拒绝或安全策略拦截了本次回复，请调整内容后再试'
  if (result.status === 'length') return result.content ? '模型回复达到长度上限，内容可能不完整' : '模型达到长度上限但没有返回正文'
  if (result.status === 'empty') return result.reasoning ? '模型只返回了思考内容，没有返回可见正文' : '接口返回成功，但模型正文为空'
  if (result.status === 'malformed') return '接口返回成功，但响应结构不兼容 Chat Completions 协议'
  return '模型没有返回有效正文'
}

function requestBody(opts: ChatCompletionOptions, messages: ChatMessage[], provider: AiProviderId, overrides: { disableJson?: boolean; alternateToken?: boolean; emptyRetry?: boolean } = {}): Record<string, unknown> {
  const adapter = AI_PROVIDERS[provider]
  const tokenParameter = overrides.alternateToken
    ? adapter.tokenParameter === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'
    : adapter.tokenParameter
  const body: Record<string, unknown> = { model: opts.model, messages }
  if (opts.jsonMode && !overrides.disableJson && adapter.responseFormat !== 'ignored') body.response_format = { type: 'json_object' }
  const temperature = clampProviderTemperature(provider, opts.temperature ?? 1.1)
  if (temperature !== undefined) body.temperature = temperature
  if (opts.maxTokens) body[tokenParameter] = overrides.emptyRetry ? Math.ceil(opts.maxTokens * 1.35) : opts.maxTokens
  const thinking = overrides.emptyRetry ? 'disabled' : (opts.thinking ?? 'disabled')
  if (adapter.thinking === 'deepseek') body.thinking = { type: thinking }
  else if (adapter.thinking === 'reasoning_effort') body.reasoning_effort = thinking === 'enabled' ? 'medium' : 'none'
  else if (adapter.thinking === 'enable_thinking') body.enable_thinking = thinking === 'enabled'
  else if (adapter.thinking === 'anthropic' && thinking === 'enabled') body.thinking = { type: 'enabled', budget_tokens: 1024 }
  return body
}

function retryableProtocolError(status: number, payload: unknown): 'response_format' | 'token' | null {
  if (status < 400 || status >= 500) return null
  const text = JSON.stringify(payload).toLowerCase()
  if (/response.?format|json.?mode/.test(text)) return 'response_format'
  if (/max_tokens|max_completion_tokens/.test(text)) return 'token'
  return null
}

export async function chatCompletion(opts: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const purpose = opts.purpose ?? 'other'
  const automatic = opts.automatic ?? false
  const provider = opts.provider ?? useSettingsStore.getState().aiProvider ?? 'deepseek'
  if (automatic) await assertAutomaticAiBudget()
  const messages = await messagesWithFoundationalWorldview(opts.messages, opts.model, purpose)
  const inputTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
  try {
  const key = requireApiKey(opts.apiKey, 'AI')
  requireHttpUrl(opts.baseUrl || AI_PROVIDERS[provider].defaultBaseUrl, 'Base URL')
  const endpoint = resolveChatCompletionsUrl(opts.baseUrl, provider)
  let result: ChatCompletionResult | undefined
  let retryMode: { disableJson?: boolean; alternateToken?: boolean; emptyRetry?: boolean } = {}
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await appFetch(endpoint, {
      method: 'POST', signal: opts.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody(opts, messages, provider, retryMode)),
    })
    const text = await res.text()
    let json: Record<string, any>
    try { json = parseJsonText(text, 'AI 接口') as Record<string, any> }
    catch (error) { if (res.ok || /^\s*</.test(text)) throw error; json = { error: { message: text.slice(0, 500) } } }
    if (!res.ok) {
      const protocolError = attempt === 0 ? retryableProtocolError(res.status, json) : null
      if (protocolError === 'response_format') { retryMode = { disableJson: true }; continue }
      if (protocolError === 'token') { retryMode = { alternateToken: true }; continue }
      if (/content.?filter|safety|blocked|sensitive|涉敏|安全策略/i.test(JSON.stringify(json))) {
        result = { status: 'blocked', content: '', provider, rawShapeSummary: rawShapeSummary(json), retried: attempt > 0 }
        break
      }
      throw new Error(httpFailureMessage('AI 接口', res.status, json))
    }
    result = extractCompletion(json, provider)
    if (attempt === 0 && result.status === 'empty') { retryMode = { disableJson: opts.jsonMode, emptyRetry: true }; continue }
    if (attempt > 0) result.retried = true
    break
  }
  if (!result) throw new Error('AI 接口没有返回可解析的响应')
  const promptTokens = result.usage?.promptTokens
  const completionTokens = result.usage?.completionTokens
  const recordedInputTokens = typeof promptTokens === 'number' && Number.isFinite(promptTokens) ? promptTokens : inputTokens
  const recordedOutputTokens = typeof completionTokens === 'number' && Number.isFinite(completionTokens) ? completionTokens : estimateTokens(result.content)
  const content = result.content
  const success = result.status === 'ok' || (result.status === 'length' && !!content)
  const usageWrite = recordAiUsage({ purpose, model: opts.model, automatic, success, inputTokens: recordedInputTokens, outputTokens: recordedOutputTokens, estimated: typeof promptTokens !== 'number' || typeof completionTokens !== 'number' })
  if (automatic) await usageWrite
  else void usageWrite.catch(() => undefined)
  void traceAiCall({ purpose, model: opts.model, messages, output: content, inputTokens: recordedInputTokens, outputTokens: recordedOutputTokens, diagnostics: { provider, status: result.status, finishReason: result.finishReason, usage: result.usage, rawShapeSummary: result.rawShapeSummary, retried: result.retried ?? false }, ...opts.trace })
  console.info(`[ai-call] purpose=${purpose} provider=${provider} model=${opts.model} status=${result.status} finish=${result.finishReason ?? 'unknown'} contentChars=${content.length} reasoningTokens=${result.usage?.reasoningTokens ?? 'unknown'} outputTokens=${result.usage?.completionTokens ?? 'unknown'} retried=${result.retried ? 'yes' : 'no'}`)
  if (!success) console.warn(`[ai-call] ${completionStatusMessage(result)}`)
  return result
  } catch (error) {
    const usageWrite = recordAiUsage({ purpose, model: opts.model, automatic, success: false, inputTokens, outputTokens: 0, estimated: true, error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) })
    if (automatic) await usageWrite
    else void usageWrite.catch(() => undefined)
    void traceAiCall({ purpose, model: opts.model, messages, error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500), inputTokens, outputTokens: 0, ...opts.trace })
    throw new Error(friendlyConnectionError(error, 'AI 接口'))
  }
}

/** Text-only compatibility helper for non-chat features while callers migrate. */
export async function chatCompletionText(opts: ChatCompletionOptions): Promise<string> {
  const result = await chatCompletion(opts)
  if (result.status === 'ok' || (result.status === 'length' && result.content.trim())) return result.content
  throw new Error(completionStatusMessage(result))
}

export async function chatCompletionStream(opts: ChatCompletionOptions & { onDelta: (text: string) => void }): Promise<string> {
  const purpose = opts.purpose ?? 'other'
  const messages = await messagesWithFoundationalWorldview(opts.messages, opts.model, purpose)
  const inputTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
  const key = requireApiKey(opts.apiKey, 'AI')
  const provider = opts.provider ?? useSettingsStore.getState().aiProvider ?? 'deepseek'
  const res = await appFetch(resolveChatCompletionsUrl(opts.baseUrl, provider), { method: 'POST', signal: opts.signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...requestBody(opts, messages, provider), stream: true }) })
  if (!res.ok || !res.body) {
    const text = await res.text()
    let payload: unknown = text
    try { payload = parseJsonText(text, 'AI 接口') } catch {}
    const protocolError = retryableProtocolError(res.status, payload)
    if (!res.body || protocolError === 'response_format' || /stream|sse|event.?stream/i.test(JSON.stringify(payload))) {
      const { onDelta, ...fallbackOptions } = opts
      const fallback = await chatCompletionText({ ...fallbackOptions, jsonMode: protocolError === 'response_format' ? false : opts.jsonMode })
      onDelta(fallback)
      return fallback
    }
    throw new Error(httpFailureMessage('AI 接口', res.status, payload))
  }
  if (!/text\/event-stream/i.test(res.headers.get('content-type') ?? '')) {
    const json = parseJsonText(await res.text(), 'AI 接口') as Record<string, any>
    const result = extractCompletion(json, provider)
    if (result.status !== 'ok' && !(result.status === 'length' && result.content.trim())) throw new Error(completionStatusMessage(result))
    opts.onDelta(result.content)
    const promptTokens = result.usage?.promptTokens ?? inputTokens
    const outputTokens = result.usage?.completionTokens ?? estimateTokens(result.content)
    await recordAiUsage({ purpose, model: opts.model, automatic: opts.automatic ?? false, success: true, inputTokens: promptTokens, outputTokens, estimated: result.usage?.promptTokens === undefined || result.usage?.completionTokens === undefined })
    await traceAiCall({ purpose, model: opts.model, messages, output: result.content, inputTokens: promptTokens, outputTokens, diagnostics: { provider, status: result.status, finishReason: result.finishReason, nonStreamingFallback: true }, ...opts.trace })
    return result.content
  }
  const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let output = ''
  while (true) {
    const { done, value } = await reader.read(); if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n'); buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim(); if (!data || data === '[DONE]') continue
      try { const delta = JSON.parse(data)?.choices?.[0]?.delta?.content; if (typeof delta === 'string') { output += delta; opts.onDelta(delta) } } catch {}
    }
  }
  if (!output.trim()) throw new Error('模型流式响应结束，但没有返回可见正文')
  await recordAiUsage({ purpose, model: opts.model, automatic: opts.automatic ?? false, success: true, inputTokens, outputTokens: estimateTokens(output), estimated: true })
  await traceAiCall({ purpose, model: opts.model, messages, output, inputTokens, outputTokens: estimateTokens(output), ...opts.trace })
  return output
}
