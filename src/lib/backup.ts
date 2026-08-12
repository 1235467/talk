import { api } from './api/resources'
import { invalidateAll } from './api/keys'
import type { AppSettings } from '../types'
import { DEVICE_ONLY_KEYS, normalizeSettingsPatch } from '../store/useSettingsStore'
import { ensureWalletsAfterRestore } from './finance'

const BACKUP_FORMAT = 'talk-backup'
const BACKUP_SCHEMA_VERSION = 8

export const BACKUP_TABLES = [
  'contacts',
  'conversations',
  'messages',
  'stickers',
  'inventory',
  'moments',
  'momentComments',
  'momentLikes',
  'contactRelations',
  'groups',
  'knowledgeEntries',
  'libraryItems',
  'savedWorldviews',
  'worldbookCollections',
  'worldbookEntries',
  'simulationState', 'contactLifeStates', 'lifeEvents', 'contactExperiences', 'aiUsageRecords',
  'aiTurns',
  'socialEvents',
  'contactMemories',
  'locations', 'worldMaps', 'locationModuleState', 'acousticEdges',
  'walletAccounts', 'walletTransactions', 'loans', 'jobListings', 'interviews', 'groupPlans', 'savedPersonas', 'shopPurchaseHistory',
  'contactGenerationTasks',
  'contactStorylines', 'contactSaveSnapshots', 'globalSaveSnapshots',
  'mediaAssets',
] as const

export type BackupTableName = (typeof BACKUP_TABLES)[number]

export interface TalkBackup {
  format: typeof BACKUP_FORMAT
  schemaVersion: typeof BACKUP_SCHEMA_VERSION
  exportedAt: string
  appVersion?: string
  settings: Partial<AppSettings>
  tables: Record<BackupTableName, unknown[]>
}

export function backupFileName(now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  return `talk-backup-${stamp}.json`
}

/**
 * Restore takes the backup verbatim — it is a full-fidelity copy, secrets
 * included. Two adjustments: settings pass through the same normalization as
 * a kv hydrate (legacy backups predate per-provider slots and newer provider
 * blocks), and device-scoped values keep their local values.
 */
export function mergeSettingsForRestore(restored: Partial<AppSettings>, current: AppSettings): Partial<AppSettings> {
  const merged = { ...restored } as Record<string, unknown>
  normalizeSettingsPatch(merged)
  for (const key of DEVICE_ONLY_KEYS) merged[key] = (current as unknown as Record<string, unknown>)[key]
  return merged as Partial<AppSettings>
}

export async function createBackup(): Promise<TalkBackup> {
  const backup = (await api.backup.export()) as unknown as TalkBackup
  // Full-fidelity copy for the owner's own migration: keys are included on
  // purpose. The server export dumps the kv store raw, so the only filtering
  // needed here is dropping device-scoped values — they are meaningless on
  // another device (and device-only keys never sync to kv anyway).
  const settings = { ...backup.settings } as Record<string, unknown>
  for (const key of DEVICE_ONLY_KEYS) delete settings[key]
  backup.settings = settings as Partial<AppSettings>
  return backup
}

export function assertTalkBackup(value: unknown): asserts value is TalkBackup {
  if (!value || typeof value !== 'object') throw new Error('备份文件格式不正确')
  const backup = value as Partial<TalkBackup>
  if (backup.format !== BACKUP_FORMAT) throw new Error('这不是 Talk 的备份文件')
  if (![1, 2, 3, 4, 5, 6, 7, BACKUP_SCHEMA_VERSION].includes(backup.schemaVersion as number)) throw new Error('备份版本暂不支持')
  if (!backup.tables || typeof backup.tables !== 'object') throw new Error('备份文件缺少数据表')
  for (const name of BACKUP_TABLES) {
    if (['libraryItems','worldbookCollections','worldbookEntries','simulationState','contactLifeStates','lifeEvents','contactExperiences','aiUsageRecords','socialEvents','contactMemories','walletAccounts','walletTransactions','loans','jobListings','interviews','groupPlans','savedPersonas','shopPurchaseHistory','locations','worldMaps','locationModuleState','acousticEdges','contactGenerationTasks','contactStorylines','contactSaveSnapshots','globalSaveSnapshots','mediaAssets'].includes(name) && backup.tables[name] === undefined) continue
    if (!Array.isArray(backup.tables[name])) throw new Error(`备份文件缺少 ${name} 表`)
  }
}

export async function restoreBackup(backup: TalkBackup) {
  assertTalkBackup(backup)
  await api.backup.import(backup)
  invalidateAll()
  // Generated speech is a disposable derivative of message text and provider
  // settings. Never let cache rows from the pre-restore history attach to a
  // restored message that happens to reuse the same id.
  await ensureWalletsAfterRestore()
}
