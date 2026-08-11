import { api } from './api/resources'
import { invalidateAll } from './api/keys'
import type { AppSettings } from '../types'
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
  'walletAccounts', 'walletTransactions', 'loans', 'jobListings', 'interviews', 'groupPlans', 'adminLogs', 'adminAiTraces', 'savedPersonas', 'shopPurchaseHistory',
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

export function settingsWithoutSecrets(value: unknown, key = ''): unknown {
  if (/api.?key|authorization|token|password|secret/i.test(key)) return ''
  if (Array.isArray(value)) return value.map((item) => settingsWithoutSecrets(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).flatMap(([childKey, childValue]) =>
      typeof childValue === 'function' ? [] : [[childKey, settingsWithoutSecrets(childValue, childKey)]],
    ))
  }
  return value
}

export function mergeSettingsPreservingSecrets(restored: Partial<AppSettings>, current: AppSettings): Partial<AppSettings> {
  const merge = (incoming: unknown, existing: unknown, key = ''): unknown => {
    if (/api.?key|authorization|token|password|secret/i.test(key)) return existing ?? ''
    if (Array.isArray(incoming)) return incoming
    if (incoming && typeof incoming === 'object') {
      const existingRecord = existing && typeof existing === 'object' ? existing as Record<string, unknown> : {}
      return Object.fromEntries(Object.entries(incoming).map(([childKey, childValue]) => [childKey, merge(childValue, existingRecord[childKey], childKey)]))
    }
    return incoming
  }
  return merge(restored, current) as Partial<AppSettings>
}

export async function createBackup(_settings: Partial<AppSettings>): Promise<TalkBackup> {
  return (await api.backup.export()) as unknown as TalkBackup
}

export function assertTalkBackup(value: unknown): asserts value is TalkBackup {
  if (!value || typeof value !== 'object') throw new Error('备份文件格式不正确')
  const backup = value as Partial<TalkBackup>
  if (backup.format !== BACKUP_FORMAT) throw new Error('这不是 Talk 的备份文件')
  if (![1, 2, 3, 4, 5, 6, 7, BACKUP_SCHEMA_VERSION].includes(backup.schemaVersion as number)) throw new Error('备份版本暂不支持')
  if (!backup.tables || typeof backup.tables !== 'object') throw new Error('备份文件缺少数据表')
  for (const name of BACKUP_TABLES) {
    if (['libraryItems','worldbookCollections','worldbookEntries','simulationState','contactLifeStates','lifeEvents','contactExperiences','aiUsageRecords','socialEvents','contactMemories','walletAccounts','walletTransactions','loans','jobListings','interviews','groupPlans','adminLogs','adminAiTraces','savedPersonas','shopPurchaseHistory','locations','worldMaps','locationModuleState','acousticEdges','contactGenerationTasks','contactStorylines','contactSaveSnapshots','globalSaveSnapshots','mediaAssets'].includes(name) && backup.tables[name] === undefined) continue
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
  await ensureWalletsAfterRestore(backup.settings)
}
