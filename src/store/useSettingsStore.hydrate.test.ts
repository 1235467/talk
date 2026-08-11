import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../lib/api/resources'
import { resetFakeServer, setFakeServerConfigured } from '../test/setup'
import { hydrateSettingsFromServer, useSettingsStore } from './useSettingsStore'

beforeEach(() => {
  localStorage.clear()
  resetFakeServer()
})

describe('hydrateSettingsFromServer', () => {
  it('normalizes structured provider settings written by older builds', async () => {
    // kv captured before the volcano provider existed: no volcano block at all.
    await api.kv.set('imageProviders', {
      atlas: { apiKey: 'old-key', baseUrl: 'https://api.atlascloud.ai/api/v1', model: 'bytedance/seedream-v4', size: '1024*1024', promptPrefix: '', visualStyle: 'anime', customVisualStyle: '' },
      custom: { endpoint: '', apiKey: '', method: 'POST', authMode: 'bearer', bodyTemplate: '{}', responsePath: 'url' },
    })
    await api.kv.set('stickerProviders', { giphy: { apiKey: 'g-key', rating: 'pg', language: 'zh-CN' } })
    setFakeServerConfigured(true)

    const applied = await hydrateSettingsFromServer()

    expect(applied).toBeGreaterThan(0)
    const { imageProviders, stickerProviders } = useSettingsStore.getState()
    expect(imageProviders.volcano).toMatchObject({ model: 'doubao-seedream-5-0-pro-260628', size: '2K', optimizeMode: 'fast' })
    expect(imageProviders.atlas.apiKey).toBe('old-key')
    expect(stickerProviders.klipy).toMatchObject({ apiKey: '' })
    expect(stickerProviders.giphy.apiKey).toBe('g-key')
  })
})
