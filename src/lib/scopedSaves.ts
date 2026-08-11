import { v4 as uuid } from 'uuid'
import { api } from './api/resources'
import { getOrUndef } from './api/client'
import { invalidate } from './api/keys'
import type { Contact, ContactSaveSnapshotData, ContactStoryline, GlobalSaveSnapshot } from '../types'
import { resetAllChatTurns } from './chatEngine'
import { resetAllGroupChatTurns } from './groupChatEngine'

const now = () => Date.now()

function defaultStorylineName(worldName?: string) {
  return worldName ? `${worldName}剧情线` : '默认剧情线'
}

function invalidateSaves() { invalidate('contactStorylines', 'contactSaveSnapshots', 'globalSaveSnapshots') }

export async function ensureActiveStoryline(contact: Contact, worldName?: string): Promise<ContactStoryline> {
  const existing = (await api.contactStorylines.list({ contactId: contact.id })).find((line) => line.active)
  if (existing) return existing
  const createdAt = now()
  const line: ContactStoryline = {
    id: uuid(), contactId: contact.id, worldviewId: contact.worldviewId,
    name: defaultStorylineName(worldName), active: true, createdAt, updatedAt: createdAt,
  }
  await api.contactStorylines.put(line)
  invalidate('contactStorylines')
  return line
}

async function captureContact(contact: Contact): Promise<ContactSaveSnapshotData> {
  const conversation = (await api.conversations.list({ contactId: contact.id }))[0]
  const [messages, memories, mediaAssets] = await Promise.all([
    conversation ? api.messages.list({ conversationId: conversation.id }) : Promise.resolve([]),
    api.contactMemories.list({ contactId: contact.id }),
    conversation ? api.mediaAssets.list({ conversationId: conversation.id }) : Promise.resolve([]),
  ])
  return { contact: structuredClone(contact), conversation: conversation ? structuredClone(conversation) : undefined, messages: structuredClone(messages), memories: structuredClone(memories), mediaAssets: structuredClone(mediaAssets) }
}

export async function createContactSave(contact: Contact, options: { name: string; kind: 'manual' | 'automatic'; storyline?: ContactStoryline }) {
  const storyline = options.storyline ?? await ensureActiveStoryline(contact)
  const snapshot = await captureContact(contact)
  const createdAt = now()
  await api.contactSaveSnapshots.put({ id: uuid(), contactId: contact.id, storylineId: storyline.id, name: options.name.trim() || '未命名存档', kind: options.kind, createdAt, snapshot })
  await api.contactStorylines.patch(storyline.id, { updatedAt: createdAt })
  invalidateSaves()
}

export async function restoreContactSave(snapshotId: string) {
  resetAllChatTurns()
  await api.saves.restoreContact(snapshotId)
  invalidateAll0()
}

function invalidateAll0() { invalidate('contacts', 'conversations', 'messages', 'contactMemories', 'mediaAssets', 'contactStorylines') }

/** Protect the old story, then start a clean branch in the selected world. */
export async function switchContactWorldview(contact: Contact, nextWorldviewId: string, nextWorldName: string) {
  const oldLine = await ensureActiveStoryline(contact)
  await createContactSave(contact, { storyline: oldLine, kind: 'automatic', name: '切换世界观前' })
  await api.saves.switchWorldview(contact.id, nextWorldviewId, nextWorldName)
  invalidateAll0()
}

export async function createWorldbookSave(resourceId: string, name: string, kind: GlobalSaveSnapshot['kind'] = 'manual') {
  const collection = await getOrUndef(api.worldbookCollections.get(resourceId))
  if (!collection) throw new Error('世界书不存在')
  const entries = await api.worldbookEntries.list({ collectionId: resourceId })
  await api.globalSaveSnapshots.put({ id: uuid(), resourceType: 'worldbook', resourceId, name: name.trim() || '世界书存档', kind, createdAt: now(), snapshot: { collection: structuredClone(collection), entries: structuredClone(entries) } })
  invalidate('globalSaveSnapshots')
}

export async function restoreWorldbookSave(snapshotId: string) {
  await api.saves.restoreGlobal(snapshotId)
  invalidate('worldbookCollections', 'worldbookEntries')
}

export async function createMapSave(name: string, kind: GlobalSaveSnapshot['kind'] = 'manual') {
  const [map, locations, state, edges] = await Promise.all([getOrUndef(api.worldMaps.get('active')), api.locations.list(), getOrUndef(api.locationModuleState.get('active')), api.acousticEdges.list()])
  if (!map) throw new Error('当前还没有地图')
  await api.globalSaveSnapshots.put({ id: uuid(), resourceType: 'map', resourceId: 'active', name: name.trim() || '地图存档', kind, createdAt: now(), snapshot: structuredClone({ map, locations, state, edges }) })
  invalidate('globalSaveSnapshots')
}

export async function restoreMapSave(snapshotId: string) {
  resetAllGroupChatTurns()
  await api.saves.restoreGlobal(snapshotId)
  invalidate('worldMaps', 'locations', 'locationModuleState', 'acousticEdges')
}

export async function deleteScopedSave(id: string, scope: 'contact' | 'global') {
  if (scope === 'contact') await api.contactSaveSnapshots.delete(id)
  else await api.globalSaveSnapshots.delete(id)
  invalidateSaves()
}
