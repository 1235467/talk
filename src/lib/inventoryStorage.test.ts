// @ts-nocheck — 非核心功能迁移完成前休眠（见 db/unmigrated.ts）
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/unmigrated'
import { addInventoryProduct, consumeInventoryItem } from './inventory'

beforeEach(async () => {
  await db.open()
  await db.inventory.clear()
  await db.shopPurchaseHistory.clear()
})

// TODO(server-migration): 非核心功能（金融/仓库/AI测试）尚未迁移到服务器，恢复时去掉 .skip
describe.skip('one-card-per-item inventory', () => {
  it('creates separate cards while keeping one repurchase history entry', async () => {
    const product = { name: '热可可', description: '冬日饮品', icon: '☕', price: 18 }
    await addInventoryProduct(product)
    await addInventoryProduct(product)

    expect(await db.inventory.count()).toBe(2)
    expect(await db.shopPurchaseHistory.count()).toBe(1)
    expect((await db.shopPurchaseHistory.toArray())[0]?.purchaseCount).toBe(2)
  })

  it('removes exactly one card when an item is consumed', async () => {
    const first = await addInventoryProduct({ name: '礼物', description: '测试', icon: '🎁', price: 10 })
    await addInventoryProduct({ name: '礼物', description: '测试', icon: '🎁', price: 10 })

    expect(await consumeInventoryItem(first.id)).toBe(true)
    expect(await db.inventory.count()).toBe(1)
    expect(await db.shopPurchaseHistory.count()).toBe(1)
  })
})
