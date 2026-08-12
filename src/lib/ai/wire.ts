import { useSettingsStore } from '../../store/useSettingsStore'
import { AI_PROVIDERS, clampProviderTemperature, type AiProviderId } from './providers'
import type { ChatCompletionOptions, ChatCompletionResult, ChatCompletionStatus, ChatMessage, ChatToolCall } from './types'

/** Empty-200 retries: identical request resent at most twice (3 attempts). */
export const EMPTY_RESPONSE_MAX_ATTEMPTS = 3

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

export function extractCompletion(json: Record<string, any>, provider: AiProviderId): ChatCompletionResult {
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
  const toolCalls: ChatToolCall[] = Array.isArray(message?.tool_calls)
    ? message.tool_calls.flatMap((candidate: unknown, index: number) => {
        if (!candidate || typeof candidate !== 'object') return []
        const call = candidate as Record<string, any>
        const fn = call.function
        if (!fn || typeof fn !== 'object' || typeof fn.name !== 'string') return []
        // Spec shape is a JSON string; some APIs hand back a parsed object.
        const args = typeof fn.arguments === 'string' ? fn.arguments : fn.arguments && typeof fn.arguments === 'object' ? JSON.stringify(fn.arguments) : null
        if (args === null) return []
        const id = typeof call.id === 'string' && call.id ? call.id : `call_${index}`
        return [{ id, type: 'function' as const, function: { name: fn.name, arguments: args } }]
      })
    : []
  if (toolCalls.length === 0 && /tool_calls/i.test(String(choice?.finish_reason ?? ''))) {
    console.warn('[ai-call] finish_reason=tool_calls 但没有解析出有效调用，原始形状:', rawShapeSummary(json))
  }
  // A tool-calling reply may legitimately have no visible content.
  const status: ChatCompletionStatus = blocked
    ? 'blocked'
    : length
      ? 'length'
      : !recognizable
        ? 'malformed'
        : separated.content.trim() || toolCalls.length > 0
          ? 'ok'
          : 'empty'
  return { status, content: separated.content, reasoning, finishReason, usage, toolCalls }
}

export function completionStatusMessage(result: ChatCompletionResult): string {
  if (result.status === 'blocked') return '模型拒绝或安全策略拦截了本次回复，请调整内容后再试'
  if (result.status === 'length') return result.content ? '模型回复达到长度上限，内容可能不完整' : '模型达到长度上限但没有返回正文'
  if (result.status === 'empty') return result.reasoning ? '模型只返回了思考内容，没有返回可见正文' : `接口连续 ${EMPTY_RESPONSE_MAX_ATTEMPTS} 次返回成功但正文为空，请点击“再次尝试”重新请求`
  if (result.status === 'malformed') return '接口返回成功，但响应结构不兼容 Chat Completions 协议'
  return '模型没有返回有效正文'
}

/**
 * One-shot fixes for provider capability mismatches, detected from a 4xx
 * body. Each fix applies at most once per call; these are deterministic
 * corrections, not retries, so they don't consume the empty-response budget.
 */
export function degradationFor(status: number, payload: unknown, applied: { disableJson: boolean; alternateToken: boolean }): 'disableJson' | 'alternateToken' | null {
  if (status < 400 || status >= 500) return null
  const text = JSON.stringify(payload).toLowerCase()
  if (!applied.disableJson && /response.?format|json.?mode/.test(text)) return 'disableJson'
  if (!applied.alternateToken && /max_tokens|max_completion_tokens/.test(text)) return 'alternateToken'
  return null
}

export function requestBody(opts: ChatCompletionOptions, messages: ChatMessage[], provider: AiProviderId, fixes: { disableJson?: boolean; alternateToken?: boolean } = {}): Record<string, unknown> {
  const adapter = AI_PROVIDERS[provider]
  const profile = useSettingsStore.getState().generationByProvider?.[provider]
  const tokenParameter = fixes.alternateToken
    ? adapter.tokenParameter === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'
    : adapter.tokenParameter
  const body: Record<string, unknown> = { model: opts.model, messages }
  if (opts.jsonMode && !fixes.disableJson && adapter.responseFormat !== 'ignored') body.response_format = { type: 'json_object' }
  const temperature = clampProviderTemperature(provider, profile?.temperature ?? 1)
  if (temperature !== undefined) body.temperature = temperature
  if (profile?.topP !== undefined) body.top_p = profile.topP
  if (profile?.topK !== undefined) body.top_k = profile.topK
  // The per-provider profile is the single output-cap source (default 8096);
  // per-call caps are retired — reasoning models burn small caps before
  // emitting visible text, and billing is per actual output anyway.
  body[tokenParameter] = profile?.maxOutputTokens ?? 8096
  if (opts.tools?.length) {
    body.tools = opts.tools
    body.tool_choice = opts.toolChoice ?? 'auto'
  }
  // auto = send nothing at all (provider default; thinking models default to
  // on). off = explicitly disable. Boolean-style adapters treat any actual
  // effort level as "on".
  const effort = profile?.reasoningEffort ?? 'auto'
  if (effort === 'off') {
    if (adapter.thinking === 'reasoning_effort') body.reasoning_effort = 'none'
    else if (adapter.thinking === 'deepseek') body.thinking = { type: 'disabled' }
    else if (adapter.thinking === 'enable_thinking') body.enable_thinking = false
    // anthropic defaults to no thinking; nothing to send.
  } else if (effort !== 'auto') {
    if (adapter.thinking === 'reasoning_effort') body.reasoning_effort = effort
    else if (adapter.thinking === 'deepseek') body.thinking = { type: 'enabled' }
    else if (adapter.thinking === 'enable_thinking') body.enable_thinking = true
    else if (adapter.thinking === 'anthropic') body.thinking = { type: 'enabled', budget_tokens: 1024 }
  }
  return body
}

/**
 * Reads an SSE chat-completions stream and folds it back into the standard
 * non-streaming response shape, so the rest of chatCompletion (status
 * classification, usage accounting, retries) works unchanged. Accumulates
 * both content and reasoning_content deltas; the latter keeps the
 * reasoningFields lookup in extractCompletion working for kimi/custom.
 */
export async function readStreamingCompletion(body: ReadableStream<Uint8Array>, onDelta?: (text: string) => void): Promise<Record<string, any>> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  let finishReason: string | undefined
  let usage: Record<string, unknown> | undefined
  // Tool calls stream as per-index fragments: id/name arrive in the first
  // fragment, arguments stream as string pieces to concatenate.
  const toolParts = new Map<number, { id: string; name: string; arguments: string }>()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        const chunk = JSON.parse(data)
        const choice = chunk?.choices?.[0]
        const delta = choice?.delta
        if (typeof delta?.content === 'string') {
          content += delta.content
          onDelta?.(delta.content)
        }
        if (typeof delta?.reasoning_content === 'string') reasoning += delta.reasoning_content
        if (typeof delta?.reasoning === 'string') reasoning += delta.reasoning
        if (Array.isArray(delta?.tool_calls)) {
          for (const part of delta.tool_calls) {
            if (!part || typeof part !== 'object') continue
            const index = typeof part.index === 'number' ? part.index : 0
            const acc = toolParts.get(index) ?? { id: '', name: '', arguments: '' }
            if (typeof part.id === 'string') acc.id = part.id
            if (typeof part.function?.name === 'string') acc.name = part.function.name
            if (typeof part.function?.arguments === 'string') acc.arguments += part.function.arguments
            toolParts.set(index, acc)
          }
        }
        if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason
        if (chunk?.usage && typeof chunk.usage === 'object') usage = chunk.usage
      } catch {}
    }
  }
  const toolCalls = [...toolParts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, part]) => ({ id: part.id || `call_${index}`, type: 'function', function: { name: part.name, arguments: part.arguments } }))
  return { choices: [{ message: { content, reasoning_content: reasoning || undefined, tool_calls: toolCalls.length ? toolCalls : undefined }, finish_reason: finishReason }], usage }
}
