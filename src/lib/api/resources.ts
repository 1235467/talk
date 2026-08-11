import type {
  AcousticEdge,
  AiTurnDebug,
  AiUsageRecord,
  Contact,
  ContactExperience,
  ContactGenerationTask,
  ContactLifeState,
  ContactMemory,
  ContactRelationLink,
  Conversation,
  Group,
  GroupPlan,
  InternalTask,
  LibraryItem,
  LifeEvent,
  LocationModuleState,
  LocationNode,
  MediaAsset,
  Message,
  Moment,
  MomentComment,
  MomentLike,
  PersonaCreationRecord,
  SavedPersona,
  SavedWorldview,
  SimulationState,
  SocialEvent,
  Sticker,
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
    patch: (id: string, patch: Partial<T>) => apiFetch<T>(`${path}/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
    delete: (id: string) => apiFetch(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
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

  kv: {
    list: () => apiFetch<Record<string, unknown>>('/kv'),
    get: (key: string) => apiFetch<unknown>(`/kv/${encodeURIComponent(key)}`),
    set: (key: string, value: unknown) => apiFetch('/kv', { method: 'POST', body: { key, value } }),
    delete: (key: string) => apiFetch(`/kv/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  },

  presets: {
    list: () => apiFetch<ServerPromptPreset[]>('/presets'),
    get: (name: string) => apiFetch<ServerPromptPreset>(`/presets/${encodeURIComponent(name)}`),
    create: (name: string, modules: unknown) => apiFetch('/presets', { method: 'POST', body: { name, modules } }),
    update: (name: string, modules: unknown) => apiFetch(`/presets/${encodeURIComponent(name)}`, { method: 'PUT', body: { modules } }),
    delete: (name: string) => apiFetch(`/presets/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  },

  batch: {
    deleteContact: (contactId: string) => apiFetch('/batch/delete-contact', { method: 'POST', body: { contactId } }),
    deleteMoment: (momentId: string) => apiFetch('/batch/delete-moment', { method: 'POST', body: { momentId } }),
    deleteMessage: (messageId: string) => apiFetch('/batch/delete-message', { method: 'POST', body: { messageId } }),
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
