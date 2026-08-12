import { beforeEach, describe, expect, it } from 'vitest'
import { resetFakeServer } from '../test/setup'
import { useSettingsStore } from '../store/useSettingsStore'
import type { Contact } from '../types'
import { api } from './api/resources'
import { getOrUndef } from './api/client'
import { BACKUP_TABLES, createBackup, mergeSettingsForRestore, restoreBackup, type TalkBackup } from './backup'
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
  useSettingsStore.setState({ walletBalance: 0, walletMigrated: true, userNickname: '测试用户' })
  resetFakeServer()
})

describe('wallet backup', () => {
  it('writes a full-fidelity backup: keys included, device-only values excluded', async () => {
    // The server export dumps kv raw; createBackup only filters device keys.
    await api.kv.set('apiKey', 'chat-secret')
    await api.kv.set('apiKeys', { deepseek: 'chat-secret', custom: 'custom-secret' })
    await api.kv.set('tavilyApiKey', 'search-secret')
    await api.kv.set('imageProviders', { atlas: { apiKey: 'atlas-secret', model: 'm' } })
    await api.kv.set('serverUrl', 'https://talk.example.com')
    await api.kv.set('serverToken', 'device-token')
    await api.kv.set('topInsetAdjustmentPx', 12)
    const backup = await createBackup()
    const serialized = JSON.stringify(backup)
    expect(serialized).toContain('chat-secret')
    expect(serialized).toContain('custom-secret')
    expect(serialized).toContain('search-secret')
    expect(serialized).toContain('atlas-secret')
    expect(backup.settings.serverUrl).toBeUndefined()
    expect(backup.settings.serverToken).toBeUndefined()
    expect(backup.settings.topInsetAdjustmentPx).toBeUndefined()
    expect(serialized).not.toContain('device-token')
  })

  it('normalizes legacy backup settings at the restore boundary', () => {
    // A pre-slot, pre-volcano backup: only single-value mirrors, and the
    // imageProviders block lacks newer providers.
    const legacy = {
      aiProvider: 'custom',
      apiKey: 'sk-legacy',
      baseUrl: 'https://legacy.example.com/v1',
      imageProviders: { atlas: { apiKey: 'k', baseUrl: 'https://api.atlascloud.ai/api/v1', model: 'bytedance/seedream-v4', size: '1024*1024', promptPrefix: '', visualStyle: 'anime', customVisualStyle: '' } },
      serverUrl: 'https://old-server.example.com',
    }
    const merged = mergeSettingsForRestore(legacy as Partial<import('../types').AppSettings>, useSettingsStore.getState())
    expect(merged.apiKeys).toEqual({ custom: 'sk-legacy' })
    expect(merged.baseUrls).toEqual({ custom: 'https://legacy.example.com/v1' })
    expect(merged.imageProviders?.volcano).toMatchObject({ model: 'doubao-seedream-5-0-pro-260628' })
    expect(merged.serverUrl).toBe(useSettingsStore.getState().serverUrl)
  })

  it('round-trips wallets and ledger rows through a backup', async () => {
    await api.walletAccounts.put({ ownerId: USER_WALLET_ID, balance: 100, updatedAt: 1 })
    await api.contacts.put(contact('contact-a'))
    await transferFunds({ from: USER_WALLET_ID, to: 'contact-a', amount: 35, kind: 'transfer', idempotencyKey: 'backup:transfer' })
    const backup = restorable(await createBackup())

    resetFakeServer()
    await restoreBackup(backup)

    expect(await getOrUndef(api.contacts.get('contact-a'))).toMatchObject({ id: 'contact-a', name: 'contact-a' })
    expect(await getBalance(USER_WALLET_ID)).toBe(65)
    expect(await getBalance('contact-a')).toBe(35)
    expect((await api.walletTransactions.list({ idempotencyKey: 'backup:transfer' })).length).toBe(1)
  })

  it('creates a user account when restoring a legacy backup without wallet tables', async () => {
    const backup = restorable(await createBackup())
    backup.settings = { walletBalance: 42, walletMigrated: false }
    backup.tables.walletAccounts = []
    backup.tables.walletTransactions = []

    await restoreBackup(backup)

    expect(await getBalance(USER_WALLET_ID)).toBe(42)
    expect((await api.walletTransactions.list({ idempotencyKey: 'legacy-wallet-migration' })).length).toBe(1)
  })
})
