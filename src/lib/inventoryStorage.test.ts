import { beforeEach, describe, expect, it } from 'vitest'
import { resetFakeServer } from '../test/setup'
import { api } from './api/resources'
import { addInventoryProduct, consumeInventoryItem, purchaseInventoryProduct } from './inventory'

beforeEach(() => {
  localStorage.clear()
  resetFakeServer()
})

describe('one-card-per-item inventory', () => {
  it('creates separate cards while keeping one repurchase history entry', async () => {
    const product = { name: '热可可', description: '冬日饮品', icon: '☕', price: 18 }
    await addInventoryProduct(product)
    await addInventoryProduct(product)

    expect((await api.inventory.list()).length).toBe(2)
    const history = await api.shopPurchaseHistory.list()
    expect(history.length).toBe(1)
    expect(history[0]?.purchaseCount).toBe(2)
  })

  it('removes exactly one card when an item is consumed', async () => {
    const first = await addInventoryProduct({ name: '礼物', description: '测试', icon: '🎁', price: 10 })
    await addInventoryProduct({ name: '礼物', description: '测试', icon: '🎁', price: 10 })

    expect(await consumeInventoryItem(first.id)).toBe(true)
    expect(await consumeInventoryItem(first.id)).toBe(false)
    expect((await api.inventory.list()).length).toBe(1)
    expect((await api.shopPurchaseHistory.list()).length).toBe(1)
  })

  it('purchase charges the wallet and stacks the history atomically', async () => {
    await api.walletAccounts.put({ ownerId: 'user', balance: 100, updatedAt: 1 })
    const product = { name: '热可可', description: '冬日饮品', icon: '☕', price: 18 }

    await purchaseInventoryProduct(product)
    await purchaseInventoryProduct(product, '复购：热可可')

    expect((await api.walletAccounts.get('user')).balance).toBe(64)
    expect((await api.inventory.list()).length).toBe(2)
    expect((await api.shopPurchaseHistory.list())[0]?.purchaseCount).toBe(2)
  })

  it('rejects a purchase the wallet cannot afford', async () => {
    await api.walletAccounts.put({ ownerId: 'user', balance: 5, updatedAt: 1 })

    await expect(purchaseInventoryProduct({ name: '豪车', description: 'x', icon: '🚗', price: 99999 })).rejects.toThrow('余额不足')
    expect((await api.inventory.list()).length).toBe(0)
    expect((await api.walletAccounts.get('user')).balance).toBe(5)
  })
})
