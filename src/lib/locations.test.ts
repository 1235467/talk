import { beforeEach, describe, expect, it } from 'vitest'
import { resetFakeServer } from '../test/setup'
import type { Contact } from '../types'
import { api } from './api/resources'
import { getOrUndef } from './api/client'
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
  resolveContactRuntimeAt,
  resolveLocationParticipants,
  syncContactLocationAt,
} from './locations'

const contact = (id: string, patch: Partial<Contact> = {}): Contact => ({
  id, name: id, avatar: '🙂', avatarColor: '#ddd', systemPrompt: '自然', createdAt: 1,
  memoryFacts: '', memoryStyle: '', memoryUpdatedAt: 0, memoryMessageCursor: 0,
  relationshipBase: '朋友', relationshipDynamic: '', ...patch,
})

beforeEach(() => {
  resetFakeServer()
})

describe('location runtime', () => {
  it('creates a large city, names the user home, and keeps fallback NPCs out of it', async () => {
    useSettingsStore.getState().setSettings({ userNickname: '小河' })
    await ensureLocationsInitialized()
    const [map, home, locations] = await Promise.all([getOrUndef(api.worldMaps.get('active')), getOrUndef(api.locations.get('home')), api.locations.list()])
    expect(map).toMatchObject({ width: 48, height: 48, generatorVersion: 4 })
    expect(home?.name).toBe('小河的家')
    const leafIds = new Set(locations.filter((item) => !locations.some((candidate) => candidate.parentId === item.id)).map((item) => item.id))
    const resolved = resolveContactLocationAt(contact('ordinary-npc'), new Date(2026, 6, 28, 22), leafIds)
    expect(resolved.locationId).not.toMatch(/^home-/)
  })

  it('resolves the same contact and real-time slot to a stable location', async () => {
    await ensureLocationsInitialized()
    const ids = new Set((await api.locations.list()).filter((item) => !['city', 'home', 'school', 'office', 'mall', 'hospital', 'park', 'beach', 'mountain', 'farm'].includes(item.id)).map((item) => item.id))
    const now = new Date(2026, 6, 28, 14, 15)
    const a = resolveContactLocationAt(contact('stable'), now, ids)
    const b = resolveContactLocationAt(contact('stable'), new Date(2026, 6, 28, 14, 59), ids)
    expect(a).toEqual(b)
  })

  it('prefers schedule locationId over natural-language mapping', async () => {
    await ensureLocationsInitialized()
    const ids = new Set((await api.locations.list()).map((item) => item.id))
    const now = new Date(2026, 6, 27, 10)
    const result = resolveContactLocationAt(contact('scheduled', { schedule: [{ id: 'work', dayOfWeek: 1, startHour: 9, endHour: 18, phoneAccess: 'available', location: '学校教室', locationId: 'mall-cafe', activity: '上班' }] }), now, ids)
    expect(result).toEqual({ locationId: 'mall-cafe', source: 'schedule' })
  })

  it('synchronizes an isolated AI-test contact when a special task is active', async () => {
    await ensureLocationsInitialized()
    const now = new Date(2026, 6, 27, 10, 30)
    await api.contacts.put(contact('ai-test-contact-location', {
      currentLocationId: 'park-lawn',
      locationSource: 'fallback',
      scheduleOverrides: [{
        id: 'special', date: '2026-07-27', startHour: 10, endHour: 11,
        startsAt: new Date(2026, 6, 27, 10).getTime(), endsAt: new Date(2026, 6, 27, 11).getTime(),
        phoneAccess: 'available', location: '咖啡店', locationId: 'mall-cafe', activity: '见面', summary: '去咖啡店见面',
        priority: 'special', status: 'scheduled', createdAt: now.getTime() - 1000,
      }],
    }))

    expect(await syncContactLocationAt('ai-test-contact-location', now)).toBe(true)
    expect(await api.contacts.get('ai-test-contact-location')).toMatchObject({
      currentLocationId: 'mall-cafe', locationSource: 'specialTask', currentTaskId: 'special', currentTaskKind: 'special', currentActivity: '见面',
    })
  })

  it('resolves a future special task to its scheduled destination without moving there early', async () => {
    await ensureLocationsInitialized()
    const locations = await api.locations.list()
    const leafIds = new Set(locations.filter((item) => !locations.some((candidate) => candidate.parentId === item.id)).map((item) => item.id))
    const startsAt = new Date(2026, 7, 8, 10).getTime()
    const scheduled = contact('future-task', {
      currentLocationId: 'park-lawn', locationSource: 'fallback',
      scheduleOverrides: [{
        id: 'future', date: '2026-08-08', startHour: 10, endHour: 11, startsAt, endsAt: startsAt + 60 * 60_000,
        phoneAccess: 'available', location: '滨河步道', locationId: 'park-riverside', activity: '跑步', summary: '去滨河步道跑步',
        priority: 'special', status: 'scheduled', createdAt: 1,
      }],
    })

    expect(resolveContactRuntimeAt(scheduled, new Date(2026, 7, 2, 19), leafIds).locationId).toBe('park-lawn')
    expect(resolveContactRuntimeAt(scheduled, new Date(startsAt), leafIds)).toMatchObject({ locationId: 'park-riverside', source: 'specialTask', taskId: 'future' })
  })

  it('maps legacy natural-language locations deterministically', async () => {
    await ensureLocationsInitialized()
    const ids = new Set((await api.locations.list()).map((item) => item.id))
    expect(mapNaturalLocation('公司上班', 'a', 'slot', ids)).toMatch(/^office-/)
    expect(mapNaturalLocation('在咖啡店见面', 'a', 'slot', ids)).toBe('mall-cafe')
    expect(mapNaturalLocation('教室上课', 'a', 'slot', ids)).toBe('school-classroom')
  })

  it('resolves here, clear, muffled and none without admitting away contacts', async () => {
    await ensureLocationsInitialized()
    await api.contacts.bulkPut([
      contact('here', { currentLocationId: 'mall-cafe', locationSource: 'manual' }),
      contact('clear', { currentLocationId: 'mall-atrium', locationSource: 'manual' }),
      contact('muffled', { currentLocationId: 'mall-shop', locationSource: 'manual' }),
      contact('away', { currentLocationId: 'hospital-clinic', locationSource: 'manual' }),
    ])
    await api.acousticEdges.put({ id: 'explicit-none', fromLocationId: 'mall-cafe', toLocationId: 'hospital-clinic', audibility: 'none', bidirectional: true })
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
    await api.contacts.put(contact('member-1', { currentLocationId: 'mall-cafe', locationSource: 'manual' }))
    await ensureLocationsInitialized()
    await enterLocation('mall-atrium')
    await api.groups.patch(LOCATION_GROUP_ID, { energyLevel: 'lively', speakerLimit: 2 })
    await enterLocation('park-lawn')
    const [group, conversation, state] = await Promise.all([getOrUndef(api.groups.get(LOCATION_GROUP_ID)), getOrUndef(api.conversations.get(LOCATION_CONVERSATION_ID)), getOrUndef(api.locationModuleState.get('active'))])
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
    const group = await api.groups.get(LOCATION_GROUP_ID)
    expect(group).toBeTruthy()
    await sendGroupMessage(LOCATION_CONVERSATION_ID, group!, [], { ...useSettingsStore.getState(), apiKey: '' }, [], '有人吗？')
    const messages = await api.messages.list({ conversationId: LOCATION_CONVERSATION_ID })
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
