import { beforeEach, describe, expect, it } from 'vitest'
import { resetFakeServer } from '../test/setup'
import { api } from './api/resources'
import {
  createContactSave, createMapSave, createWorldbookSave, deleteScopedSave,
  ensureActiveStoryline, restoreContactSave, restoreMapSave, restoreWorldbookSave, switchContactWorldview,
} from './scopedSaves'
import type { Contact, WorldbookCollection } from '../types'

const contact = (id: string, worldviewId?: string): Contact => ({
  id, name: id, avatar: '🙂', avatarColor: '#ddd', systemPrompt: '自然', createdAt: 1,
  memoryFacts: '', memoryStyle: '', memoryUpdatedAt: 0, memoryMessageCursor: 0,
  relationshipBase: '朋友', relationshipDynamic: '', worldviewId,
})

beforeEach(() => {
  localStorage.clear()
  resetFakeServer()
})

describe('scoped saves', () => {
  it('creates one active storyline per contact and reuses it', async () => {
    const c = contact('c1')
    await api.contacts.put(c)
    const first = await ensureActiveStoryline(c)
    const second = await ensureActiveStoryline(c)
    expect(second.id).toBe(first.id)
    expect((await api.contactStorylines.list({ contactId: 'c1' })).length).toBe(1)
  })

  it('rolls a contact back to a snapshot without touching other contacts', async () => {
    const c = contact('c1')
    await api.contacts.put(c)
    await api.conversations.put({ id: 'conv1', contactId: 'c1', pinned: false, createdAt: 1, updatedAt: 1 })
    await api.messages.put({ id: 'm1', conversationId: 'conv1', role: 'user', type: 'text', content: '早期的话', createdAt: 1 })
    await api.contactMemories.put({ id: 'mem1', contactId: 'c1', scope: 'private', category: '基础信息', kind: 'general', content: '旧记忆', importance: 0.5, emotionalWeight: 0.3, confidence: 1, createdAt: 1, updatedAt: 1, usageCount: 0, tags: [], relatedContactIds: [], sourceMessageIds: [] })
    await createContactSave(c, { name: '存档A', kind: 'manual' })

    // Time passes: new message and memory.
    await api.messages.put({ id: 'm2', conversationId: 'conv1', role: 'user', type: 'text', content: '后来的话', createdAt: 2 })
    await api.contactMemories.put({ id: 'mem2', contactId: 'c1', scope: 'private', category: '基础信息', kind: 'general', content: '新记忆', importance: 0.5, emotionalWeight: 0.3, confidence: 1, createdAt: 2, updatedAt: 2, usageCount: 0, tags: [], relatedContactIds: [], sourceMessageIds: [] })
    const saveId = (await api.contactSaveSnapshots.list({ contactId: 'c1' }))[0].id

    await restoreContactSave(saveId)

    const messages = await api.messages.list({ conversationId: 'conv1' })
    expect(messages.map((m) => m.id)).toEqual(['m1'])
    const memories = await api.contactMemories.list({ contactId: 'c1' })
    expect(memories.map((m) => m.id)).toEqual(['mem1'])
  })

  it('switching worldview protects the old branch and starts clean', async () => {
    const c = contact('c1', 'world-old')
    await api.contacts.put(c)
    await api.conversations.put({ id: 'conv1', contactId: 'c1', pinned: false, createdAt: 1, updatedAt: 1 })
    await api.messages.put({ id: 'm1', conversationId: 'conv1', role: 'user', type: 'text', content: '旧世界的话', createdAt: 1 })

    await switchContactWorldview(c, 'world-new', '新世界')

    const lines = await api.contactStorylines.list({ contactId: 'c1' })
    expect(lines.length).toBe(2)
    expect(lines.find((line) => line.active)?.worldviewId).toBe('world-new')
    expect((await api.messages.list({ conversationId: 'conv1' })).length).toBe(0)
    expect((await getOrUndefContacts('c1'))?.worldviewId).toBe('world-new')
    // The old branch's save holds the pre-switch messages.
    const saves = await api.contactSaveSnapshots.list({ contactId: 'c1' })
    expect(saves.length).toBe(1)
    expect(saves[0].snapshot.messages.map((m) => m.id)).toEqual(['m1'])
  })

  it('round-trips a worldbook snapshot', async () => {
    const collection: WorldbookCollection = { id: 'wb1', name: '设定集', enabled: true, sourceType: 'manual', createdAt: 1, updatedAt: 1 }
    await api.worldbookCollections.put(collection)
    await api.worldbookEntries.put({ id: 'e1', collectionId: 'wb1', title: '条目一', content: '原始内容', enabled: true, priority: 1, keywords: [], createdAt: 1, updatedAt: 1 })
    await createWorldbookSave('wb1', '版本1')

    await api.worldbookEntries.put({ id: 'e1', collectionId: 'wb1', title: '条目一', content: '改过的内容', enabled: true, priority: 1, keywords: [], createdAt: 1, updatedAt: 2 })
    const saveId = (await api.globalSaveSnapshots.list({ resourceType: 'worldbook' }))[0].id
    await restoreWorldbookSave(saveId)

    const entry = (await api.worldbookEntries.list({ collectionId: 'wb1' }))[0]
    expect(entry.content).toBe('原始内容')
  })

  it('rejects restoring a map save when no map exists, and round-trips when one does', async () => {
    await expect(createMapSave('地图存档')).rejects.toThrow('当前还没有地图')
    await api.worldMaps.put({ id: 'active', width: 10, height: 10, seed: 's1', generatorVersion: 1, mode: 'fixed', tiles: [], createdAt: 1, updatedAt: 1 })
    await api.locations.put({ id: 'loc1', name: '广场', kind: 'building', description: '', access: 'public', sortOrder: 0, createdAt: 1, updatedAt: 1 })
    await createMapSave('版本1')
    await api.locations.delete('loc1')

    const saveId = (await api.globalSaveSnapshots.list({ resourceType: 'map' }))[0].id
    await restoreMapSave(saveId)
    expect((await api.locations.list()).map((l) => l.id)).toEqual(['loc1'])
  })

  it('deletes saves and cascades them with the contact', async () => {
    const c = contact('c1')
    await api.contacts.put(c)
    await createContactSave(c, { name: '存档A', kind: 'manual' })
    const saveId = (await api.contactSaveSnapshots.list({ contactId: 'c1' }))[0].id

    await deleteScopedSave(saveId, 'contact')
    expect((await api.contactSaveSnapshots.list({ contactId: 'c1' })).length).toBe(0)

    await createContactSave(c, { name: '存档B', kind: 'manual' })
    await api.batch.deleteContact('c1')
    expect((await api.contactSaveSnapshots.list({ contactId: 'c1' })).length).toBe(0)
    expect((await api.contactStorylines.list({ contactId: 'c1' })).length).toBe(0)
  })
})

async function getOrUndefContacts(id: string) {
  const { getOrUndef } = await import('./api/client')
  return getOrUndef(api.contacts.get(id))
}
