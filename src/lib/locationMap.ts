import type { LocationMapBinding, TerrainType, WorldMapRecord } from '../types'
import { DEFAULT_LOCATION_THEME_ID, getLocationTheme } from './locationThemes'

export const MAP_SIZE = 32 as const
export const TERRAIN_LABELS: Record<TerrainType, string> = {
  river: '水域', grassland: '草地', beach: '沙滩', mountain: '山地', urban: '城区', rural: '乡村',
}
/** Legacy export used by settings/legend code. New rendering resolves colors from the active theme. */
export const TERRAIN_COLORS = getLocationTheme(DEFAULT_LOCATION_THEME_ID).palette

function seedHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return hash >>> 0
}

function random01(seed: number, x: number, y: number) {
  let hash = seed ^ Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1274126177, 2246822519)
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177)
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295
}

function smooth(value: number) { return value * value * (3 - 2 * value) }
function valueNoise(seed: number, x: number, y: number) {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = smooth(x - x0), ty = smooth(y - y0)
  const a = random01(seed, x0, y0), b = random01(seed, x0 + 1, y0)
  const c = random01(seed, x0, y0 + 1), d = random01(seed, x0 + 1, y0 + 1)
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty
}
function fbm(seed: number, x: number, y: number) {
  let value = 0, amplitude = 0.5, frequency = 1, total = 0
  for (let index = 0; index < 4; index += 1) {
    value += valueNoise(seed + index * 1013, x * frequency, y * frequency) * amplitude
    total += amplitude; amplitude *= 0.5; frequency *= 2
  }
  return value / total
}
const tileIndex = (x: number, y: number, width = MAP_SIZE) => y * width + x

/** v1 is kept deterministic so existing maps and tests remain reproducible. */
export function generateTerrain(seedText: string): TerrainType[] {
  const seed = seedHash(seedText)
  const elevations = Array.from({ length: MAP_SIZE * MAP_SIZE }, (_, index) => fbm(seed, (index % MAP_SIZE) / 10, Math.floor(index / MAP_SIZE) / 10))
  const sorted = [...elevations].sort((a, b) => a - b)
  const mountain = sorted[Math.floor(sorted.length * 0.82)]
  const tiles: TerrainType[] = elevations.map((height) => height >= mountain ? 'mountain' : 'grassland')
  let current = elevations.map((height, index) => ({ height, index })).filter(({ index }) => index % MAP_SIZE > 5 && index % MAP_SIZE < 26 && Math.floor(index / MAP_SIZE) > 5 && Math.floor(index / MAP_SIZE) < 26).sort((a, b) => b.height - a.height)[0]?.index ?? tileIndex(16, 16)
  const river = new Set<number>()
  for (let step = 0; step < 90; step += 1) {
    river.add(current)
    const x = current % MAP_SIZE, y = Math.floor(current / MAP_SIZE)
    if (x === 0 || y === 0 || x === 31 || y === 31) break
    const neighbors: number[] = []
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (dx || dy) neighbors.push(tileIndex(x + dx, y + dy))
    const next = neighbors.filter((index) => !river.has(index)).sort((a, b) => elevations[a] - elevations[b])[0]
    if (next === undefined) break
    current = next
  }
  for (const index of river) tiles[index] = 'river'
  const flat = tiles.map((terrain, index) => ({ terrain, index, score: fbm(seed + 9001, (index % 32) / 12, Math.floor(index / 32) / 12) })).filter((item) => item.terrain === 'grassland').sort((a, b) => b.score - a.score)
  for (const item of flat.slice(0, Math.max(1, Math.floor(flat.length * 0.14)))) tiles[item.index] = 'urban'
  for (const item of flat.filter((item) => tiles[item.index] === 'grassland').slice(0, Math.max(1, Math.floor(flat.length * 0.22)))) tiles[item.index] = 'rural'
  return tiles
}

/** Structured v2: noise adds variation, while rules own the city, river and outskirts. */
export function generateStructuredTerrain(seedText: string, width = MAP_SIZE, height = MAP_SIZE): TerrainType[] {
  const seed = seedHash(seedText)
  const tiles: TerrainType[] = Array.from({ length: width * height }, () => 'grassland')
  const center = { x: width * 0.49, y: height * 0.44 }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const n = fbm(seed, x / 9, y / 9)
    const cityDistance = Math.hypot((x - center.x) / (width * 0.34), (y - center.y) / (height * 0.29))
    const mountainField = (width * 0.28 - x) / (width * 0.28) + (height * 0.24 - y) / (height * 0.5) + n * 0.65
    if (mountainField > 0.92) tiles[tileIndex(x, y, width)] = 'mountain'
    else if (cityDistance + (n - 0.5) * 0.28 < 0.78) tiles[tileIndex(x, y, width)] = 'urban'
    else if (cityDistance < 1.32 || n > 0.58) tiles[tileIndex(x, y, width)] = 'rural'
  }
  // A broad, readable river bends through the city and opens into a bay.
  for (let y = 0; y < height; y += 1) {
    const riverX = Math.round(width * 0.71 + Math.sin((y + (seed % 9)) / 4.2) * 2.1)
    const halfWidth = y > height * 0.68 ? 2 : 1
    for (let dx = -halfWidth; dx <= halfWidth; dx += 1) if (riverX + dx >= 0 && riverX + dx < width) tiles[tileIndex(riverX + dx, y, width)] = 'river'
  }
  for (let y = Math.floor(height * 0.72); y < height; y += 1) for (let x = Math.floor(width * 0.72); x < width; x += 1) {
    const coast = x - width * 0.72 + (y - height * 0.72) * 0.55
    if (coast > width * 0.12) tiles[tileIndex(x, y, width)] = 'river'
    else if (coast > width * 0.06 && tiles[tileIndex(x, y, width)] !== 'river') tiles[tileIndex(x, y, width)] = 'beach'
  }
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const index = tileIndex(x, y, width)
    if (tiles[index] === 'river' || tiles[index] === 'mountain' || tiles[index] === 'beach') continue
    const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tiles[tileIndex(x + dx, y + dy, width)] === 'river')
    if (nearWater && random01(seed + 41, x, y) > 0.52) tiles[index] = 'grassland'
  }
  return tiles
}

export function createWorldMap(seed: string): WorldMapRecord {
  const now = Date.now()
  return {
    id: 'active', width: MAP_SIZE, height: MAP_SIZE, seed, generatorVersion: 2, mode: 'fixed',
    themeId: DEFAULT_LOCATION_THEME_ID,
    tiles: generateStructuredTerrain(seed),
    roads: [
      { kind: 'primary', points: [{ x: 3, y: 23 }, { x: 10, y: 19 }, { x: 16, y: 15 }, { x: 23, y: 14 }, { x: 29, y: 11 }] },
      { kind: 'primary', points: [{ x: 8, y: 7 }, { x: 13, y: 12 }, { x: 16, y: 15 }, { x: 18, y: 24 }, { x: 20, y: 30 }] },
      { kind: 'secondary', points: [{ x: 5, y: 16 }, { x: 12, y: 15 }, { x: 20, y: 18 }, { x: 27, y: 22 }] },
    ],
    createdAt: now, updatedAt: now,
  }
}

const IDEALS: Record<string, { x: number; y: number }> = {
  residence: { x: .39, y: .53 }, school: { x: .34, y: .35 }, office: { x: .53, y: .47 }, mall: { x: .61, y: .42 }, hospital: { x: .30, y: .58 }, park: { x: .64, y: .61 }, beach: { x: .72, y: .80 }, scenic: { x: .18, y: .18 }, farm: { x: .18, y: .77 }, custom: { x: .5, y: .5 },
}

export function placeBuildings(map: WorldMapRecord, specs: Array<{ id: string; allowedTerrains: TerrainType[]; buildingCategory: string }>) {
  const used: LocationMapBinding[] = []
  const result = new Map<string, LocationMapBinding>()
  for (const spec of specs) {
    const ideal = IDEALS[spec.buildingCategory] ?? IDEALS.custom
    const candidates = map.tiles.map((terrain, index) => ({ terrain, x: index % map.width, y: Math.floor(index / map.width) }))
      .filter((tile) => spec.allowedTerrains.includes(tile.terrain) && used.every((item) => Math.max(Math.abs(item.x - tile.x), Math.abs(item.y - tile.y)) >= 3))
      .sort((a, b) => {
        const score = (tile: typeof a) => Math.hypot(tile.x / map.width - ideal.x, tile.y / map.height - ideal.y) + random01(seedHash(`${map.seed}:${spec.id}`), tile.x, tile.y) * 0.18
        return score(a) - score(b)
      })
    const candidate = candidates[0]
    if (!candidate) continue
    const binding = { x: candidate.x, y: candidate.y, allowedTerrains: spec.allowedTerrains, buildingCategory: spec.buildingCategory, iconId: spec.buildingCategory }
    used.push(binding); result.set(spec.id, binding)
  }
  return result
}

export function createUpgradedWorldMap(previous: WorldMapRecord) {
  const next = createWorldMap(previous.seed)
  next.createdAt = previous.createdAt
  next.themeId = previous.themeId ?? DEFAULT_LOCATION_THEME_ID
  return next
}
