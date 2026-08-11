import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TopBar } from '../components/TopBar'
import { useSettingsStore } from '../store/useSettingsStore'
import { chatCompletionText as chatCompletion } from '../lib/deepseek'
import { buildShopPrompt, parseShopProducts, type GeneratedProduct } from '../lib/shop'
import { formatCurrency } from '../lib/wallet'
import { api } from '../lib/api/resources'
import { getOrUndef } from '../lib/api/client'
import { USER_WALLET_ID } from '../lib/finance'
import { purchaseInventoryProduct } from '../lib/inventory'
import type { ShopPurchaseHistory } from '../types'

export function ShopPage() {
  const settings = useSettingsStore()
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState<GeneratedProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [repurchaseOpen, setRepurchaseOpen] = useState(false)
  const [buyingKey, setBuyingKey] = useState('')
  const { data: wallet } = useQuery({ queryKey: ['walletAccounts', USER_WALLET_ID], queryFn: () => getOrUndef(api.walletAccounts.get(USER_WALLET_ID)) })
  const { data: purchaseHistory = [] } = useQuery({ queryKey: ['shopPurchaseHistory'], queryFn: () => api.shopPurchaseHistory.list() })

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 1800)
    return () => clearTimeout(t)
  }, [toast])

  async function generate(searchQuery: string | null) {
    if (!settings.apiKey) {
      setError('还没有配置API Key 请先去"我-设置"里填写')
      return
    }
    setLoading(true)
    setError('')
    try {
      const shopPrompt = buildShopPrompt(searchQuery, settings)
      if (!shopPrompt.trim()) throw new Error('商城提示词模块已屏蔽')
      const raw = await chatCompletion({
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.utilityModel,
        messages: [
          { role: 'system', content: shopPrompt },
          { role: 'user', content: searchQuery ?? '推荐一些商品' },
        ],
        jsonMode: true,
      })
      const list = parseShopProducts(raw)
      if (list.length === 0) throw new Error('没有生成出商品 换个词再试试')
      setProducts(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleBuy(product: GeneratedProduct) {
    if ((wallet?.balance ?? 0) < product.price) {
      setToast('金币不够啦')
      return
    }
    await purchaseInventoryProduct(product)
    setToast(`已购买「${product.name}」`)
  }

  async function handleRepurchase(product: ShopPurchaseHistory) {
    if (buyingKey) return
    if ((wallet?.balance ?? 0) < product.price) {
      setToast('金币不够啦')
      return
    }
    setBuyingKey(product.productKey)
    try {
      await purchaseInventoryProduct(product, `复购：${product.name}`)
      setToast(`已复购「${product.name}」`)
    } catch (err) {
      setToast(err instanceof Error ? err.message : '复购失败')
    } finally {
      setBuyingKey('')
    }
  }

  return (
    <div className="relative flex h-[var(--app-height)] flex-col overflow-hidden bg-[#f4f4f6]">
      <TopBar
        title="商城"
        showBack
        right={<span className="pr-1 text-sm text-gray-500">{formatCurrency(wallet?.balance ?? 0, settings)}</span>}
      />
      <div className="flex-1 overflow-y-auto">

      <div className="flex gap-2 px-4 pt-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void generate(query.trim() || null)
            }
          }}
          placeholder="搜索想买的东西"
          className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
        />
        <button
          onClick={() => generate(query.trim() || null)}
          disabled={loading}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          {loading ? '生成中…' : '搜索'}
        </button>
      </div>

      <div className="mx-4 mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => generate(null)} disabled={loading} className="rounded-lg bg-white py-2.5 text-sm text-gray-600 shadow-sm disabled:opacity-40">
          {loading && !query.trim() ? '生成中…' : '随便逛逛'}
        </button>
        <button onClick={() => setRepurchaseOpen(true)} className="rounded-lg bg-white py-2.5 text-sm text-gray-600 shadow-sm">
          复购
        </button>
      </div>

      {error && <p className="mx-4 mt-3 text-xs text-red-500">{error}</p>}

      <div className="mt-3 flex-1 px-4 pb-4">
        {products.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {products.map((p, i) => (
              <div key={i} className="rounded-xl bg-white p-3">
                <div className="mb-2 flex h-16 items-center justify-center rounded-lg bg-gray-50 text-3xl">
                  {p.icon}
                </div>
                <p className="truncate text-sm font-medium text-gray-900">{p.name}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-gray-400">{p.description}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--ui-special-ink)]">{formatCurrency(p.price, settings)}</span>
                  <button
                    onClick={() => handleBuy(p)}
                    className="rounded-lg bg-gray-900 px-2.5 py-1 text-xs text-white"
                  >
                    购买
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>

      {toast && (
        <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-xs text-white">
          {toast}
        </p>
      )}

      {repurchaseOpen && (
        <div className="absolute inset-0 z-30 flex items-end bg-black/30" onClick={() => setRepurchaseOpen(false)}>
          <div className="max-h-[76%] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h2 className="text-[15px] font-medium text-gray-900">以前买过</h2><button type="button" onClick={() => setRepurchaseOpen(false)} className="text-sm text-gray-500">关闭</button></div>
            {purchaseHistory.length === 0 ? <p className="py-8 text-center text-sm text-gray-400">还没有购买记录</p> : <div className="space-y-2">{purchaseHistory.map((item) => <div key={item.productKey} className="flex items-center gap-3 rounded-xl bg-gray-50 p-3"><span className="text-3xl">{item.icon}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-gray-900">{item.name}</p><p className="mt-0.5 line-clamp-1 text-xs text-gray-400">{item.description}</p><p className="mt-1 text-xs text-[var(--ui-special-ink)]">{formatCurrency(item.price, settings)}</p></div><button type="button" onClick={() => void handleRepurchase(item)} disabled={!!buyingKey} className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-xs text-white disabled:opacity-40">{buyingKey === item.productKey ? '购买中' : '购买'}</button></div>)}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
