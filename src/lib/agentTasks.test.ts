import { beforeEach, describe, expect, it } from 'vitest'
import { resetFakeServer } from '../test/setup'
import type { Contact } from '../types'
import { api } from './api/resources'
import { createSpecialTask } from './agentTasks'
import { ensureLocationsInitialized } from './locations'

const contact = (): Contact => ({
  id: 'agent', name: '小满', avatar: '🙂', avatarColor: '#ddd', systemPrompt: '自然', createdAt: 1,
  memoryFacts: '', memoryStyle: '', memoryUpdatedAt: 0, memoryMessageCursor: 0,
  relationshipBase: '朋友', relationshipDynamic: '',
  schedule: [{ id: 'work', dayOfWeek: 1, startHour: 14, endHour: 16, phoneAccess: 'unavailable', location: '公司', locationId: 'office-floor', activity: '上班' }],
})

beforeEach(async () => {
  resetFakeServer()
  await ensureLocationsInitialized()
  await api.contacts.put(contact())
})

describe('special task tool', () => {
  it('persists a minute-precision task and records the fully cancelled default task', async () => {
    const now = new Date(2026, 7, 3, 14, 0).getTime()
    const result = await createSpecialTask('agent', {
      startsAt: new Date(2026, 7, 3, 15, 20).getTime(),
      endsAt: new Date(2026, 7, 3, 15, 50).getTime(),
      locationId: 'mall-cafe', activity: '喝咖啡', summary: '和玩家喝半小时咖啡', sourceConversationId: 'conversation',
    }, now)
    expect(result).toMatchObject({ success: true, cancelledDefaultTasks: [{ id: 'work', activity: '上班' }] })
    const stored = (await api.contacts.get('agent'))!.scheduleOverrides![0]
    expect(stored).toMatchObject({ locationId: 'mall-cafe', startsAt: new Date(2026, 7, 3, 15, 20).getTime(), endsAt: new Date(2026, 7, 3, 15, 50).getTime(), cancelledDefaultTaskIds: ['work'], sourceConversationId: 'conversation' })
  })

  it('keeps multiple non-overlapping tasks on the same day', async () => {
    const now = new Date(2026, 7, 3, 8, 0).getTime()
    await createSpecialTask('agent', { startsAt: new Date(2026, 7, 3, 10).getTime(), endsAt: new Date(2026, 7, 3, 10, 30).getTime(), locationId: 'park-lawn', activity: '散步', summary: '去公园散步' }, now)
    await createSpecialTask('agent', { startsAt: new Date(2026, 7, 3, 15).getTime(), endsAt: new Date(2026, 7, 3, 15, 30).getTime(), locationId: 'mall-cafe', activity: '喝咖啡', summary: '去喝咖啡' }, now)
    expect((await api.contacts.get('agent'))!.scheduleOverrides).toHaveLength(2)
  })

  it('immediately updates location and activity when a special task starts now', async () => {
    const now = new Date(2026, 7, 3, 15, 0).getTime()
    const result = await createSpecialTask('agent', { startsAt: now, endsAt: now + 30 * 60_000, locationId: 'mall-cafe', activity: '喝咖啡', summary: '去咖啡店喝咖啡' }, now)
    expect(result.success).toBe(true)
    expect(await api.contacts.get('agent')).toMatchObject({ currentLocationId: 'mall-cafe', locationSource: 'specialTask', currentTaskKind: 'special', currentActivity: '喝咖啡' })
  })
})
