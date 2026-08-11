import { v4 as uuid } from 'uuid'
import type { Contact, ContactRuntimeSnapshot, InternalTask } from '../types'
import { createSpecialTask, type CreateSpecialTaskInput } from './agentTasks'
import { syncContactLocationAt } from './locations'
import { api } from './api/resources'
import { getOrUndef } from './api/client'
import { invalidate } from './api/keys'

function runtimeOf(contact: Contact): ContactRuntimeSnapshot {
  return {
    currentLocationId: contact.currentLocationId,
    locationSource: contact.locationSource,
    currentTaskId: contact.currentTaskId,
    currentTaskKind: contact.currentTaskKind,
    currentActivity: contact.currentActivity,
  }
}

function clock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export async function createScheduleInternalTask(contactId: string, conversationId: string, input: CreateSpecialTaskInput, now = Date.now()) {
  const before = await getOrUndef(api.contacts.get(contactId))
  if (!before) throw new Error('联系人不存在')
  const result = await createSpecialTask(contactId, input, now)
  if (!result.success) return result
  const after = await getOrUndef(api.contacts.get(contactId))
  const task: InternalTask = {
    id: uuid(), kind: 'schedule_arrangement', status: 'active', contactId, conversationId, createdAt: now,
    effects: [
      { type: 'schedule_override_created', override: result.task },
      { type: 'special_tasks_replaced', overrides: result.replacedSpecialTasks },
      { type: 'contact_runtime_changed', before: runtimeOf(before), after: runtimeOf(after ?? before) },
    ],
    presentation: {
      title: '安排已更新', date: result.task.date, startTime: clock(result.task.startsAt ?? now), endTime: clock(result.task.endsAt ?? now),
      activity: result.task.activity, locationId: result.task.locationId ?? input.locationId, locationName: result.task.location,
      previousLocationName: undefined,
      changedSections: ['schedule', ...(before.currentLocationId !== after?.currentLocationId ? ['location' as const] : [])],
      cancelledDefaultActivities: result.cancelledDefaultTasks.map((item) => item.activity),
    },
  }
  await api.internalTasks.put(task)
  invalidate('internalTasks')
  return { ...result, internalTask: task }
}

export async function revertInternalTask(taskId: string) {
  const record = await getOrUndef(api.internalTasks.get(taskId))
  if (!record) throw new Error('该安排记录不存在')
  if (record.status === 'reverted') return record
  const created = record.effects.find((effect) => effect.type === 'schedule_override_created')
  const replaced = record.effects.find((effect) => effect.type === 'special_tasks_replaced')
  if (!created || created.type !== 'schedule_override_created') throw new Error('该任务不支持撤销')
  {
    const contact = await getOrUndef(api.contacts.get(record.contactId))
    if (!contact) throw new Error('联系人不存在')
    const remaining = (contact.scheduleOverrides ?? []).filter((item) => item.id !== created.override.id)
    const restored = replaced?.type === 'special_tasks_replaced' ? replaced.overrides : []
    const ids = new Set(remaining.map((item) => item.id))
    await api.contacts.patch(contact.id, { scheduleOverrides: [...remaining, ...restored.filter((item) => !ids.has(item.id))] })
    await api.internalTasks.patch(taskId, { status: 'reverted', revertedAt: Date.now() })
    invalidate('internalTasks', 'contacts')
  }
  await syncContactLocationAt(record.contactId)
  return (await api.internalTasks.get(taskId))!
}
