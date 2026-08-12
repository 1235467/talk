import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFakeServer } from '../test/setup'
import { useSettingsStore } from '../store/useSettingsStore'
import { chatCompletion } from './deepseek'
import type { AppSettings, GenerationProfile } from '../types'

const OK_RESPONSE = { choices: [{ message: { content: '好的' }, finish_reason: 'stop' }] }

async function requestBodyFor(profile: GenerationProfile | undefined, provider: AppSettings['aiProvider'] = 'deepseek', model = 'test-model'): Promise<Record<string, unknown>> {
  useSettingsStore.setState({ generationByProvider: profile ? { [provider]: profile } : undefined })
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(OK_RESPONSE)))
  vi.stubGlobal('fetch', fetchMock)
  const result = await chatCompletion({ apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1', model, provider, messages: [{ role: 'user', content: 'hi' }] })
  expect(result.status).toBe('ok')
  return JSON.parse(fetchMock.mock.calls[0][1].body as string)
}

describe('generation profile in requestBody', () => {
  beforeEach(() => resetFakeServer())
  afterEach(() => {
    useSettingsStore.setState({ generationByProvider: undefined })
    vi.unstubAllGlobals()
  })

  it('applies clean defaults: 8096 cap, temperature 1, no reasoning or stream fields', async () => {
    const body = await requestBodyFor(undefined)
    expect(body.max_tokens).toBe(8096)
    expect(body.temperature).toBe(1)
    expect(body.stream).toBeUndefined()
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.thinking).toBeUndefined()
    expect(body.enable_thinking).toBeUndefined()
  })

  it('keeps no model-name hacks: a k3-named model gets the same defaults as any other', async () => {
    const body = await requestBodyFor(undefined, 'custom', 'kimi-k3')
    expect(body.temperature).toBe(1)
    expect(body.max_tokens).toBe(8096)
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('passes reasoning effort through for reasoning_effort adapters only when set', async () => {
    expect((await requestBodyFor({ reasoningEffort: 'auto' }, 'openai')).reasoning_effort).toBeUndefined()
    expect((await requestBodyFor({ reasoningEffort: 'high' }, 'openai')).reasoning_effort).toBe('high')
    expect((await requestBodyFor({ reasoningEffort: 'xhigh' }, 'openai')).reasoning_effort).toBe('xhigh')
  })

  it('maps off to an explicit disable signal per adapter', async () => {
    expect((await requestBodyFor({ reasoningEffort: 'off' }, 'openai')).reasoning_effort).toBe('none')
    expect((await requestBodyFor({ reasoningEffort: 'off' }, 'deepseek')).thinking).toEqual({ type: 'disabled' })
    expect((await requestBodyFor({ reasoningEffort: 'off' }, 'qwen')).enable_thinking).toBe(false)
    const anthropicBody = await requestBodyFor({ reasoningEffort: 'off' }, 'anthropic')
    expect(anthropicBody.thinking).toBeUndefined()
  })

  it('maps any non-auto effort to "on" for boolean-style adapters', async () => {
    expect((await requestBodyFor({ reasoningEffort: 'high' }, 'deepseek')).thinking).toEqual({ type: 'enabled' })
    expect((await requestBodyFor({ reasoningEffort: 'low' }, 'qwen')).enable_thinking).toBe(true)
  })

  it('honours the profile output cap and sampling overrides', async () => {
    const body = await requestBodyFor({ maxOutputTokens: 4096, temperature: 0.7, topP: 0.9, topK: 40 })
    expect(body.max_tokens).toBe(4096)
    expect(body.temperature).toBe(0.7)
    expect(body.top_p).toBe(0.9)
    expect(body.top_k).toBe(40)
  })

  it('streams only when the profile enables it', async () => {
    expect((await requestBodyFor(undefined)).stream).toBeUndefined()
    expect((await requestBodyFor({ streamEnabled: true })).stream).toBe(true)
  })
})
