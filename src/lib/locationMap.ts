import type { LocationMapBinding, TerrainType, WorldMapRecord } from '../types'

export const MAP_SIZE = 32 as const
export const TERRAIN_COLORS: Record<TerrainType, string> = {
  river: '#4aa3df', grassland: '#7dbe65', beach: '#e8d38a', mountain: '#8a8f98', urban: '#a9a9b3', rural: '#b6c978',
}
export const TERRAIN_LABELS: Record<TerrainType, string> = {
  river: '河流', grassland: '草地', beach: '沙滩', mountain: '山地', urban: '城区', rural: '乡村',
}

function seedHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
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
    total += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  return value / total
}
const tileIndex = (x: number, y: number) => y * MAP_SIZE + x

export function generateTerrain(seedText: string): TerrainType[] {
  const seed = seedHash(seedText)
  const elevations = Array.from({ length: MAP_SIZE * MAP_SIZE }, (_, index) => {
    const x = index % MAP_SIZE, y = Math.floor(index / MAP_SIZE)
    const dx = (x - 15.5) / 22, dy = (y - 15.5) / 22
    return fbm(seed, x / 10, y / 10) * 0.82 + Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy)) * 0.18
  })
  const sorted = [...elevations].sort((a, b) => a - b)
  const mountain = sorted[Math.floor(sorted.length * 0.82)]
  const tiles: TerrainType[] = elevations.map((height) => height >= mountain ? 'mountain' : 'grassland')

  let current = elevations.map((height, index) => ({ height, index }))
    .filter(({ index }) => index % MAP_SIZE > 5 && index % MAP_SIZE < 26 && Math.floor(index / MAP_SIZE) > 5 && Math.floor(index / MAP_SIZE) < 26)
    .sort((a, b) => b.height - a.height)[0]?.index ?? tileIndex(16, 16)
  const river = new Set<number>()
  for (let step = 0; step < 90; step += 1) {
    river.add(current)
    const x = current % MAP_SIZE, y = Math.floor(current / MAP_SIZE)
    if (x === 0 || y === 0 || x === 31 || y === 31) break
    const neighbors: number[] = []
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (dx || dy) neighbors.push(tileIndex(x + dx, y + dy))
    const next = neighbors.filter((index) => !river.has(index)).sort((a, b) => {
      const ax = a % 32, ay = Math.floor(a / 32), bx = b % 32, by = Math.floor(b / 32)
      const edgeA = Math.min(ax, ay, 31 - ax, 31 - ay), edgeB = Math.min(bx, by, 31 - bx, 31 - by)
      return elevations[a] * 2 + edgeA * 0.016 + random01(seed + 77, ax, ay) * 0.05 - (elevations[b] * 2 + edgeB * 0.016 + random01(seed + 77, bx, by) * 0.05)
    })[0]
    if (next === undefined) break
    current = next
  }
  for (const index of river) tiles[index] = 'river'
  for (const index of river) {
    const x = index % 32, y = Math.floor(index / 32)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < 32 && ny < 32 && tiles[tileIndex(nx, ny)] === 'grassland') tiles[tileIndex(nx, ny)] = 'beach'
    }
  }
  const flat = tiles.map((terrain, index) => ({ terrain, index, score: fbm(seed + 9001, (index % 32) / 12, Math.floor(index / 32) / 12) }))
    .filter((item) => item.terrain === 'grassland').sort((a, b) => b.score - a.score)
  for (const item of flat.slice(0, Math.max(1, Math.floor(flat.length * 0.14)))) tiles[item.index] = 'urban'
  for (const item of flat.filter((item) => tiles[item.index] === 'grassland').slice(0, Math.max(1, Math.floor(flat.length * 0.22)))) tiles[item.index] = 'rural'
  return tiles
}

export function createWorldMap(seed: string): WorldMapRecord {
  const now = Date.now()
  return { id: 'active', width: 32, height: 32, seed, generatorVersion: 1, mode: 'fixed', tiles: generateTerrain(seed), createdAt: now, updatedAt: now }
}

export function placeBuildings(map: WorldMapRecord, specs: Array<{ id: string; allowedTerrains: TerrainType[]; buildingCategory: string }>) {
  const used: LocationMapBinding[] = []
  const result = new Map<string, LocationMapBinding>()
  for (const spec of specs) {
    const candidates = map.tiles.map((terrain, index) => ({ terrain, x: index % 32, y: Math.floor(index / 32) }))
      .filter((tile) => spec.allowedTerrains.includes(tile.terrain) && used.every((item) => Math.max(Math.abs(item.x - tile.x), Math.abs(item.y - tile.y)) >= 3))
      .sort((a, b) => random01(seedHash(`${map.seed}:${spec.id}`), a.x, a.y) - random01(seedHash(`${map.seed}:${spec.id}`), b.x, b.y))
    const candidate = candidates[0]
    if (!candidate) continue
    const binding = { x: candidate.x, y: candidate.y, allowedTerrains: spec.allowedTerrains, buildingCategory: spec.buildingCategory }
    used.push(binding)
    result.set(spec.id, binding)
  }
  return result
}
