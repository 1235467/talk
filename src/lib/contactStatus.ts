import { describeCurrentSchedule } from './schedule'
import { normalizeMood } from './mood'
import type { Contact } from '../types'

function activeMood(contact: Contact, now: number): string {
  if (!contact.mood?.text) return ''
  if (now > contact.mood.expiresAt) return ''
  return normalizeMood(contact.mood.text)
}

function compactSchedule(contact: Contact, now: Date): string {
  const text = describeCurrentSchedule(contact, now)
  return text.replace(/^现在/, '').trim()
}

export async function buildPrivateStatusLine(contact: Contact, now = new Date()): Promise<string> {
  const parts: string[] = []
  const mood = activeMood(contact, now.getTime())
  if (mood) parts.push(mood)
  const schedule = compactSchedule(contact, now)
  parts.push(schedule || '空闲')
  return parts.join(' · ')
}
