import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatCompletion, separateSupplierThinking } from './deepseek'

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

describe('structured chat completion result', () => {
  it('classifies HTTP success with an empty body separately and retries once', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: 'thinking' } }], usage: { completion_tokens_details: { reasoning_tokens: 20 } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await chatCompletion(base)

    expect(result.status).toBe('empty')
    expect(result.retried).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps finish reason, reasoning and token diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'length', message: { content: 'visible', reasoning_content: 'hidden' } }],
      usage: { prompt_tokens: 10, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 18 } },
    }), { status: 200 })))

    const result = await chatCompletion(base)

    expect(result.status).toBe('length')
    expect(result.content).toBe('visible')
    expect(result.reasoning).toBe('hidden')
    expect(result.usage?.reasoningTokens).toBe(18)
  })

  it('classifies safety blocking and malformed successful payloads', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
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
