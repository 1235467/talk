import { beforeEach, describe, expect, it } from 'vitest'
import { api } from './api/resources'
import { resetFakeServer } from '../test/setup'
import { useSettingsStore } from '../store/useSettingsStore'
import {
  USER_WALLET_ID,
  claimRedPacket,
  claimDailySalaries,
  ensureWallets,
  getBalance,
  reserveRedPacket,
  transferFunds,
} from './finance'

async function transactionCount(): Promise<number> {
  return (await api.walletTransactions.list()).length
}

beforeEach(async () => {
  localStorage.clear()
  resetFakeServer()
  useSettingsStore.setState({ walletBalance: 0, walletMigrated: false })
})

describe('wallet ledger', () => {
  it('migrates the legacy balance exactly once', async () => {
    await api.kv.set('walletBalance', 88)

    await ensureWallets()
    await ensureWallets()

    expect(await getBalance(USER_WALLET_ID)).toBe(88)
    expect((await api.walletTransactions.list({ idempotencyKey: 'legacy-wallet-migration' })).length).toBe(1)
    expect(await api.kv.get('walletMigrated')).toBe(true)
  })

  it('does not resurrect a legacy balance after migration', async () => {
    await api.kv.set('walletBalance', 88)
    await api.kv.set('walletMigrated', true)

    await ensureWallets()

    expect(await getBalance(USER_WALLET_ID)).toBe(0)
    expect(await transactionCount()).toBe(0)
  })

  it('conserves balances and makes retries idempotent', async () => {
    await api.walletAccounts.bulkPut([
      { ownerId: USER_WALLET_ID, balance: 100, updatedAt: 1 },
      { ownerId: 'contact-a', balance: 20, updatedAt: 1 },
    ])
    const input = { from: USER_WALLET_ID, to: 'contact-a', amount: 30, kind: 'transfer' as const, idempotencyKey: 'transfer:test' }

    const first = await transferFunds(input)
    const retry = await transferFunds(input)

    expect(retry.id).toBe(first.id)
    expect(await getBalance(USER_WALLET_ID)).toBe(70)
    expect(await getBalance('contact-a')).toBe(50)
    expect((await getBalance(USER_WALLET_ID)) + (await getBalance('contact-a'))).toBe(120)
    expect(await transactionCount()).toBe(1)
  })

  it('rejects reuse of an idempotency key for a different transaction', async () => {
    await api.walletAccounts.put({ ownerId: USER_WALLET_ID, balance: 100, updatedAt: 1 })
    await transferFunds({ from: USER_WALLET_ID, to: 'contact-a', amount: 10, kind: 'transfer', idempotencyKey: 'same-key' })

    await expect(transferFunds({ from: USER_WALLET_ID, to: 'contact-a', amount: 20, kind: 'transfer', idempotencyKey: 'same-key' })).rejects.toThrow('幂等键已用于另一笔交易')
    expect(await getBalance(USER_WALLET_ID)).toBe(90)
    expect(await getBalance('contact-a')).toBe(10)
  })

  it('rolls back an insufficient-balance transfer', async () => {
    await api.walletAccounts.put({ ownerId: USER_WALLET_ID, balance: 10, updatedAt: 1 })

    await expect(transferFunds({ from: USER_WALLET_ID, to: 'contact-a', amount: 11, kind: 'transfer' })).rejects.toThrow('余额不足')

    expect(await getBalance(USER_WALLET_ID)).toBe(10)
    expect(await getBalance('contact-a')).toBe(0)
    expect(await transactionCount()).toBe(0)
  })

  it('reserves and claims a red packet only once', async () => {
    await api.walletAccounts.bulkPut([
      { ownerId: 'contact-a', balance: 100, updatedAt: 1 },
      { ownerId: USER_WALLET_ID, balance: 0, updatedAt: 1 },
    ])

    const reserved = await reserveRedPacket('contact-a', 25, '测试红包', 'red-packet:test')
    expect(reserved.status).toBe('reserved')
    expect(await getBalance('contact-a')).toBe(75)

    await claimRedPacket(reserved.id, USER_WALLET_ID)
    await expect(claimRedPacket(reserved.id, USER_WALLET_ID)).rejects.toThrow('红包已领取或不存在')

    expect(await getBalance(USER_WALLET_ID)).toBe(25)
    expect((await getBalance(USER_WALLET_ID)) + (await getBalance('contact-a'))).toBe(100)
  })

  it('pays the user and every employed contact once per daily claim', async () => {
    useSettingsStore.setState({ enabledModules: ['career'] })
    await api.kv.set('userOccupation', '设计师')
    await api.kv.set('userMonthlySalary', 9000)
    await api.contacts.put({ id: 'salary-ai', name: '小林', avatar: '🙂', avatarColor: '#eee', systemPrompt: '测试', occupation: '编辑', monthlySalary: 6000, createdAt: 1, memoryFacts: '', memoryStyle: '', memoryUpdatedAt: 0, memoryMessageCursor: 0, relationshipBase: '朋友', relationshipDynamic: '' })

    const result = await claimDailySalaries('2026-07-31')

    expect(result).toMatchObject({ userAmount: 300, contactAmount: 200, contactCount: 1 })
    expect(await getBalance(USER_WALLET_ID)).toBe(300)
    expect(await getBalance('salary-ai')).toBe(200)
    await expect(claimDailySalaries('2026-07-31')).rejects.toThrow('今天已经领取过工资了')
  })

  it('deleting a contact cascades their wallet, ledger rows and loans', async () => {
    await api.contacts.put({ id: 'cascade-ai', name: '小测', avatar: '🙂', avatarColor: '#eee', systemPrompt: '测试', createdAt: 1, memoryFacts: '', memoryStyle: '', memoryUpdatedAt: 0, memoryMessageCursor: 0, relationshipBase: '朋友', relationshipDynamic: '' })
    await ensureWallets()
    await transferFunds({ from: USER_WALLET_ID, to: 'cascade-ai', amount: 0, kind: 'transfer' }).catch(() => undefined)
    await api.walletAccounts.put({ ownerId: USER_WALLET_ID, balance: 100, updatedAt: 1 })
    await transferFunds({ from: USER_WALLET_ID, to: 'cascade-ai', amount: 40, kind: 'transfer', idempotencyKey: 'cascade:test' })
    await api.loans.put({ id: 'loan-cascade', lenderId: USER_WALLET_ID, borrowerId: 'cascade-ai', principal: 10, outstanding: 10, status: 'active', createdAt: 1 })

    await api.batch.deleteContact('cascade-ai')

    expect(await getBalance('cascade-ai')).toBe(0)
    expect(await api.walletTransactions.list({ toOwnerId: 'cascade-ai' })).toEqual([])
    expect(await api.loans.list({ borrowerId: 'cascade-ai' })).toEqual([])
  })
})
