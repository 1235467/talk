import { vi } from 'vitest'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

if (!globalThis.localStorage) {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })
}

// ---------------------------------------------------------------------------
// In-memory fake of the talk-server REST API. Every resource call flows
// through apiFetch() in src/lib/api/client.ts, so mocking that single choke
// point gives tests the same semantics as the real server (upserts, patch
// merge-with-null-delete, 404s, equality/contains filters, pagination).
// ---------------------------------------------------------------------------

type Row = Record<string, any>

const RESOURCE_PK: Record<string, string> = {
  contacts: 'id',
  conversations: 'id',
  messages: 'id',
  groups: 'id',
  stickers: 'id',
  'contact-relations': 'id',
  moments: 'id',
  'moment-comments': 'id',
  'moment-likes': 'id',
  'worldbook-collections': 'id',
  'worldbook-entries': 'id',
  'library-items': 'id',
  'saved-worldviews': 'id',
  'simulation-state': 'id',
  'contact-life-states': 'contactId',
  'life-events': 'id',
  'contact-experiences': 'id',
  'social-events': 'id',
  'contact-memories': 'id',
  'group-plans': 'id',
  'internal-tasks': 'id',
  'saved-personas': 'id',
  'persona-creation-records': 'id',
  'contact-generation-tasks': 'id',
  locations: 'id',
  'world-maps': 'id',
  'location-module-state': 'id',
  'acoustic-edges': 'id',
  'media-assets': 'id',
  'ai-turns': 'id',
  'ai-usage-records': 'id',
  'speech-cache': 'messageId',
  'wallet-accounts': 'ownerId',
  'wallet-transactions': 'id',
  loans: 'id',
  inventory: 'id',
  'shop-purchase-history': 'productKey',
  'job-listings': 'id',
  interviews: 'id',
}

/** camelCase backup-table name → REST path (mirrors server import_order). */
const BACKUP_TO_PATH: Record<string, string> = {
  contacts: 'contacts', conversations: 'conversations', groups: 'groups', messages: 'messages',
  stickers: 'stickers', contactRelations: 'contact-relations', moments: 'moments',
  momentComments: 'moment-comments', momentLikes: 'moment-likes',
  worldbookCollections: 'worldbook-collections', worldbookEntries: 'worldbook-entries',
  libraryItems: 'library-items', savedWorldviews: 'saved-worldviews',
  simulationState: 'simulation-state', contactLifeStates: 'contact-life-states',
  lifeEvents: 'life-events', contactExperiences: 'contact-experiences',
  socialEvents: 'social-events', contactMemories: 'contact-memories',
  groupPlans: 'group-plans', internalTasks: 'internal-tasks',
  savedPersonas: 'saved-personas', personaCreationRecords: 'persona-creation-records',
  contactGenerationTasks: 'contact-generation-tasks', locations: 'locations',
  worldMaps: 'world-maps', locationModuleState: 'location-module-state',
  acousticEdges: 'acoustic-edges', mediaAssets: 'media-assets',
  aiTurns: 'ai-turns', aiUsageRecords: 'ai-usage-records',
  walletAccounts: 'wallet-accounts', walletTransactions: 'wallet-transactions', loans: 'loans',
  inventory: 'inventory', shopPurchaseHistory: 'shop-purchase-history',
  jobListings: 'job-listings', interviews: 'interviews',
}

interface FakeDb {
  tables: Map<string, Map<string, Row>>
  kv: Map<string, unknown>
  presets: Map<string, Row>
}

function freshDb(): FakeDb {
  return { tables: new Map(), kv: new Map(), presets: new Map() }
}

let state = freshDb()

export function resetFakeServer() {
  state = freshDb()
}

function table(name: string): Map<string, Row> {
  let rows = state.tables.get(name)
  if (!rows) {
    rows = new Map()
    state.tables.set(name, rows)
  }
  return rows
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

function sortDefault(resource: string, rows: Row[]): Row[] {
  const by = (selector: (row: Row) => number, desc = false) =>
    [...rows].sort((a, b) => (desc ? selector(b) - selector(a) : selector(a) - selector(b)))
  if (resource === 'messages' || resource === 'moment-comments') {
    return by((row) => (row.createdAt ?? 0) * 1e6 + 0).sort((a, b) => (a.createdAt - b.createdAt) || String(a.id).localeCompare(String(b.id)))
  }
  if (resource === 'moments') return by((row) => row.createdAt ?? 0, true)
  if (resource === 'conversations') return by((row) => row.updatedAt ?? 0, true)
  return rows
}

function listRows(resource: string, params: Record<string, string | number | undefined>): Row[] {
  const pk = RESOURCE_PK[resource]
  let rows = [...table(resource).values()]
  for (const [key, rawValue] of Object.entries(params)) {
    if (rawValue === undefined || key === 'limit' || key === 'before') continue
    const value = String(rawValue)
    if (key.endsWith('_contains')) {
      const field = snakeToCamel(key.slice(0, -'_contains'.length))
      rows = rows.filter((row) => Array.isArray(row[field]) && row[field].includes(value))
      continue
    }
    const field = key.includes('_') ? snakeToCamel(key) : key
    rows = rows.filter((row) => String(row[field] ?? '') === value)
  }
  rows = sortDefault(resource, rows)
  const before = params.before ? String(params.before) : undefined
  if (before) {
    const [tsText, id] = before.split(',')
    const ts = Number(tsText)
    rows = rows.filter((row) => (row.createdAt ?? 0) < ts || ((row.createdAt ?? 0) === ts && String(row[pk]) < id))
  }
  const limit = params.limit ? Math.max(1, Math.min(500, Number(params.limit))) : undefined
  if (limit) rows = rows.slice(0, limit)
  return rows
}

function mergePatch(current: Row, patch: Row): Row {
  const next = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
    else next[key] = value
  }
  return next
}

async function fakeApiFetch(path: string, options: { method?: string; body?: any; params?: Record<string, string | number | undefined> } = {}): Promise<any> {
  const method = options.method ?? 'GET'
  const segments = path.replace(/^\//, '').split('/').map(decodeURIComponent)
  const [head, id, sub] = segments

  if (head === 'kv') {
    if (method === 'GET' && !id) return Object.fromEntries(state.kv)
    if (method === 'GET' && id) {
      if (!state.kv.has(id)) throw new FakeApiError(404, 'not found')
      return state.kv.get(id)
    }
    if (method === 'POST') {
      state.kv.set(options.body.key, options.body.value)
      return { ok: true }
    }
    if (method === 'DELETE' && id) {
      if (!state.kv.delete(id)) throw new FakeApiError(404, 'not found')
      return { ok: true }
    }
  }

  if (head === 'presets') {
    if (method === 'GET' && !id) return [...state.presets.values()]
    if (method === 'GET' && id) {
      const row = state.presets.get(id)
      if (!row) throw new FakeApiError(404, 'not found')
      return row
    }
    if (method === 'POST') {
      if (state.presets.has(options.body.name)) throw new FakeApiError(409, 'exists')
      const row = { name: options.body.name, isFactory: options.body.isFactory === true, modules: options.body.modules, createdAt: Date.now(), updatedAt: Date.now() }
      state.presets.set(row.name, row)
      return { ok: true }
    }
    if (method === 'PUT' && id) {
      const row = state.presets.get(id)
      if (!row) throw new FakeApiError(404, 'not found')
      if (row.isFactory) throw new FakeApiError(409, 'factory preset is read-only')
      state.presets.set(id, { ...row, modules: options.body.modules, updatedAt: Date.now() })
      return { ok: true }
    }
    if (method === 'DELETE' && id) {
      const row = state.presets.get(id)
      if (!row) throw new FakeApiError(404, 'not found')
      if (row.isFactory) throw new FakeApiError(409, 'factory preset is read-only')
      state.presets.delete(id)
      return { ok: true }
    }
  }

  // Finance endpoints: same semantics as the real server's routes/finance.rs.
  if (head === 'finance') {
    const accounts = table('wallet-accounts')
    const txs = table('wallet-transactions')
    const readBalance = (ownerId: string): number | undefined => accounts.get(ownerId)?.balance as number | undefined
    const writeBalance = (ownerId: string, balance: number) => accounts.set(ownerId, { ownerId, balance, updatedAt: Date.now() })
    const applyTransfer = (body: any): Row => {
      const amount = Math.round(body.amount)
      if (!Number.isFinite(amount) || amount <= 0) throw new FakeApiError(400, '金额必须是正整数')
      if (!body.from && !body.to) throw new FakeApiError(400, '资金交易缺少账户')
      const status = body.status ?? 'completed'
      if (body.idempotencyKey) {
        const existing = [...txs.values()].find((row) => row.idempotencyKey === body.idempotencyKey)
        if (existing) {
          const same = existing.fromOwnerId === body.from && existing.toOwnerId === body.to && existing.amount === amount && existing.kind === body.kind && existing.status === status
          if (!same) throw new FakeApiError(409, '幂等键已用于另一笔交易')
          return existing
        }
      }
      if (body.from) {
        const balance = readBalance(body.from)
        if (balance === undefined || balance < amount) throw new FakeApiError(400, '余额不足')
        writeBalance(body.from, balance - amount)
      }
      if (body.to) writeBalance(body.to, (readBalance(body.to) ?? 0) + amount)
      const now = Date.now()
      const row: Row = { id: `tx-${now}-${txs.size}`, kind: body.kind, amount, status, createdAt: now }
      if (body.idempotencyKey) row.idempotencyKey = body.idempotencyKey
      if (body.from) row.fromOwnerId = body.from
      if (body.to) row.toOwnerId = body.to
      if (body.note) row.note = body.note
      if (status === 'completed') row.completedAt = now
      txs.set(row.id, row)
      return row
    }

    if (id === 'ensure' && method === 'POST') {
      const migrated = state.kv.get('walletMigrated') === true
      const legacyRaw = migrated ? 0 : Number(state.kv.get('walletBalance') ?? 0)
      const legacy = Number.isFinite(legacyRaw) ? Math.max(0, Math.round(legacyRaw)) : 0
      if (readBalance('user') === undefined) {
        if (legacy > 0) applyTransfer({ to: 'user', amount: legacy, kind: 'migration', idempotencyKey: 'legacy-wallet-migration' })
        else writeBalance('user', 0)
      }
      for (const contact of table('contacts').values()) {
        if (!String(contact.id).startsWith('ai-test-') && readBalance(String(contact.id)) === undefined) writeBalance(String(contact.id), 0)
      }
      state.kv.set('walletMigrated', true)
      return { ok: true }
    }
    if (id === 'transfer' && method === 'POST') return applyTransfer(options.body)
    if (id === 'claim-red-packet' && method === 'POST') {
      const tx = txs.get(options.body.transactionId)
      if (!tx || tx.kind !== 'red_packet' || tx.status !== 'reserved') throw new FakeApiError(400, '红包已领取或不存在')
      writeBalance(options.body.to, (readBalance(options.body.to) ?? 0) + tx.amount)
      const next = { ...tx, toOwnerId: options.body.to, status: 'completed', completedAt: Date.now() }
      txs.set(tx.id, next)
      return next
    }
    if (id === 'claim-daily-salaries' && method === 'POST') {
      const date = String(options.body.date)
      const occupation = String(state.kv.get('userOccupation') ?? '')
      const monthly = Number(state.kv.get('userMonthlySalary') ?? 0)
      if (!occupation || monthly <= 0) throw new FakeApiError(400, '需要先入职才能领取工资')
      const userAmount = Math.max(1, Math.round(monthly / 30))
      const alreadyClaimed = [...txs.values()].some((row) => row.idempotencyKey === `salary:user:${date}`)
      if (!alreadyClaimed) applyTransfer({ to: 'user', amount: userAmount, kind: 'salary', note: `${occupation}工资`, idempotencyKey: `salary:user:${date}` })
      let contactAmount = 0
      let contactCount = 0
      for (const contact of table('contacts').values()) {
        if (String(contact.id).startsWith('ai-test-')) continue
        const contactOccupation = String(contact.occupation ?? '')
        const contactMonthly = Number(contact.monthlySalary ?? 0)
        if (!contactOccupation || contactMonthly <= 0) continue
        const amount = Math.max(1, Math.round(contactMonthly / 30))
        applyTransfer({ to: contact.id, amount, kind: 'salary', note: `${contactOccupation}工资`, idempotencyKey: `salary:${contact.id}:${date}` })
        table('contacts').set(String(contact.id), { ...contact, lastSalaryDate: date })
        contactAmount += amount
        contactCount += 1
      }
      if (alreadyClaimed) throw new FakeApiError(400, '今天已经领取过工资了')
      return { userAmount, contactAmount, contactCount, date }
    }
    if (id === 'purchase' && method === 'POST') {
      const product = options.body
      applyTransfer({ from: 'user', amount: product.price, kind: 'purchase', note: product.note ?? product.name })
      const now = Date.now()
      const item: Row = { id: `item-${now}-${table('inventory').size}`, productKey: product.productKey, name: product.name, description: product.description, icon: product.icon, price: product.price, acquiredAt: now }
      table('inventory').set(item.id, item)
      const history = table('shop-purchase-history')
      const existing = history.get(product.productKey)
      history.set(product.productKey, {
        productKey: product.productKey, name: product.name, description: product.description, icon: product.icon, price: product.price,
        purchaseCount: (existing?.purchaseCount ?? 0) + 1,
        firstPurchasedAt: existing?.firstPurchasedAt ?? now,
        lastPurchasedAt: now,
      })
      return item
    }
    throw new FakeApiError(404, `unknown finance endpoint ${id}`)
  }

  if (head === 'batch') {
    if (id === 'delete-message') {
      const messageId = options.body.messageId
      if (!table('messages').delete(messageId)) throw new FakeApiError(404, 'not found')
      // Mirrors the real server: speech-cache row goes with the message.
      table('speech-cache').delete(messageId)
      return { ok: true }
    }
    if (id === 'delete-moment') {
      const momentId = options.body.momentId
      const moment = table('moments').get(momentId)
      if (!moment) throw new FakeApiError(404, 'not found')
      if (moment.imageAssetId) table('media-assets').delete(String(moment.imageAssetId))
      for (const [sid, event] of table('social-events')) if (event.momentId === momentId) table('social-events').delete(sid)
      table('moments').delete(momentId)
      for (const [cid, comment] of table('moment-comments')) if (comment.momentId === momentId) table('moment-comments').delete(cid)
      for (const [lid, like] of table('moment-likes')) if (like.momentId === momentId) table('moment-likes').delete(lid)
      if (moment.contactId && moment.contactId !== 'user') {
        const contact = table('contacts').get(moment.contactId)
        if (contact) {
          const remaining = listRows('moments', { contactId: moment.contactId })
          const lastAt = remaining.reduce((max, row) => Math.max(max, row.createdAt ?? 0), 0)
          table('contacts').set(contact.id, mergePatch(contact, { lastMomentAt: lastAt || null }))
        }
      }
      return { ok: true }
    }
    if (id === 'delete-contact') {
      const contactId = options.body.contactId
      for (const conversation of listRows('conversations', { contactId })) {
        for (const message of listRows('messages', { conversationId: conversation.id })) table('messages').delete(message.id)
        table('conversations').delete(conversation.id)
      }
      for (const moment of listRows('moments', { contactId })) {
        table('moments').delete(moment.id)
        for (const [cid, comment] of table('moment-comments')) if (comment.momentId === moment.id) table('moment-comments').delete(cid)
        for (const [lid, like] of table('moment-likes')) if (like.momentId === moment.id) table('moment-likes').delete(lid)
      }
      for (const [cid, comment] of table('moment-comments')) if (comment.authorContactId === contactId) table('moment-comments').delete(cid)
      for (const [lid, like] of table('moment-likes')) if (like.likerId === contactId) table('moment-likes').delete(lid)
      for (const [rid, relation] of table('contact-relations')) if (relation.fromContactId === contactId || relation.toContactId === contactId) table('contact-relations').delete(rid)
      for (const [eid, experience] of table('contact-experiences')) {
        if (!experience.contactIds?.includes(contactId)) continue
        const remaining = experience.contactIds.filter((c: string) => c !== contactId)
        if (remaining.length === 0) table('contact-experiences').delete(eid)
        else table('contact-experiences').set(eid, { ...experience, contactIds: remaining })
      }
      for (const [gid, group] of table('groups')) {
        if (group.memberContactIds?.includes(contactId)) {
          table('groups').set(gid, { ...group, memberContactIds: group.memberContactIds.filter((c: string) => c !== contactId) })
        }
      }
      for (const name of ['contact-memories', 'life-events', 'internal-tasks', 'ai-turns']) {
        for (const [rid, row] of table(name)) if (row.contactId === contactId) table(name).delete(rid)
      }
      table('contact-life-states').delete(contactId)
      // Mirrors the real server: finance rows involving the contact go with it.
      table('wallet-accounts').delete(contactId)
      for (const [tid, tx] of table('wallet-transactions')) if (tx.fromOwnerId === contactId || tx.toOwnerId === contactId) table('wallet-transactions').delete(tid)
      for (const [lid, loan] of table('loans')) if (loan.lenderId === contactId || loan.borrowerId === contactId) table('loans').delete(lid)
      if (!table('contacts').delete(contactId)) throw new FakeApiError(404, 'not found')
      return { ok: true }
    }
  }

  if (head === 'export') {
    const tables: Record<string, Row[]> = {}
    for (const [backupName, resource] of Object.entries(BACKUP_TO_PATH)) {
      tables[backupName] = [...table(resource).values()]
    }
    return {
      format: 'talk-backup',
      schemaVersion: 8,
      exportedAt: new Date().toISOString(),
      settings: Object.fromEntries(state.kv),
      tables,
    }
  }

  if (head === 'import') {
    const backup = options.body
    if (backup?.format !== 'talk-backup') throw new FakeApiError(400, 'not a talk-backup file')
    const summary: string[] = []
    for (const [backupName, resource] of Object.entries(BACKUP_TO_PATH)) {
      const rows = backup.tables?.[backupName]
      if (!Array.isArray(rows)) continue
      const pk = RESOURCE_PK[resource]
      for (const row of rows) table(resource).set(String(row[pk]), row)
      summary.push(`${backupName}: ${rows.length} rows`)
    }
    const settings = backup.settings ?? {}
    for (const [key, value] of Object.entries(settings)) {
      if (key === 'promptPresets' && Array.isArray(value)) {
        for (const preset of value) {
          if (preset?.name) state.presets.set(preset.name, { name: preset.name, isFactory: false, modules: preset.modules, createdAt: Date.now(), updatedAt: Date.now() })
        }
        continue
      }
      state.kv.set(key, value)
    }
    return summary
  }

  if (head === 'media' && method === 'POST') return { url: `/media/fake-${Date.now()}.png` }

  const pk = RESOURCE_PK[head]
  if (!pk) throw new FakeApiError(404, `unknown resource ${head}`)

  if (sub === undefined && id === 'bulk' && method === 'POST') {
    for (const row of options.body) table(head).set(String(row[pk]), row)
    return { ok: true }
  }
  if (id === 'bulk-delete' && method === 'POST') {
    let deleted = 0
    for (const rowId of options.body) deleted += table(head).delete(String(rowId)) ? 1 : 0
    return { ok: true, deleted }
  }

  if (!id) {
    if (method === 'GET') return listRows(head, options.params ?? {})
    if (method === 'POST') {
      const row = options.body
      table(head).set(String(row[pk]), row)
      return row
    }
  } else {
    const rows = table(head)
    const current = rows.get(id)
    if (method === 'GET') {
      if (!current) throw new FakeApiError(404, 'not found')
      return current
    }
    if (method === 'PUT' || method === 'POST') {
      rows.set(id, options.body)
      return options.body
    }
    if (method === 'PATCH') {
      if (!current) throw new FakeApiError(404, 'not found')
      const next = mergePatch(current, options.body)
      rows.set(id, next)
      return next
    }
    if (method === 'DELETE') {
      if (!rows.delete(id)) throw new FakeApiError(404, 'not found')
      return { ok: true }
    }
  }
  throw new FakeApiError(405, `${method} ${path} not implemented in fake server`)
}

let FakeApiError: typeof import('../lib/api/client').ApiError

vi.mock('../lib/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api/client')>()
  FakeApiError = original.ApiError
  return {
    ...original,
    apiFetch: fakeApiFetch,
    serverBase: () => '',
    isServerConfigured: () => false,
    // Provider calls hit the (mocked) fetch directly in tests.
    outboundFetch: (url: string, init?: RequestInit) => fetch(url, init),
  }
})

// Tests share one fake backend; reset between files via beforeEach in tests that need isolation.
export { fakeApiFetch }
