import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { db } from '../db/db'
import { TopBar } from '../components/TopBar'
import { estimateWorldbookTokens, formatEstimatedTokens } from '../lib/worldbookTokens'
import { useSettingsStore } from '../store/useSettingsStore'

export function WorldSettingsPage() {
  const navigate = useNavigate()
  const settings = useSettingsStore()
  const collections = useLiveQuery(() => db.worldbookCollections.orderBy('updatedAt').reverse().toArray(), []) ?? []
  const entries = useLiveQuery(() => db.worldbookEntries.toArray(), []) ?? []

  useEffect(() => {
    if (!settings.defaultWorldviewId && collections[0]) settings.setSettings({ defaultWorldviewId: collections.find((item) => item.enabled)?.id || collections[0].id })
  }, [collections, settings.defaultWorldviewId, settings.setSettings])

  async function createWorldview() {
    const name = window.prompt('世界观存档名称', '新的世界')?.trim()
    if (!name) return
    const now = Date.now(); const id = uuid()
    await db.worldbookCollections.add({ id, name, enabled: true, sourceType: 'manual', createdAt: now, updatedAt: now })
    if (!settings.defaultWorldviewId) settings.setSettings({ defaultWorldviewId: id })
    void navigate(`/world-settings/${id}`)
  }

  return <div className="relative flex h-[var(--app-height)] flex-col overflow-hidden bg-[#f4f4f6]">
    <TopBar title="世界观" showBack onBack={() => navigate('/discover')} />
    <div className="flex-1 overflow-y-auto px-4 pb-8">
      <section className="mt-3 rounded-xl bg-white p-4">
        <p className="text-sm font-medium text-gray-900">世界观存档</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">世界观是确认后的正史。每个联系人和群聊只属于一个世界，每次生成也只读取一个世界。</p>
        <button type="button" onClick={() => void createWorldview()} className="mt-3 w-full rounded-lg bg-gray-900 py-2.5 text-sm text-white">新建世界观</button>
      </section>

      <section className="mt-3 rounded-xl bg-white p-4">
        <div className="flex items-center justify-between"><div><p className="text-sm font-medium text-gray-900">自动压缩大段资料</p><p className="mt-1 text-[11px] text-gray-400">开启后，单份资料超过阈值才由AI整理；关闭后始终原样加入。</p></div><button type="button" role="switch" aria-checked={settings.autoCompressLibraryImports !== false} onClick={() => settings.setSettings({ autoCompressLibraryImports: settings.autoCompressLibraryImports === false })} className={`relative h-6 w-11 shrink-0 rounded-full ${settings.autoCompressLibraryImports !== false ? 'bg-green-500' : 'bg-gray-200'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${settings.autoCompressLibraryImports !== false ? 'left-5.5' : 'left-0.5'}`}/></button></div>
        <label className="mt-3 block text-xs text-gray-500">压缩阈值（Token）<input type="number" min="200" step="100" value={settings.libraryCompressionThresholdTokens ?? 2000} onChange={(event) => settings.setSettings({ libraryCompressionThresholdTokens: Math.max(200, Math.floor(Number(event.target.value) || 2000)) })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"/></label>
      </section>

      <div className="mt-3 space-y-3">{collections.map((collection) => {
        const rows = entries.filter((entry) => entry.collectionId === collection.id)
        const permanent = rows.filter((entry) => entry.enabled && entry.keywords.length === 0)
        const triggered = rows.filter((entry) => entry.enabled && entry.keywords.length > 0)
        return <article key={collection.id} className="rounded-xl bg-white p-4"><button type="button" onClick={() => navigate(`/world-settings/${collection.id}`)} className="block w-full text-left"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium text-gray-900">{collection.name}</p><p className="mt-1 text-xs text-gray-400">{rows.length} 个正史条目{settings.defaultWorldviewId === collection.id ? ' · 默认世界' : ''}</p></div><span className="text-gray-300">›</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px]"><div className="rounded-lg bg-gray-50 p-2 text-gray-500"><p>总内容</p><p className="mt-1 font-medium">{formatEstimatedTokens(estimateWorldbookTokens(rows))}</p></div><div className="rounded-lg bg-amber-50 p-2 text-amber-700"><p>每轮常驻</p><p className="mt-1 font-medium">{formatEstimatedTokens(estimateWorldbookTokens(permanent))}</p></div><div className="rounded-lg bg-blue-50 p-2 text-blue-600"><p>关键词资料</p><p className="mt-1 font-medium">{formatEstimatedTokens(estimateWorldbookTokens(triggered))}</p></div></div></button><button type="button" disabled={settings.defaultWorldviewId === collection.id} onClick={() => settings.setSettings({ defaultWorldviewId: collection.id })} className="mt-3 w-full border-t border-gray-100 pt-3 text-xs text-blue-600 disabled:text-gray-300">{settings.defaultWorldviewId === collection.id ? '当前默认世界' : '设为新联系人默认世界'}</button></article>
      })}{collections.length === 0 && <p className="rounded-xl bg-white py-10 text-center text-sm text-gray-400">还没有世界观存档</p>}</div>
    </div>
  </div>
}
