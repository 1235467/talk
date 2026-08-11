import { api } from './api/resources'
import { getOrUndef } from './api/client'
import { invalidate } from './api/keys'
import { useSettingsStore } from '../store/useSettingsStore'
import type { WalletOwnerId, WalletTransaction, WalletTransactionKind } from '../types'

export const USER_WALLET_ID = 'user'
export function localDateKey(date = new Date()): string {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
function dayNumber(key: string): number { return Math.floor(new Date(`${key}T12:00:00`).getTime() / 86400000) }
export function elapsedLocalDays(from: string, to: string): number { return Math.max(0, dayNumber(to) - dayNumber(from)) }

function invalidateFinance() { invalidate('walletAccounts', 'walletTransactions', 'loans') }

/** Create missing wallet rows and migrate the legacy settings balance exactly once (server-side). */
export async function ensureWallets(): Promise<void> {
  await api.finance.ensure()
  invalidate('walletAccounts')
}

/** After a backup restore the server kv is already replaced, so ensure() picks up the legacy balance from there. */
export async function ensureWalletsAfterRestore(): Promise<void> {
  await ensureWallets()
}

export async function getBalance(ownerId: WalletOwnerId): Promise<number> {
  return (await getOrUndef(api.walletAccounts.get(ownerId)))?.balance ?? 0
}

/** @deprecated Use getBalance(). */
export const balanceOf = getBalance

export async function transferFunds(opts: { from?: WalletOwnerId; to?: WalletOwnerId; amount: number; kind: WalletTransactionKind; note?: string; idempotencyKey?: string; status?: 'completed' | 'reserved' }): Promise<WalletTransaction> {
  const amount = Math.round(opts.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('金额必须是正整数')
  if (!opts.from && !opts.to) throw new Error('资金交易缺少账户')
  const row = await api.finance.transfer({ ...opts, amount })
  invalidateFinance()
  return row
}

export async function setUserBalance(target: number) {
  return setWalletBalance(USER_WALLET_ID, target)
}
export async function setWalletBalance(ownerId: WalletOwnerId, target: number) {
  const rounded = Math.max(0, Math.round(target))
  await ensureWallets()
  const current = await getBalance(ownerId)
  if (current === rounded) return
  await transferFunds({ from: current > rounded ? ownerId : undefined, to: rounded > current ? ownerId : undefined, amount: Math.abs(rounded - current), kind: 'admin_adjustment', note: `管理员设定余额为 ${rounded}` })
}
export async function reserveRedPacket(from: WalletOwnerId, amount: number, note?: string, idempotencyKey?: string) {
  return transferFunds({ from, amount, kind: 'red_packet', note, idempotencyKey, status: 'reserved' })
}
export async function claimRedPacket(transactionId: string, to: WalletOwnerId) {
  const row = await api.finance.claimRedPacket(transactionId, to)
  invalidateFinance()
  return row
}

export interface DailySalaryClaimResult { userAmount: number; contactAmount: number; contactCount: number; date: string }

export async function hasClaimedDailySalary(date = localDateKey()): Promise<boolean> {
  return (await api.walletTransactions.list({ idempotencyKey: `salary:user:${date}` })).length > 0
}

/** Daily payroll is user-triggered. Idempotency keys make retries safe even after a partial interruption. */
export async function claimDailySalaries(date = localDateKey()): Promise<DailySalaryClaimResult> {
  const settings = useSettingsStore.getState()
  if (!settings.enabledModules.includes('career')) throw new Error('职业模块尚未启用')
  const result = await api.finance.claimDailySalaries(date)
  settings.setSettings({ userLastSalaryDate: date })
  invalidateFinance()
  return result
}
