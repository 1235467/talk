import { isServerConfigured, serverBase } from '../api/client'
import { appFetch } from '../appFetch'
import { friendlyConnectionError, httpFailureMessage, parseJsonText, requireApiKey } from '../connectionError'
import { useSettingsStore } from '../../store/useSettingsStore'
import type { AiProviderId } from './providers'
import { resolveChatCompletionsUrl } from './providers'
import { assertAutomaticAiBudget, estimateTokens, recordAiUsage, traceAiCall } from './usage'
import type { ChatCompletionOptions, ChatCompletionResult } from './types'
import { completionStatusMessage, degradationFor, EMPTY_RESPONSE_MAX_ATTEMPTS, extractCompletion, readStreamingCompletion, requestBody } from './wire'

/**
 * When a talk server is configured, chat completions go through its
 * /api/ai-proxy endpoint. The proxy forwards to the target URL the client
 * resolves here and injects the API key from the server kv store — so
 * editing the key/endpoint in SettingsPage on any authed device just works
 * everywhere.
 */
function resolveAiEndpoint(opts: ChatCompletionOptions, provider: AiProviderId): { endpoint: string; key: string; targetUrl?: string } {
  if (isServerConfigured()) {
    return {
      // Empty serverBase → relative URL hits the same origin (nginx or the vite dev proxy).
      endpoint: `${serverBase()}/api/ai-proxy`,
      key: useSettingsStore.getState().serverToken,
      targetUrl: resolveChatCompletionsUrl(opts.baseUrl, provider),
    }
  }
  return { endpoint: resolveChatCompletionsUrl(opts.baseUrl, provider), key: requireApiKey(opts.apiKey, 'AI') }
}

export async function chatCompletion(opts: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const purpose = opts.purpose ?? 'other'
  const automatic = opts.automatic ?? false
  const provider = opts.provider ?? useSettingsStore.getState().aiProvider ?? 'deepseek'
  if (automatic) await assertAutomaticAiBudget()
  const messages = opts.messages
  const inputTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
  const startedAt = Date.now()
  try {
    const { endpoint, key, targetUrl } = resolveAiEndpoint(opts, provider)
    // Streaming is an explicit per-provider choice (Settings → AI 接口); a
    // provider that rejects it is a configuration problem, not something to
    // silently work around.
    const stream = useSettingsStore.getState().generationByProvider?.[provider]?.streamEnabled === true
    const fixes = { disableJson: false, alternateToken: false }
    let delivered = false
    const onDelta = opts.onDelta ? (text: string) => { delivered = true; opts.onDelta!(text) } : undefined
    let result: ChatCompletionResult | undefined
    let retried = false
    let emptyRetries = 0
    while (true) {
      const body = requestBody(opts, messages, provider, fixes)
      if (stream) body.stream = true
      const res = await appFetch(endpoint, {
        method: 'POST', signal: opts.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(targetUrl ? { url: targetUrl, payload: body } : body),
      })
      let json: Record<string, any>
      if (stream && res.ok && res.body && /text\/event-stream/i.test(res.headers.get('content-type') ?? '')) {
        json = await readStreamingCompletion(res.body, onDelta)
      } else {
        const text = await res.text()
        try { json = parseJsonText(text, 'AI 接口') as Record<string, any> }
        catch (error) { if (res.ok || /^\s*</.test(text)) throw error; json = { error: { message: text.slice(0, 500) } } }
      }
      if (!res.ok) {
        const fix = degradationFor(res.status, json, fixes)
        if (fix) {
          fixes[fix] = true
          retried = true
          continue
        }
        if (/content.?filter|safety|blocked|sensitive|涉敏|安全策略/i.test(JSON.stringify(json))) {
          result = { status: 'blocked', content: '', retried: retried || undefined }
          break
        }
        throw new Error(httpFailureMessage('AI 接口', res.status, json))
      }
      result = extractCompletion(json, provider)
      if (result.status === 'empty' && emptyRetries < EMPTY_RESPONSE_MAX_ATTEMPTS - 1) {
        emptyRetries += 1
        retried = true
        continue
      }
      if (retried) result.retried = true
      break
    }
    if (!delivered && result.content) opts.onDelta?.(result.content)
    const promptTokens = result.usage?.promptTokens
    const completionTokens = result.usage?.completionTokens
    const recordedInputTokens = typeof promptTokens === 'number' && Number.isFinite(promptTokens) ? promptTokens : inputTokens
    const recordedOutputTokens = typeof completionTokens === 'number' && Number.isFinite(completionTokens) ? completionTokens : estimateTokens(result.content)
    const success = result.status === 'ok' || (result.status === 'length' && !!result.content)
    const durationMs = Date.now() - startedAt
    const usageWrite = recordAiUsage({ purpose, model: opts.model, automatic, success, inputTokens: recordedInputTokens, outputTokens: recordedOutputTokens, estimated: typeof promptTokens !== 'number' || typeof completionTokens !== 'number' })
    if (automatic) await usageWrite
    else void usageWrite.catch(() => undefined)
    void traceAiCall({ purpose, model: opts.model, messages, output: result.content, inputTokens: recordedInputTokens, outputTokens: recordedOutputTokens, durationMs, ...opts.trace })
    console.info(`[ai-call] purpose=${purpose} provider=${provider} model=${opts.model} status=${result.status} finish=${result.finishReason ?? 'unknown'} contentChars=${result.content.length} reasoningTokens=${result.usage?.reasoningTokens ?? 'unknown'} outputTokens=${result.usage?.completionTokens ?? 'unknown'} retried=${result.retried ? 'yes' : 'no'}`)
    if (!success) console.warn(`[ai-call] ${completionStatusMessage(result)}`)
    return result
  } catch (error) {
    const usageWrite = recordAiUsage({ purpose, model: opts.model, automatic, success: false, inputTokens, outputTokens: 0, estimated: true, error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) })
    if (automatic) await usageWrite
    else void usageWrite.catch(() => undefined)
    void traceAiCall({ purpose, model: opts.model, messages, error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500), inputTokens, outputTokens: 0, durationMs: Date.now() - startedAt, ...opts.trace })
    throw new Error(friendlyConnectionError(error, 'AI 接口'))
  }
}

/** Text-only convenience wrapper: most callers just want the reply string. */
export async function chatCompletionText(opts: ChatCompletionOptions): Promise<string> {
  const result = await chatCompletion(opts)
  if (result.status === 'ok' || (result.status === 'length' && result.content.trim())) return result.content
  throw new Error(completionStatusMessage(result))
}
