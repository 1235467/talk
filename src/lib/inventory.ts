import { v4 as uuid } from 'uuid'
import { api } from './api/resources'
import { getOrUndef } from './api/client'
import { invalidate } from './api/keys'
import type { InventoryItem } from '../types'

export interface InventoryProduct {
  name: string
  description: string
  icon: string
  price: number
}

function normalizedPart(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function inventoryProductKey(product: InventoryProduct): string {
  return JSON.stringify([
    normalizedPart(product.name),
    normalizedPart(product.description),
    product.icon.trim(),
    Math.round(product.price * 100) / 100,
  ])
}

function invalidateShop() { invalidate('inventory', 'shopPurchaseHistory', 'walletAccounts', 'walletTransactions') }

/** Add one card per acquisition; the repurchase history stacks by productKey. */
export async function addInventoryProduct(product: InventoryProduct): Promise<InventoryItem> {
  const productKey = inventoryProductKey(product)
  const now = Date.now()
  const result: InventoryItem = {
    id: uuid(),
    productKey,
    name: product.name,
    description: product.description,
    icon: product.icon,
    price: product.price,
    acquiredAt: now,
  }
  await api.inventory.put(result)
  const existing = await getOrUndef(api.shopPurchaseHistory.get(productKey))
  await api.shopPurchaseHistory.put({
    productKey,
    name: product.name,
    description: product.description,
    icon: product.icon,
    price: product.price,
    purchaseCount: (existing?.purchaseCount ?? 0) + 1,
    firstPurchasedAt: existing?.firstPurchasedAt ?? now,
    lastPurchasedAt: now,
  })
  invalidateShop()
  return result
}

export async function consumeInventoryItem(itemId: string): Promise<boolean> {
  if (!(await getOrUndef(api.inventory.get(itemId)))) return false
  await api.inventory.delete(itemId)
  invalidateShop()
  return true
}

/** Atomic server-side purchase: charge the user wallet, add the card, bump the history. */
export async function purchaseInventoryProduct(product: InventoryProduct, note = product.name): Promise<InventoryItem> {
  const item = await api.finance.purchase({ ...product, productKey: inventoryProductKey(product), note })
  invalidateShop()
  return item
}

export async function discardInventoryItem(itemId: string): Promise<void> {
  await api.inventory.delete(itemId)
  invalidateShop()
}
