import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatCompletion } from './client'
import { separateSupplierThinking } from './wire'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const base = {
  apiKey: 'sk-test',
  baseUrl: 'https://api.example.com/v1',
  provider: 'custom' as const,
  model: 'test-model',
  messages: [{ role: 'user' as const, content: 'hello' }],
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('structured chat completion result', () => {
  it('classifies HTTP success with an empty body separately and retries the identical request twice', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: 'thinking' } }], usage: { completion_tokens_details: { reasoning_tokens: 20 } } }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await chatCompletion(base)

    expect(result.status).toBe('empty')
    expect(result.retried).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    // No retry-time request mutation: every attempt sends the same body.
    const bodies = fetchMock.mock.calls.map((call) => String((call[1] as RequestInit).body))
    expect(new Set(bodies).size).toBe(1)
  })

  it('keeps finish reason, reasoning and token diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      choices: [{ finish_reason: 'length', message: { content: 'visible', reasoning_content: 'hidden' } }],
      usage: { prompt_tokens: 10, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 18 } },
    })))

    const result = await chatCompletion(base)

    expect(result.status).toBe('length')
    expect(result.content).toBe('visible')
    expect(result.reasoning).toBe('hidden')
    expect(result.usage?.reasoningTokens).toBe(18)
  })

  it('classifies safety blocking and malformed successful payloads', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    expect((await chatCompletion(base)).status).toBe('blocked')
    expect((await chatCompletion(base)).status).toBe('malformed')
  })

  it('separates MiniMax think tags without removing Talk thought tags', () => {
    expect(separateSupplierThinking('<think>secret</think>\nhello', 'minimax')).toEqual({ content: 'hello', reasoning: 'secret' })
    expect(separateSupplierThinking('<thought>角色自己的想法</thought>你好', 'gemini').content).toContain('<thought>')
    expect(separateSupplierThinking('<thought>supplier summary</thought>\n```json\n{"valid":true}\n```', 'gemini')).toEqual({
      content: '```json\n{"valid":true}\n```',
      reasoning: 'supplier summary',
    })
    expect(separateSupplierThinking('<thought>supplier summary</thought>\nvisible reply', 'gemini')).toEqual({
      content: 'visible reply',
      reasoning: 'supplier summary',
    })
  })
})

describe('one-shot capability degradations', () => {
  it('drops response_format once when the provider rejects json mode', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'response_format is not supported by this model' } }, 400))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '好' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await chatCompletion({ ...base, jsonMode: true })

    expect(result.status).toBe('ok')
    const first = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    const second = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(first.response_format).toEqual({ type: 'json_object' })
    expect(second).not.toHaveProperty('response_format')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('swaps the token parameter once when the model rejects it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }, 400))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '好' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await chatCompletion(base)

    expect(result.status).toBe('ok')
    const first = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    const second = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(first.max_tokens).toBe(8096)
    expect(first).not.toHaveProperty('max_completion_tokens')
    expect(second.max_completion_tokens).toBe(8096)
    expect(second).not.toHaveProperty('max_tokens')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
