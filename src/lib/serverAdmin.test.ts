import { afterEach, describe, expect, it } from 'vitest'
import { resetFakeServer, setFakeServerConfigured } from '../test/setup'
import { api } from './api/resources'
import { ensureServerPresets, FACTORY_PRESET_NAME } from './promptPresets'
import { createDefaultPromptModules } from './promptModules'

describe('wipeData', () => {
  afterEach(() => resetFakeServer())

  it('clears all data tables but preserves kv and prompt presets', async () => {
    await api.contacts.put({ id: 'c1', name: '某人' } as Parameters<typeof api.contacts.put>[0])
    await api.messages.put({ id: 'm1', conversationId: 'cv1', role: 'user', type: 'text', content: 'hi', createdAt: 1 })
    await api.contactSaveSnapshots.put({ id: 's1', contactId: 'c1', storylineId: 'st1', name: '存档', kind: 'manual', snapshot: {} } as Parameters<typeof api.contactSaveSnapshots.put>[0])
    await api.kv.set('apiKey', 'sk-keep')
    await api.presets.create('我的预设', { chat: { enabled: true, templates: {} } })

    await api.batch.wipeData()

    expect(await api.contacts.list()).toEqual([])
    expect(await api.messages.list()).toEqual([])
    expect(await api.contactSaveSnapshots.list()).toEqual([])
    expect(await api.kv.get('apiKey')).toBe('sk-keep')
    expect((await api.presets.list()).map((preset) => preset.name)).toContain('我的预设')
  })
})

describe('ensureServerPresets factory refresh', () => {
  afterEach(() => resetFakeServer())

  it('seeds the factory preset and records its hash on first run', async () => {
    setFakeServerConfigured(true)
    await ensureServerPresets({ promptPresets: [], promptModules: createDefaultPromptModules() })
    const factory = await api.presets.get(FACTORY_PRESET_NAME)
    expect(factory.isFactory).toBe(true)
    expect(factory.modules).toEqual(createDefaultPromptModules())
    expect(await api.kv.get('factoryPresetHash')).toBeTruthy()
  })

  it('refreshes a stale factory row when the code template hash differs', async () => {
    setFakeServerConfigured(true)
    await api.presets.seedFactory(FACTORY_PRESET_NAME, { outdated: { enabled: true, templates: { t: '旧模板' } } })
    await ensureServerPresets({ promptPresets: [], promptModules: createDefaultPromptModules() })
    const factory = await api.presets.get(FACTORY_PRESET_NAME)
    expect(factory.modules).toEqual(createDefaultPromptModules())
  })

  it('leaves the factory row untouched when the hash still matches', async () => {
    setFakeServerConfigured(true)
    await ensureServerPresets({ promptPresets: [], promptModules: createDefaultPromptModules() })
    const before = await api.presets.get(FACTORY_PRESET_NAME)
    await ensureServerPresets({ promptPresets: [], promptModules: createDefaultPromptModules() })
    const after = await api.presets.get(FACTORY_PRESET_NAME)
    expect(after.updatedAt).toBe(before.updatedAt)
  })
})
