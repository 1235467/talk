import { describe, expect, it } from 'vitest'
import { createWorldMap, generateTerrain, placeBuildings } from './locationMap'

describe('location map', () => {
  it('generates the same terrain for the same seed', () => {
    expect(generateTerrain('talk-map')).toEqual(generateTerrain('talk-map'))
    expect(generateTerrain('talk-map')).toHaveLength(32 * 32)
  })

  it('places buildings only on allowed terrain and keeps them separated', () => {
    const map = createWorldMap('talk-map')
    const specs = [
      { id: 'city-a', allowedTerrains: ['urban' as const], buildingCategory: 'mall' },
      { id: 'city-b', allowedTerrains: ['urban' as const], buildingCategory: 'hospital' },
      { id: 'park', allowedTerrains: ['grassland' as const], buildingCategory: 'park' },
    ]
    const result = placeBuildings(map, specs)
    const rows = [...result.values()]
    expect(rows).toHaveLength(specs.length)
    for (const row of rows) expect(row.allowedTerrains).toContain(map.tiles[row.y * 32 + row.x])
    for (let a = 0; a < rows.length; a += 1) for (let b = a + 1; b < rows.length; b += 1) {
      expect(Math.max(Math.abs(rows[a].x - rows[b].x), Math.abs(rows[a].y - rows[b].y))).toBeGreaterThanOrEqual(3)
    }
  })
})
