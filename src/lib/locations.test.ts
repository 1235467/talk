import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import type { Contact } from '../types'
import { createDefaultPromptModules } from './promptModules'
import { buildGroupRawChatPrompt, buildLocationRawChatPrompt } from './groupChat'
import { sendGroupMessage } from './groupChatEngine'
import { useSettingsStore } from '../store/useSettingsStore'
import {
  enterLocation,
  ensureLocationsInitialized,
  LOCATION_CONVERSATION_ID,
  LOCATION_GROUP_ID,
  mapNaturalLocation,
  resolveContactLocationAt,
  resolveLocationParticipants,
} from './locations'

const contact = (id: string, patch: Partial<Contact> = {}): Contact => ({
  id, name: id, avatar: '🙂', avatarColor: '#ddd', systemPrompt: '自然', createdAt: 1,
  memoryFacts: '', memoryStyle: '', memoryUpdatedAt: 0, memoryMessageCursor: 0,
  relationshipBase: '朋友', relationshipDynamic: '', ...patch,
})

async function clearDatabase() {
  await db.open()
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
  })
}

beforeEach(clearDatabase)

describe('location runtime', () => {
  it('resolves the same contact and real-time slot to a stable location', async () => {
    await ensureLocationsInitialized()
    const ids = new Set((await db.locations.toArray()).filter((item) => !['city', 'home', 'school', 'office', 'mall', 'hospital', 'park', 'beach', 'mountain', 'farm'].includes(item.id)).map((item) => item.id))
    const now = new Date(2026, 6, 28, 14, 15)
    const a = resolveContactLocationAt(contact('stable'), now, ids)
    const b = resolveContactLocationAt(contact('stable'), new Date(2026, 6, 28, 14, 59), ids)
    expect(a).toEqual(b)
  })

  it('prefers schedule locationId over natural-language mapping', async () => {
    await ensureLocationsInitialized()
    const ids = new Set((await db.locations.toArray()).map((item) => item.id))
    const now = new Date(2026, 6, 27, 10)
    const result = resolveContactLocationAt(contact('scheduled', { schedule: [{ id: 'work', dayOfWeek: 1, startHour: 9, endHour: 18, phoneAccess: 'available', location: '学校教室', locationId: 'mall-cafe', activity: '上班' }] }), now, ids)
    expect(result).toEqual({ locationId: 'mall-cafe', source: 'schedule' })
  })

  it('maps legacy natural-language locations deterministically', async () => {
    await ensureLocationsInitialized()
    const ids = new Set((await db.locations.toArray()).map((item) => item.id))
    expect(mapNaturalLocation('公司上班', 'a', 'slot', ids)).toMatch(/^office-/)
    expect(mapNaturalLocation('在咖啡店见面', 'a', 'slot', ids)).toBe('mall-cafe')
    expect(mapNaturalLocation('教室上课', 'a', 'slot', ids)).toBe('school-classroom')
  })

  it('resolves here, clear, muffled and none without admitting away contacts', async () => {
    await ensureLocationsInitialized()
    await db.contacts.bulkAdd([
      contact('here', { currentLocationId: 'mall-cafe', locationSource: 'manual' }),
      contact('clear', { currentLocationId: 'mall-atrium', locationSource: 'manual' }),
      contact('muffled', { currentLocationId: 'mall-shop', locationSource: 'manual' }),
      contact('away', { currentLocationId: 'hospital-clinic', locationSource: 'manual' }),
    ])
    await db.acousticEdges.put({ id: 'explicit-none', fromLocationId: 'mall-cafe', toLocationId: 'hospital-clinic', audibility: 'none', bidirectional: true })
    const result = await resolveLocationParticipants('mall-cafe')
    expect(result.here.map((item) => item.id)).toEqual(['here'])
    expect(result.audible).toEqual(expect.arrayContaining([
      expect.objectContaining({ contact: expect.objectContaining({ id: 'clear' }), audibility: 'clear' }),
      expect.objectContaining({ contact: expect.objectContaining({ id: 'muffled' }), audibility: 'muffled' }),
    ]))
    expect(result.away.map((item) => item.id)).toContain('away')
    expect(result.activeMembers.map((item) => item.id)).not.toContain('away')
  })

  it('preserves Talk group settings while switching and caches only dynamic participants', async () => {
    await db.contacts.add(contact('member-1', { currentLocationId: 'mall-cafe', locationSource: 'manual' }))
    await ensureLocationsInitialized()
    await enterLocation('mall-atrium')
    await db.groups.update(LOCATION_GROUP_ID, { energyLevel: 'lively', speakerLimit: 2 })
    await enterLocation('park-lawn')
    const [group, conversation, state] = await Promise.all([db.groups.get(LOCATION_GROUP_ID), db.conversations.get(LOCATION_CONVERSATION_ID), db.locationModuleState.get('active')])
    expect(group?.locationId).toBe('park-lawn')
    expect(group?.memberContactIds).toEqual([])
    expect(group?.energyLevel).toBe('lively')
    expect(group?.speakerLimit).toBe(2)
    expect(conversation).toMatchObject({ systemPinned: true, pinned: true })
    expect(state?.currentLocationId).toBe('park-lawn')
  })

  it('keeps a user message but generates no reply when nobody can hear it', async () => {
    await ensureLocationsInitialized()
    await enterLocation('park-lawn')
    const group = await db.groups.get(LOCATION_GROUP_ID)
    expect(group).toBeTruthy()
    await sendGroupMessage(LOCATION_CONVERSATION_ID, group!, [], { ...useSettingsStore.getState(), apiKey: '' }, [], '有人吗？')
    const messages = await db.messages.where('conversationId').equals(LOCATION_CONVERSATION_ID).toArray()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'user', content: '有人吗？' })
  })
})

describe('location prompt', () => {
  const member = contact('小满')
  const base = {
    stylePrompt: '自然说话', groupName: '咖啡店', allMembers: [member], speakers: [member], stickerNames: [],
    currentTimeText: '2026年7月28日 星期二 14:30', userProfileText: '昵称：我', enabledModules: ['location'],
    promptModules: createDefaultPromptModules(),
  }

  it('uses a distinct offline template while preserving ordinary group semantics', () => {
    const ordinary = buildGroupRawChatPrompt(base)
    const scene = buildLocationRawChatPrompt({ ...base, locationContextText: '当前地点：咖啡店\n现实季节：夏季\n小满：here' })
    expect(ordinary).toContain('这是微信群')
    expect(scene).not.toContain('这是微信群')
    expect(scene).toContain('线下多人对话')
    expect(scene).toContain('2026年7月28日')
    expect(scene).toContain('夏季')
    expect(scene).toContain('小满：here')
  })
})
