import type { LocationMapBinding, LocationNode, TerrainType, WorldMapRecord } from '../types'

export const MAP_SIZE = 48 as const
export const MAP_GENERATOR_VERSION = 3 as const
export const MIN_LOCATION_DISTANCE = 2 as const
const GENERATED_LOCATION_DISTANCE = 3

export const TERRAIN_LABELS: Record<TerrainType, string> = {
  river: '水域', grassland: '草地', beach: '沙滩', hill: '丘陵', mountain: '山地', urban: '城区', rural: '乡村',
}

export const TERRAIN_COLORS: Record<TerrainType, string> = {
  river: '#59a9d8', grassland: '#84bd72', beach: '#dfca88', hill: '#91a96c', mountain: '#71806f', urban: '#c7ccc3', rural: '#adbf72',
}

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

const tileIndex = (x: number, y: number, width: number = MAP_SIZE) => y * width + x

/** Legacy deterministic generator kept for imported v1 maps and its regression test. */
export function generateTerrain(seedText: string): TerrainType[] {
  return generateStructuredTerrain(seedText)
}

/**
 * One stable pixel-city style. Rules own the large regions; noise only softens their borders.
 * The urban ellipse deliberately covers most buildable land so spaced city POIs still fit.
 */
export function generateStructuredTerrain(seedText: string, width = MAP_SIZE, height = MAP_SIZE): TerrainType[] {
  const seed = seedHash(seedText)
  const tiles: TerrainType[] = Array.from({ length: width * height }, () => 'grassland')
  const city = { x: width * 0.46, y: height * 0.50 }

  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const n = fbm(seed, x / 11, y / 11)
    const cityDistance = Math.hypot((x - city.x) / (width * 0.43), (y - city.y) / (height * 0.40))
    const ridge = 1 - Math.hypot((x - width * 0.13) / (width * 0.24), (y - height * 0.12) / (height * 0.30))
    const elevation = ridge * 0.78 + n * 0.42
    const index = tileIndex(x, y, width)
    if (elevation > 0.72) tiles[index] = 'mountain'
    else if (elevation > 0.50) tiles[index] = 'hill'
    else if (cityDistance + (n - 0.5) * 0.18 < 1) tiles[index] = 'urban'
    else if (cityDistance < 1.34 || n > 0.56) tiles[index] = 'rural'
  }

  // A readable river stays east of the dense city and opens into a small south-east bay.
  for (let y = 0; y < height; y += 1) {
    const riverX = Math.round(width * 0.77 + Math.sin((y + (seed % 11)) / 5.4) * 2.5)
    const halfWidth = y > height * 0.72 ? 2 : 1
    for (let dx = -halfWidth; dx <= halfWidth; dx += 1) {
      const x = riverX + dx
      if (x >= 0 && x < width) tiles[tileIndex(x, y, width)] = 'river'
    }
  }
  for (let y = Math.floor(height * 0.78); y < height; y += 1) for (let x = Math.floor(width * 0.79); x < width; x += 1) {
    const coast = x - width * 0.79 + (y - height * 0.78) * 0.5
    if (coast > width * 0.075) tiles[tileIndex(x, y, width)] = 'river'
    else if (coast > width * 0.01) tiles[tileIndex(x, y, width)] = 'beach'
  }

  return tiles
}

export function createWorldMap(seed: string): WorldMapRecord {
  const now = Date.now()
  return {
    id: 'active', width: MAP_SIZE, height: MAP_SIZE, seed, generatorVersion: MAP_GENERATOR_VERSION, mode: 'fixed',
    tiles: generateStructuredTerrain(seed),
    roads: [
      { kind: 'primary', points: [{ x: 4, y: 34 }, { x: 14, y: 28 }, { x: 23, y: 23 }, { x: 34, y: 21 }, { x: 43, y: 17 }] },
      { kind: 'primary', points: [{ x: 12, y: 9 }, { x: 19, y: 17 }, { x: 23, y: 23 }, { x: 27, y: 35 }, { x: 30, y: 45 }] },
      { kind: 'secondary', points: [{ x: 7, y: 24 }, { x: 18, y: 22 }, { x: 30, y: 27 }, { x: 41, y: 32 }] },
    ],
    createdAt: now, updatedAt: now,
  }
}

const IDEALS: Record<string, { x: number; y: number }> = {
  residence: { x: .32, y: .55 }, apartment: { x: .40, y: .52 }, dormitory: { x: .29, y: .36 }, villa: { x: .18, y: .68 },
  school: { x: .30, y: .34 }, university: { x: .22, y: .29 }, office: { x: .50, y: .46 }, mall: { x: .57, y: .43 },
  hospital: { x: .34, y: .61 }, park: { x: .63, y: .61 }, beach: { x: .82, y: .80 }, scenic: { x: .12, y: .13 }, hill: { x: .20, y: .22 },
  farm: { x: .16, y: .82 }, factory: { x: .61, y: .73 }, station: { x: .58, y: .31 }, harbor: { x: .75, y: .60 }, village: { x: .22, y: .78 },
  library: { x: .43, y: .37 }, police: { x: .47, y: .56 }, 'city-hall': { x: .50, y: .50 }, cinema: { x: .59, y: .49 }, market: { x: .38, y: .67 }, custom: { x: .48, y: .50 },
}

export function defaultTerrainsForIcon(iconId: string): TerrainType[] {
  if (iconId === 'scenic') return ['mountain']
  if (iconId === 'hill') return ['hill']
  if (iconId === 'beach') return ['beach']
  if (iconId === 'harbor') return ['beach', 'grassland', 'rural']
  if (['farm', 'village', 'villa', 'camp'].includes(iconId)) return ['rural', 'grassland', 'hill']
  if (['park', 'forest'].includes(iconId)) return ['grassland', 'rural', 'hill']
  return ['urban', 'rural']
}

export function isLocationPlacementAvailable(point: { x: number; y: number }, locations: LocationNode[], map: WorldMapRecord, excludeId?: string, allowedTerrains?: TerrainType[]) {
  if (point.x < 0 || point.y < 0 || point.x >= map.width || point.y >= map.height) return false
  const terrain = map.tiles[tileIndex(point.x, point.y, map.width)]
  if (allowedTerrains && !allowedTerrains.includes(terrain)) return false
  return locations.filter((item) => item.id !== excludeId && item.mapBinding).every((item) => (
    Math.max(Math.abs(item.mapBinding!.x - point.x), Math.abs(item.mapBinding!.y - point.y)) >= MIN_LOCATION_DISTANCE
  ))
}

export function placeBuildings(map: WorldMapRecord, specs: Array<{ id: string; allowedTerrains: TerrainType[]; buildingCategory: string }>) {
  const used: LocationMapBinding[] = []
  const result = new Map<string, LocationMapBinding>()
  for (const spec of specs) {
    const ideal = IDEALS[spec.buildingCategory] ?? IDEALS.custom
    const candidates = map.tiles.map((terrain, index) => ({ terrain, x: index % map.width, y: Math.floor(index / map.width) }))
      .filter((tile) => spec.allowedTerrains.includes(tile.terrain) && used.every((item) => Math.max(Math.abs(item.x - tile.x), Math.abs(item.y - tile.y)) >= GENERATED_LOCATION_DISTANCE))
      .sort((a, b) => {
        const score = (tile: typeof a) => Math.hypot(tile.x / map.width - ideal.x, tile.y / map.height - ideal.y) + random01(seedHash(`${map.seed}:${spec.id}`), tile.x, tile.y) * 0.16
        return score(a) - score(b)
      })
    const candidate = candidates[0]
    if (!candidate) continue
    const binding = { x: candidate.x, y: candidate.y, allowedTerrains: spec.allowedTerrains, buildingCategory: spec.buildingCategory, iconId: spec.buildingCategory }
    used.push(binding); result.set(spec.id, binding)
  }
  return result
}

export function createUpgradedWorldMap(previous: WorldMapRecord, seed = previous.seed) {
  const next = createWorldMap(seed)
  next.createdAt = previous.createdAt
  return next
}
