import { describe, expect, it } from 'vitest'
import { inventoryProductKey } from './inventory'

describe('inventory product compatibility', () => {
  it('uses a stable key for visually identical generated products', () => {
    expect(inventoryProductKey({ name: '  热 可可 ', description: '冬日  饮品', icon: '☕', price: 18 }))
      .toBe(inventoryProductKey({ name: '热 可可', description: '冬日 饮品', icon: '☕', price: 18 }))
  })
})
