import { describe, expect, it } from 'vitest'
import type { Contact, ScheduleOverride } from '../types'
import { describeCurrentSchedule, describeUpcomingScheduleText, resolveActiveTask } from './schedule'

const contact = (overrides: ScheduleOverride[] = []): Contact => ({
  id: 'contact', name: '小满', avatar: '🙂', avatarColor: '#ddd', systemPrompt: '自然', createdAt: 1,
  memoryFacts: '', memoryStyle: '', memoryUpdatedAt: 0, memoryMessageCursor: 0,
  relationshipBase: '朋友', relationshipDynamic: '',
  schedule: [{ id: 'work', dayOfWeek: 1, startHour: 14, endHour: 16, phoneAccess: 'unavailable', location: '公司', locationId: 'office-floor', activity: '上班' }],
  scheduleOverrides: overrides,
})

const special = (): ScheduleOverride => ({
  id: 'coffee', date: '2026-08-03', startHour: 15, endHour: 16,
  startsAt: new Date(2026, 7, 3, 15, 0).getTime(), endsAt: new Date(2026, 7, 3, 15, 30).getTime(),
  phoneAccess: 'available', location: '咖啡店', locationId: 'mall-cafe', activity: '喝咖啡', summary: '和玩家喝半小时咖啡', priority: 'special', createdAt: 1,
})

describe('AI task schedule', () => {
  it('cancels the whole overlapping default task occurrence', () => {
    const value = contact([special()])
    expect(resolveActiveTask(value, new Date(2026, 7, 3, 14, 30))).toBeUndefined()
    expect(resolveActiveTask(value, new Date(2026, 7, 3, 15, 10))).toMatchObject({ kind: 'special', task: { id: 'coffee' } })
    expect(resolveActiveTask(value, new Date(2026, 7, 3, 15, 45))).toBeUndefined()
  })

  it('keeps the recurring default task on another week', () => {
    expect(resolveActiveTask(contact([special()]), new Date(2026, 7, 10, 14, 30))).toMatchObject({ kind: 'default', task: { id: 'work' } })
  })

  it('reports the active special task as the current activity', () => {
    expect(describeCurrentSchedule(contact([special()]), new Date(2026, 7, 3, 15, 10))).toBe('现在在喝咖啡（特殊任务）')
  })

  it('shows recurring tasks beyond three days with their exact date', () => {
    const value = contact()
    value.schedule = [{ id: 'shop', dayOfWeek: 5, startHour: 16, endHour: 18, phoneAccess: 'available', location: '宠物店', locationId: 'mall-shop', activity: '给宠物买用品' }]
    const text = describeUpcomingScheduleText(value, new Date(2026, 7, 2, 19, 0))
    expect(text).toContain('周五(2026-08-07)')
    expect(text).toContain('16-18点:给宠物买用品')
  })
})
