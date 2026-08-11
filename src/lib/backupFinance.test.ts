import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { resetFakeServer } from '../test/setup'
import { useSettingsStore } from '../store/useSettingsStore'
import type { Contact } from '../types'
import { api } from './api/resources'
import { getOrUndef } from './api/client'
import { BACKUP_TABLES, createBackup, restoreBackup, type TalkBackup } from './backup'
import { getBalance, transferFunds, USER_WALLET_ID } from './finance'

function restorable(backup: TalkBackup): TalkBackup {
  for (const name of BACKUP_TABLES) backup.tables[name] ??= []
  return backup
}

const contact = (id: string): Contact => ({
  id, name: id, avatar: '🙂', avatarColor: '#ddd', systemPrompt: '自然', createdAt: 1,
  memoryFacts: '', memoryStyle: '', memoryUpdatedAt: 0, memoryMessageCursor: 0,
  relationshipBase: '朋友', relationshipDynamic: '',
})

beforeEach(async () => {
  localStorage.clear()
  useSettingsStore.setState({ walletBalance: 100, walletMigrated: true, userNickname: '测试用户' })
  resetFakeServer()
  await Promise.all([db.walletAccounts.clear(), db.walletTransactions.clear()])
})

describe('wallet backup and save slots', () => {
  it('never writes API credentials into a backup', async () => {
    const current = useSettingsStore.getState()
    const backup = await createBackup({
      ...current,
      apiKey: 'chat-secret',
      tavilyApiKey: 'search-secret',
      imageProviders: { ...current.imageProviders, atlas: { ...current.imageProviders.atlas, apiKey: 'atlas-secret' } },
    })
    const serialized = JSON.stringify(backup)
    expect(serialized).not.toContain('chat-secret')
    expect(serialized).not.toContain('search-secret')
    expect(serialized).not.toContain('atlas-secret')
  })

  it('round-trips server-side data through a backup without touching local wallet accounts', async () => {
    await db.walletAccounts.put({ ownerId: USER_WALLET_ID, balance: 100, updatedAt: 1 })
    await transferFunds({ from: USER_WALLET_ID, to: 'contact-a', amount: 35, kind: 'transfer', idempotencyKey: 'backup:transfer' })
    await api.contacts.put(contact('contact-a'))
    const backup = restorable(await createBackup({ ...useSettingsStore.getState() }))

    resetFakeServer()
    await db.walletAccounts.update(USER_WALLET_ID, { balance: 1 })
    await db.walletTransactions.clear()
    await restoreBackup(backup)

    expect(await getOrUndef(api.contacts.get('contact-a'))).toMatchObject({ id: 'contact-a', name: 'contact-a' })
    expect(await getBalance(USER_WALLET_ID)).toBe(1)
    expect(await getBalance('contact-a')).toBe(35)
    expect(await db.walletTransactions.where('idempotencyKey').equals('backup:transfer').count()).toBe(0)
  })

  it('creates a user account when restoring a legacy backup without wallet tables', async () => {
    const backup = restorable(await createBackup({ ...useSettingsStore.getState() }))
    backup.settings = { walletBalance: 42, walletMigrated: false }
    backup.tables.walletAccounts = []
    backup.tables.walletTransactions = []

    await restoreBackup(backup)

    expect(await getBalance(USER_WALLET_ID)).toBe(42)
    expect(await db.walletTransactions.where('idempotencyKey').equals('legacy-wallet-migration').count()).toBe(1)
  })
})
