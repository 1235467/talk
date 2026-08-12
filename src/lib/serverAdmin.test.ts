import { afterEach, describe, expect, it } from 'vitest'
import { resetFakeServer } from '../test/setup'
import { api } from './api/resources'

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
