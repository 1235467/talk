import type {
  AcousticEdge,
  SpeechCacheRecord,
  AiTurnDebug,
  AiUsageRecord,
  Contact,
  ContactExperience,
  ContactGenerationTask,
  ContactLifeState,
  ContactMemory,
  ContactRelationLink,
  ContactSaveSnapshot,
  ContactStoryline,
  Conversation,
  GlobalSaveSnapshot,
  Group,
  GroupPlan,
  InternalTask,
  InterviewSession,
  InventoryItem,
  JobListing,
  LibraryItem,
  LifeEvent,
  LocationModuleState,
  LocationNode,
  Loan,
  MediaAsset,
  Message,
  Moment,
  MomentComment,
  MomentLike,
  PersonaCreationRecord,
  SavedPersona,
  SavedWorldview,
  ShopPurchaseHistory,
  SimulationState,
  SocialEvent,
  Sticker,
  WalletAccount,
  WalletTransaction,
  WorldMapRecord,
  WorldbookCollection,
  WorldbookEntry,
} from '../../types'
import { apiFetch } from './client'

export interface ListParams {
  [key: string]: string | number | undefined
  limit?: number
  before?: string
}

function resource<T extends { id: string }>(path: string) {
  return {
    list: (params?: ListParams) => apiFetch<T[]>(path, { params }),
    get: (id: string) => apiFetch<T>(`${path}/${encodeURIComponent(id)}`),
    put: (row: T) => apiFetch<T>(path, { method: 'POST', body: row }),
    bulkPut: (rows: T[]) => apiFetch(`${path}/bulk`, { method: 'POST', body: rows }),
    patch: (id: string, patch: Partial<T>) => apiFetch<T>(`${path}/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
    delete: (id: string) => apiFetch(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    bulkDelete: (ids: string[]) => apiFetch(`${path}/bulk-delete`, { method: 'POST', body: ids }),
  }
}

/** Like resource() but the primary key is not called `id` in the payload (e.g. contact_life_states keyed by contactId). */
function keyedResource<T>(path: string) {
  return {
    list: (params?: ListParams) => apiFetch<T[]>(path, { params }),
    get: (id: string) => apiFetch<T>(`${path}/${encodeURIComponent(id)}`),
    put: (row: T) => apiFetch<T>(path, { method: 'POST', body: row }),
    bulkPut: (rows: T[]) => apiFetch(`${path}/bulk`, { method: 'POST', body: rows }),
    patch: (id: string, patch: Partial<T>) => apiFetch<T>(`${path}/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
    delete: (id: string) => apiFetch(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    bulkDelete: (ids: string[]) => apiFetch(`${path}/bulk-delete`, { method: 'POST', body: ids }),
  }
}

export const api = {
  contacts: resource<Contact>('/contacts'),
  conversations: resource<Conversation>('/conversations'),
  messages: resource<Message>('/messages'),
  groups: resource<Group>('/groups'),
  stickers: resource<Sticker>('/stickers'),
  contactRelations: resource<ContactRelationLink>('/contact-relations'),
  moments: resource<Moment>('/moments'),
  momentComments: resource<MomentComment>('/moment-comments'),
  momentLikes: resource<MomentLike>('/moment-likes'),
  worldbookCollections: resource<WorldbookCollection>('/worldbook-collections'),
  worldbookEntries: resource<WorldbookEntry>('/worldbook-entries'),
  libraryItems: resource<LibraryItem>('/library-items'),
  savedWorldviews: resource<SavedWorldview>('/saved-worldviews'),
  simulationState: keyedResource<SimulationState>('/simulation-state'),
  contactLifeStates: keyedResource<ContactLifeState>('/contact-life-states'),
  lifeEvents: resource<LifeEvent>('/life-events'),
  contactExperiences: resource<ContactExperience>('/contact-experiences'),
  socialEvents: resource<SocialEvent>('/social-events'),
  contactMemories: resource<ContactMemory>('/contact-memories'),
  groupPlans: resource<GroupPlan>('/group-plans'),
  internalTasks: resource<InternalTask>('/internal-tasks'),
  savedPersonas: resource<SavedPersona>('/saved-personas'),
  personaCreationRecords: resource<PersonaCreationRecord>('/persona-creation-records'),
  contactGenerationTasks: resource<ContactGenerationTask>('/contact-generation-tasks'),
  locations: resource<LocationNode>('/locations'),
  worldMaps: keyedResource<WorldMapRecord>('/world-maps'),
  locationModuleState: keyedResource<LocationModuleState>('/location-module-state'),
  acousticEdges: resource<AcousticEdge>('/acoustic-edges'),
  mediaAssets: resource<MediaAsset>('/media-assets'),
  aiTurns: resource<AiTurnDebug>('/ai-turns'),
  aiUsageRecords: resource<AiUsageRecord>('/ai-usage-records'),
  speechCache: keyedResource<SpeechCacheRecord>('/speech-cache'),
  walletAccounts: keyedResource<WalletAccount>('/wallet-accounts'),
  walletTransactions: resource<WalletTransaction>('/wallet-transactions'),
  loans: resource<Loan>('/loans'),
  inventory: resource<InventoryItem>('/inventory'),
  shopPurchaseHistory: keyedResource<ShopPurchaseHistory>('/shop-purchase-history'),
  jobListings: resource<JobListing>('/job-listings'),
  interviews: resource<InterviewSession>('/interviews'),
  contactStorylines: resource<ContactStoryline>('/contact-storylines'),
  contactSaveSnapshots: resource<ContactSaveSnapshot>('/contact-save-snapshots'),
  globalSaveSnapshots: resource<GlobalSaveSnapshot>('/global-save-snapshots'),

  /** Atomic ledger operations (balance math and idempotency live server-side). */
  finance: {
    ensure: () => apiFetch('/finance/ensure', { method: 'POST' }),
    transfer: (body: { from?: string; to?: string; amount: number; kind: string; note?: string; idempotencyKey?: string; status?: 'completed' | 'reserved' }) =>
      apiFetch<WalletTransaction>('/finance/transfer', { method: 'POST', body }),
    claimRedPacket: (transactionId: string, to: string) =>
      apiFetch<WalletTransaction>('/finance/claim-red-packet', { method: 'POST', body: { transactionId, to } }),
    claimDailySalaries: (date: string) =>
      apiFetch<{ userAmount: number; contactAmount: number; contactCount: number; date: string }>('/finance/claim-daily-salaries', { method: 'POST', body: { date } }),
    /** Atomic: charges the user wallet, adds the inventory card, upserts repurchase history. */
    purchase: (product: { name: string; description: string; icon: string; price: number; productKey: string; note?: string }) =>
      apiFetch<InventoryItem>('/finance/purchase', { method: 'POST', body: product }),
  },

  kv: {
    list: () => apiFetch<Record<string, unknown>>('/kv'),
    get: (key: string) => apiFetch<unknown>(`/kv/${encodeURIComponent(key)}`),
    set: (key: string, value: unknown) => apiFetch('/kv', { method: 'POST', body: { key, value } }),
    delete: (key: string) => apiFetch(`/kv/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  },

  presets: {
    list: () => apiFetch<ServerPromptPreset[]>('/presets'),
    get: (name: string) => apiFetch<ServerPromptPreset>(`/presets/${encodeURIComponent(name)}`),
    create: (name: string, modules: unknown, isFactory = false) => apiFetch('/presets', { method: 'POST', body: { name, modules, isFactory } }),
    update: (name: string, modules: unknown) => apiFetch(`/presets/${encodeURIComponent(name)}`, { method: 'PUT', body: { modules } }),
    delete: (name: string) => apiFetch(`/presets/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  },

  batch: {
    deleteContact: (contactId: string) => apiFetch('/batch/delete-contact', { method: 'POST', body: { contactId } }),
    deleteMoment: (momentId: string) => apiFetch('/batch/delete-moment', { method: 'POST', body: { momentId } }),
    deleteMessage: (messageId: string) => apiFetch('/batch/delete-message', { method: 'POST', body: { messageId } }),
  },

  /** Atomic multi-table snapshot operations. */
  saves: {
    restoreContact: (snapshotId: string) => apiFetch('/saves/restore-contact', { method: 'POST', body: { snapshotId } }),
    restoreGlobal: (snapshotId: string) => apiFetch('/saves/restore-global', { method: 'POST', body: { snapshotId } }),
    switchWorldview: (contactId: string, worldviewId: string, worldName?: string) =>
      apiFetch<ContactStoryline>('/saves/switch-worldview', { method: 'POST', body: { contactId, worldviewId, worldName } }),
  },

  media: {
    upload: (dataUrl: string) => apiFetch<{ url: string }>('/media', { method: 'POST', body: { dataUrl } }),
  },

  backup: {
    export: () => apiFetch<Record<string, unknown>>('/export'),
    import: (backup: unknown) => apiFetch<string[]>('/import', { method: 'POST', body: backup }),
  },
}

export interface ServerPromptPreset {
  name: string
  isFactory: boolean
  modules: unknown
  createdAt: number
  updatedAt: number
}
