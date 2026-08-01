import { db } from '../db/db'
import { isAiTestId } from './aiTestIsolation'
import type { AcousticEdge, Contact, LocationAudibility, LocationNode, ScheduleBlock, ScheduleOverride, TerrainType } from '../types'
import { createWorldMap, placeBuildings } from './locationMap'

export const LOCATION_GROUP_ID = 'talk-location-group'
export const LOCATION_CONVERSATION_ID = 'talk-location-conversation'
const MAP_SEED = 'talk-location-map-v1'

type LocationSeed = Pick<LocationNode, 'id' | 'parentId' | 'name' | 'kind' | 'description' | 'access' | 'sortOrder'>
const seed = (id: string, parentId: string | undefined, name: string, kind: string, description: string, sortOrder: number, access: LocationNode['access'] = 'public'): LocationSeed => ({ id, parentId, name, kind, description, access, sortOrder })

const LOCATION_SEEDS: LocationSeed[] = [
  seed('city', undefined, '临江市', 'world', '一座临河而建的现代城市。', 0),
  seed('home', 'city', '家', 'residence', '安静的私人住所。', 10, 'private'),
  seed('home-living', 'home', '客厅', 'living-room', '适合休息和闲聊的客厅。', 11, 'private'),
  seed('home-kitchen', 'home', '厨房', 'kitchen', '连着客厅的开放式厨房。', 12, 'private'),
  seed('school', 'city', '临江学校', 'school', '有教室、食堂和操场的校园。', 20, 'restricted'),
  seed('school-classroom', 'school', '教室', 'classroom', '上课与自习的教室。', 21, 'restricted'),
  seed('school-canteen', 'school', '食堂', 'canteen', '学生们集中用餐的地方。', 22),
  seed('school-playground', 'school', '操场', 'playground', '适合运动与散步的开阔场地。', 23),
  seed('office', 'city', '临江中心', 'office', '城市里的办公楼。', 25),
  seed('office-floor', 'office', '办公区', 'office-floor', '安静忙碌的开放办公区。', 26, 'restricted'),
  seed('office-lobby', 'office', '大堂', 'lobby', '办公楼的一层公共大堂。', 27),
  seed('mall', 'city', '中心商场', 'mall', '人流密集的综合商场。', 30),
  seed('mall-atrium', 'mall', '商场中庭', 'atrium', '明亮开阔的商场中庭。', 31),
  seed('mall-cafe', 'mall', '咖啡店', 'cafe', '适合见面聊天的咖啡店。', 32),
  seed('mall-shop', 'mall', '商店', 'shop', '陈列着各种商品的店铺。', 33),
  seed('hospital', 'city', '市立医院', 'hospital', '提供门诊和住院服务的医院。', 40),
  seed('hospital-lobby', 'hospital', '医院大厅', 'lobby', '患者与访客往来的大厅。', 41),
  seed('hospital-clinic', 'hospital', '门诊室', 'clinic', '安静的门诊诊室。', 42, 'restricted'),
  seed('park', 'city', '临河公园', 'park', '沿河修建的城市公园。', 50),
  seed('park-lawn', 'park', '中央草坪', 'lawn', '适合散步、晒太阳和野餐。', 51),
  seed('park-riverside', 'park', '滨河步道', 'river-walk', '沿着河岸延伸的步行道。', 52),
  seed('beach', 'city', '白沙湾', 'beach', '城市近郊的公共沙滩。', 60),
  seed('beach-boardwalk', 'beach', '海滨步道', 'boardwalk', '能看见海面的木质步道。', 61),
  seed('mountain', 'city', '雾岭', 'mountain', '位于城市边缘的山地景区。', 70),
  seed('mountain-lookout', 'mountain', '山顶观景台', 'lookout', '可以俯瞰城市的观景台。', 71),
  seed('farm', 'city', '晴川农场', 'farm', '位于乡村区域的农场。', 80, 'restricted'),
  seed('farm-field', 'farm', '农田', 'farmland', '开阔的田地。', 81, 'restricted'),
]

const ROOT_SPECS: Array<{ id: string; allowedTerrains: TerrainType[]; buildingCategory: string }> = [
  { id: 'home', allowedTerrains: ['urban', 'rural'], buildingCategory: 'residence' },
  { id: 'school', allowedTerrains: ['urban'], buildingCategory: 'school' },
  { id: 'office', allowedTerrains: ['urban'], buildingCategory: 'office' },
  { id: 'mall', allowedTerrains: ['urban'], buildingCategory: 'mall' },
  { id: 'hospital', allowedTerrains: ['urban'], buildingCategory: 'hospital' },
  { id: 'park', allowedTerrains: ['grassland'], buildingCategory: 'park' },
  { id: 'beach', allowedTerrains: ['beach'], buildingCategory: 'beach' },
  { id: 'mountain', allowedTerrains: ['mountain'], buildingCategory: 'scenic' },
  { id: 'farm', allowedTerrains: ['rural'], buildingCategory: 'farm' },
]

const edge = (fromLocationId: string, toLocationId: string, audibility: LocationAudibility): AcousticEdge => ({
  id: `${fromLocationId}:${toLocationId}`,
  fromLocationId,
  toLocationId,
  audibility,
  bidirectional: true,
})

const ACOUSTIC_SEEDS: AcousticEdge[] = [
  edge('home-living', 'home-kitchen', 'clear'),
  edge('school-classroom', 'school-canteen', 'muffled'),
  edge('school-canteen', 'school-playground', 'muffled'),
  edge('office-floor', 'office-lobby', 'muffled'),
  edge('mall-atrium', 'mall-cafe', 'clear'),
  edge('mall-atrium', 'mall-shop', 'clear'),
  edge('mall-cafe', 'mall-shop', 'muffled'),
  edge('hospital-lobby', 'hospital-clinic', 'muffled'),
  edge('park-lawn', 'park-riverside', 'clear'),
]

let initialization: Promise<void> | undefined
export function ensureLocationsInitialized() {
  if (!initialization) initialization = (async () => {
    const existingMap = await db.worldMaps.get('active')
    const map = existingMap ?? createWorldMap(MAP_SEED)
    if (!existingMap) await db.worldMaps.put(map)
    const existingLocations = await db.locations.toArray()
    const existingLocationIds = new Set(existingLocations.map((item) => item.id))
    const missingLocations = LOCATION_SEEDS.filter((item) => !existingLocationIds.has(item.id))
    if (missingLocations.length) {
      const bindings = placeBuildings(map, ROOT_SPECS)
      const now = Date.now()
      await db.locations.bulkPut(missingLocations.map((item) => ({ ...item, mapBinding: bindings.get(item.id), createdAt: now, updatedAt: now })))
    }
    const existingEdgeIds = new Set((await db.acousticEdges.toArray()).map((item) => item.id))
    const missingEdges = ACOUSTIC_SEEDS.filter((item) => !existingEdgeIds.has(item.id))
    if (missingEdges.length) await db.acousticEdges.bulkPut(missingEdges)
    if (!await db.locationModuleState.get('active')) await db.locationModuleState.put({ id: 'active', updatedAt: Date.now() })
  })().finally(() => { initialization = undefined })
  return initialization
}

export function childLocations(parentId: string, locations: LocationNode[]) {
  return locations.filter((item) => item.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder)
}

export function isLeafLocation(id: string, locations: LocationNode[]) {
  return !locations.some((item) => item.parentId === id)
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function covers(block: Pick<ScheduleBlock, 'dayOfWeek' | 'startHour' | 'endHour'>, now: Date) {
  const day = now.getDay(), hour = now.getHours()
  if (block.startHour < block.endHour) return block.dayOfWeek === day && hour >= block.startHour && hour < block.endHour
  return (block.dayOfWeek === day && hour >= block.startHour) || (block.dayOfWeek === (day + 6) % 7 && hour < block.endHour)
}

function activeSchedule(contact: Contact, now: Date): ScheduleBlock | ScheduleOverride | undefined {
  const hour = now.getHours()
  const override = (contact.scheduleOverrides ?? []).find((item) => item.date === localDateKey(now) && hour >= item.startHour && hour < item.endHour)
  return override ?? (contact.schedule ?? []).find((item) => covers(item, now))
}

const KEYWORD_LOCATIONS: Array<[RegExp, string[]]> = [
  [/卧室|客厅|家里|在家|住宅|睡觉/, ['home-living', 'home-kitchen']],
  [/厨房|做饭/, ['home-kitchen']],
  [/学校|教室|上课|自习/, ['school-classroom']],
  [/食堂|吃饭|午餐|晚餐/, ['school-canteen', 'mall-cafe']],
  [/操场|体育课|运动/, ['school-playground', 'park-lawn']],
  [/公司|办公室|办公|上班|工作/, ['office-floor', 'office-lobby']],
  [/咖啡/, ['mall-cafe']],
  [/商场|购物|逛街|商店/, ['mall-atrium', 'mall-shop']],
  [/医院|门诊|看病/, ['hospital-lobby', 'hospital-clinic']],
  [/公园|草坪|野餐/, ['park-lawn', 'park-riverside']],
  [/河边|步道|散步/, ['park-riverside', 'beach-boardwalk']],
  [/海|沙滩/, ['beach-boardwalk']],
  [/山|登山|观景/, ['mountain-lookout']],
  [/农场|农田/, ['farm-field']],
]

function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return hash >>> 0
}

export function mapNaturalLocation(text: string, contactId: string, timeKey: string, validLocationIds: Set<string>): string | undefined {
  for (const [pattern, candidates] of KEYWORD_LOCATIONS) {
    if (!pattern.test(text)) continue
    const valid = candidates.filter((id) => validLocationIds.has(id))
    if (valid.length) return valid[stableHash(`${contactId}:${timeKey}:${text}`) % valid.length]
  }
  return undefined
}

export function resolveContactLocationAt(contact: Contact, now: Date, validLocationIds: Set<string>): { locationId: string; source: 'schedule' | 'manual' | 'fallback' } {
  if (contact.locationSource === 'manual' && contact.currentLocationId && validLocationIds.has(contact.currentLocationId)) return { locationId: contact.currentLocationId, source: 'manual' }
  const schedule = activeSchedule(contact, now)
  if (schedule?.locationId && validLocationIds.has(schedule.locationId)) return { locationId: schedule.locationId, source: 'schedule' }
  const timeKey = `${localDateKey(now)}:${schedule?.id ?? Math.floor(now.getHours() / 4)}`
  const mapped = mapNaturalLocation(`${schedule?.location ?? ''} ${schedule?.activity ?? ''}`, contact.id, timeKey, validLocationIds)
  if (mapped) return { locationId: mapped, source: 'schedule' }
  const fallback = ['home-living', 'mall-atrium', 'park-lawn', 'office-lobby'].filter((id) => validLocationIds.has(id))
  return { locationId: fallback[stableHash(`${contact.id}:${timeKey}`) % fallback.length] ?? [...validLocationIds][0], source: 'fallback' }
}

export async function syncContactLocationsAt(now = new Date()) {
  await ensureLocationsInitialized()
  const [locations, contacts] = await Promise.all([db.locations.toArray(), db.contacts.toArray().then((items) => items.filter((item) => !isAiTestId(item.id)))])
  const leafIds = new Set(locations.filter((item) => isLeafLocation(item.id, locations)).map((item) => item.id))
  const updates = contacts.map((contact) => ({ contact, resolved: resolveContactLocationAt(contact, now, leafIds) }))
    .filter(({ contact, resolved }) => contact.currentLocationId !== resolved.locationId || contact.locationSource !== resolved.source)
  if (updates.length) await db.contacts.bulkUpdate(updates.map(({ contact, resolved }) => ({ key: contact.id, changes: { currentLocationId: resolved.locationId, locationSource: resolved.source, locationUpdatedAt: now.getTime() } })))
  return updates.length
}

export interface LocationParticipants {
  here: Contact[]
  audible: Array<{ contact: Contact; audibility: 'clear' | 'muffled' }>
  away: Contact[]
  activeMembers: Contact[]
}

export async function resolveLocationParticipants(locationId: string): Promise<LocationParticipants> {
  await ensureLocationsInitialized()
  const [contacts, edges] = await Promise.all([db.contacts.toArray().then((items) => items.filter((item) => !isAiTestId(item.id))), db.acousticEdges.toArray()])
  const audibleByLocation = new Map<string, 'clear' | 'muffled'>()
  for (const item of edges) {
    if (item.audibility === 'none') continue
    if (item.fromLocationId === locationId) audibleByLocation.set(item.toLocationId, item.audibility)
    if (item.bidirectional && item.toLocationId === locationId) audibleByLocation.set(item.fromLocationId, item.audibility)
  }
  const here: Contact[] = [], audible: LocationParticipants['audible'] = [], away: Contact[] = []
  for (const contact of contacts) {
    if (contact.currentLocationId === locationId) here.push(contact)
    else {
      const audibility = contact.currentLocationId ? audibleByLocation.get(contact.currentLocationId) : undefined
      if (audibility) audible.push({ contact, audibility })
      else away.push(contact)
    }
  }
  return { here, audible, away, activeMembers: [...here, ...audible.map((item) => item.contact)] }
}

export function locationCounts(contacts: Contact[], locations: LocationNode[]) {
  const direct = new Map<string, number>()
  for (const contact of contacts) if (contact.currentLocationId) direct.set(contact.currentLocationId, (direct.get(contact.currentLocationId) ?? 0) + 1)
  const byId = new Map(locations.map((item) => [item.id, item]))
  const aggregate = new Map(direct)
  for (const [id, count] of direct) {
    let parentId = byId.get(id)?.parentId
    while (parentId) {
      aggregate.set(parentId, (aggregate.get(parentId) ?? 0) + count)
      parentId = byId.get(parentId)?.parentId
    }
  }
  return aggregate
}

export async function enterLocation(locationId: string) {
  await syncContactLocationsAt(new Date())
  const [location, allLocations] = await Promise.all([db.locations.get(locationId), db.locations.toArray()])
  if (!location || !isLeafLocation(location.id, allLocations)) throw new Error('请选择建筑内的具体地点')
  const participants = await resolveLocationParticipants(location.id)
  const now = Date.now()
  const existingGroup = await db.groups.get(LOCATION_GROUP_ID)
  await db.transaction('rw', db.groups, db.conversations, db.locationModuleState, async () => {
    await db.groups.put({
      id: LOCATION_GROUP_ID, name: '地点群聊', avatar: '📍', avatarColor: '#7c3aed',
      memberContactIds: participants.activeMembers.map((contact) => contact.id),
      memory: existingGroup?.memory, vibe: existingGroup?.vibe,
      speakerLimit: existingGroup?.speakerLimit ?? 3, allowAiChatter: existingGroup?.allowAiChatter ?? true,
      energyLevel: existingGroup?.energyLevel ?? 'normal', memoryTurnCount: existingGroup?.memoryTurnCount,
      memoryMessageCursor: existingGroup?.memoryMessageCursor, momentSharing: existingGroup?.momentSharing ?? 'private',
      createdAt: existingGroup?.createdAt ?? now, kind: 'location', locationId: location.id,
    })
    const existingConversation = await db.conversations.get(LOCATION_CONVERSATION_ID)
    await db.conversations.put({ id: LOCATION_CONVERSATION_ID, groupId: LOCATION_GROUP_ID, pinned: true, systemPinned: true, createdAt: existingConversation?.createdAt ?? now, updatedAt: now, lastReadAt: existingConversation?.lastReadAt })
    await db.locationModuleState.put({ id: 'active', currentLocationId: location.id, updatedAt: now })
  })
  return LOCATION_CONVERSATION_ID
}

export function realSeason(date = new Date()) {
  const month = date.getMonth() + 1
  if (month >= 3 && month <= 5) return '春季'
  if (month >= 6 && month <= 8) return '夏季'
  if (month >= 9 && month <= 11) return '秋季'
  return '冬季'
}
