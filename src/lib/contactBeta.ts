import Dexie from 'dexie'
import { db, TalkDB } from '../db/db'

const STORAGE_KEY = 'talk-contact-beta-session'

export interface ContactBetaSession {
  contactId: string
  branchDbName: string
  startedAt: number
  virtualNow: number
}

export function getContactBetaSession(): ContactBetaSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as ContactBetaSession
    return value.contactId && value.branchDbName && Number.isFinite(value.virtualNow) ? value : null
  } catch { return null }
}

export function betaNow(contactId?: string): number {
  const session = getContactBetaSession()
  return session && (!contactId || session.contactId === contactId) ? session.virtualNow : Date.now()
}

async function cloneDatabase(source: TalkDB, destination: TalkDB) {
  await source.open()
  await destination.open()
  for (const table of source.tables) {
    const rows = await source.table(table.name).toArray()
    if (rows.length) await destination.table(table.name).bulkPut(rows)
  }
}

export async function enableContactBeta(contactId: string): Promise<void> {
  if (getContactBetaSession()) throw new Error('当前已有联系人处于 Beta 模式')
  const now = Date.now()
  const branchDbName = `talk-db-beta-${contactId}-${now}`
  const branch = new TalkDB(branchDbName)
  try {
    await cloneDatabase(db, branch)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ contactId, branchDbName, startedAt: now, virtualNow: now } satisfies ContactBetaSession))
  } catch (error) {
    branch.close()
    await Dexie.delete(branchDbName)
    throw error
  }
  branch.close()
  window.location.reload()
}

export function shiftContactBeta(contactId: string, deltaMs: number): ContactBetaSession {
  const session = getContactBetaSession()
  if (!session || session.contactId !== contactId) throw new Error('该联系人未开启 Beta 模式')
  const virtualNow = Math.max(session.startedAt, session.virtualNow + deltaMs)
  const next = { ...session, virtualNow }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('talk:contact-beta-time', { detail: next }))
  return next
}

export function resetContactBetaTime(contactId: string): ContactBetaSession {
  const session = getContactBetaSession()
  if (!session || session.contactId !== contactId) throw new Error('该联系人未开启 Beta 模式')
  const next = { ...session, virtualNow: session.startedAt }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('talk:contact-beta-time', { detail: next }))
  return next
}

export async function disableContactBeta(contactId: string): Promise<void> {
  const session = getContactBetaSession()
  if (!session || session.contactId !== contactId) return
  localStorage.removeItem(STORAGE_KEY)
  db.close()
  await Dexie.delete(session.branchDbName)
  window.location.reload()
}

export async function canMoveContactBetaTo(contactId: string, target: number): Promise<boolean> {
  const session = getContactBetaSession()
  if (!session || session.contactId !== contactId) return false
  const conversation = await db.conversations.where('contactId').equals(contactId).first()
  const [messages, experiences, moments] = await Promise.all([
    conversation ? db.messages.where('conversationId').equals(conversation.id).filter((row) => row.createdAt >= session.startedAt && row.createdAt > target).count() : 0,
    db.contactExperiences.where('contactIds').equals(contactId).filter((row) => row.createdAt >= session.startedAt && row.createdAt > target).count(),
    db.moments.where('contactId').equals(contactId).filter((row) => row.createdAt >= session.startedAt && row.createdAt > target).count(),
  ])
  return messages + experiences + moments === 0
}

/** Discards the current branch and creates a clean branch from untouched production data at the original frozen instant. */
export async function restartContactBeta(contactId: string): Promise<void> {
  const session = getContactBetaSession()
  if (!session || session.contactId !== contactId) return
  const nextName = `talk-db-beta-${contactId}-${Date.now()}`
  const production = new TalkDB('talk-db')
  const nextBranch = new TalkDB(nextName)
  await cloneDatabase(production, nextBranch)
  production.close()
  nextBranch.close()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...session, branchDbName: nextName, virtualNow: session.startedAt }))
  db.close()
  await Dexie.delete(session.branchDbName)
  window.location.reload()
}
