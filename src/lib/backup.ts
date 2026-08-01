import type { Table } from 'dexie'
import { db } from '../db/db'
import type { AppSettings } from '../types'
import { ensureWalletsAfterRestore } from './finance'

const BACKUP_FORMAT = 'talk-backup'
const BACKUP_SCHEMA_VERSION = 4

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
  'savedWorldviews',
  'worldbookCollections',
  'worldbookEntries',
  'simulationState', 'contactLifeStates', 'lifeEvents', 'contactExperiences', 'aiUsageRecords',
  'aiTurns',
  'socialEvents',
  'contactMemories',
  'locations', 'worldMaps', 'locationModuleState', 'acousticEdges',
  'walletAccounts', 'walletTransactions', 'loans', 'jobListings', 'interviews', 'groupPlans', 'adminLogs', 'adminAiTraces', 'savedPersonas', 'shopPurchaseHistory',
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

function table(name: BackupTableName): Table {
  return db.table(name)
}

export function backupFileName(now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  return `talk-backup-${stamp}.json`
}

export async function createBackup(settings: Partial<AppSettings>): Promise<TalkBackup> {
  const entries = await Promise.all(BACKUP_TABLES.map(async (name) => [name, await table(name).toArray()] as const))
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : undefined,
    settings,
    tables: Object.fromEntries(entries) as Record<BackupTableName, unknown[]>,
  }
}

export function assertTalkBackup(value: unknown): asserts value is TalkBackup {
  if (!value || typeof value !== 'object') throw new Error('备份文件格式不正确')
  const backup = value as Partial<TalkBackup>
  if (backup.format !== BACKUP_FORMAT) throw new Error('这不是 Talk 的备份文件')
  if (![1, 2, 3, BACKUP_SCHEMA_VERSION].includes(backup.schemaVersion as number)) throw new Error('备份版本暂不支持')
  if (!backup.tables || typeof backup.tables !== 'object') throw new Error('备份文件缺少数据表')
  for (const name of BACKUP_TABLES) {
    if (['worldbookCollections','worldbookEntries','simulationState','contactLifeStates','lifeEvents','contactExperiences','aiUsageRecords','socialEvents','contactMemories','walletAccounts','walletTransactions','loans','jobListings','interviews','groupPlans','adminLogs','adminAiTraces','savedPersonas','shopPurchaseHistory','locations','worldMaps','locationModuleState','acousticEdges'].includes(name) && backup.tables[name] === undefined) continue
    if (!Array.isArray(backup.tables[name])) throw new Error(`备份文件缺少 ${name} 表`)
  }
}

export async function restoreBackup(backup: TalkBackup) {
  assertTalkBackup(backup)
  await db.transaction(
    'rw',
    BACKUP_TABLES.map((name) => table(name)),
    async () => {
      for (const name of BACKUP_TABLES) await table(name).clear()
      for (const name of BACKUP_TABLES) {
        const rows = backup.tables[name] ?? []
        if (rows.length > 0) await table(name).bulkPut(rows)
      }
      const restoredCollections = backup.tables.worldbookCollections ?? []
      const restoredEntries = backup.tables.worldbookEntries ?? []
      if (restoredCollections.length === 0 && restoredEntries.length > 0) {
        const now = Date.now()
        await db.worldbookCollections.put({ id: 'default-worldbook', name: '默认世界书', enabled: true, sourceType: 'manual', createdAt: now, updatedAt: now })
        const legacyEntries = await db.worldbookEntries.toArray()
        await db.worldbookEntries.bulkUpdate(legacyEntries.map((entry) => ({ key: entry.id, changes: { collectionId: 'default-worldbook', foundationalWorldview: entry.foundationalWorldview === true } })))
      }
    },
  )
  await ensureWalletsAfterRestore(backup.settings)
}
