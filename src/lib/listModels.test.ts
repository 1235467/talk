import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetFakeServer } from '../test/setup'
import { listModels } from './deepseek'

describe('listModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetFakeServer()
  })

  it('fetches the provider /models endpoint with the bearer key (routed through outboundFetch, proxied server-side in production)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'b-model' }, { id: 'a-model' }] })))
    vi.stubGlobal('fetch', fetchMock)
    const list = await listModels('sk-test', 'https://api.deepseek.com', 'deepseek')
    expect(list).toEqual(['a-model', 'b-model'])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/models')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer sk-test')
  })

  it('rejects providers without a declared models endpoint', async () => {
    await expect(listModels('sk-test', 'https://api.anthropic.com/v1', 'anthropic')).rejects.toThrow('模型列表')
  })
})
