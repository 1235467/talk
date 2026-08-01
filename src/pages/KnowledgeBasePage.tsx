import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { TopBar } from '../components/TopBar'
import { useSettingsStore } from '../store/useSettingsStore'
import { searchKnowledgeTopic } from '../lib/knowledgeBase'
import { characterCardPersonaText, parseSillyTavernCharacterCard } from '../lib/characterCardImport'
import { parseWorldbookFile } from '../lib/worldbookImport'
import { searchLibraryItems, storeCharacterCardInLibrary, storeWorldbookInLibrary } from '../lib/library'
import type { LibrarySourceType } from '../types'
import { v4 as uuid } from 'uuid'

const SOURCE_LABELS: Record<LibrarySourceType, string> = {
  'character-card': '角色卡', worldbook: '世界书', web: '联网', manual: '手写', legacy: '旧资料',
}

export function KnowledgeBasePage() {
  const settings = useSettingsStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const items = useLiveQuery(() => db.libraryItems.toArray(), []) ?? []
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<LibrarySourceType | 'all'>('all')
  const [webQuery, setWebQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const visible = useMemo(() => searchLibraryItems(source === 'all' ? items : items.filter((item) => item.sourceType === source), query), [items, query, source])

  async function importFile(file?: File) {
    if (!file) return
    setBusy(true); setMessage('')
    try {
      let card: Awaited<ReturnType<typeof parseSillyTavernCharacterCard>> | undefined
      try {
        const parsed = await parseSillyTavernCharacterCard(file, settings.userNickname || '用户')
        if ([parsed.description, parsed.personality, parsed.scenario, parsed.firstMessage, parsed.systemPrompt].some(Boolean)) card = parsed
      } catch {}
      let lore: Awaited<ReturnType<typeof parseWorldbookFile>> | undefined
      try { lore = await parseWorldbookFile(file) } catch {}
      if (card) {
        await storeCharacterCardInLibrary({ name: card.name, content: characterCardPersonaText(card), keywords: card.tags, rawData: card.raw, sourceFileName: file.name }, lore)
        setMessage(`已将角色卡${lore ? `及其 ${lore.entries.length} 条内嵌世界书` : ''}导入资料库`)
      } else if (lore) {
        await storeWorldbookInLibrary(lore.collection, lore.entries)
        setMessage(`已导入 ${lore.entries.length} 条资料`)
      } else throw new Error('没有识别到角色卡或世界书资料')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function searchWeb() {
    if (!webQuery.trim()) return
    setBusy(true); setMessage('')
    try {
      const result = await searchKnowledgeTopic(webQuery.trim(), settings)
      setMessage(result.message ?? `新增了 ${result.addedCount} 条联网资料`)
      if (!result.message) setWebQuery('')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  async function addManual() {
    const title = window.prompt('资料标题')?.trim()
    if (!title) return
    const content = window.prompt('资料正文')?.trim()
    if (!content) return
    const keywordText = window.prompt('关键词（可选，用逗号或顿号分隔）', '') ?? ''
    const now = Date.now()
    await db.libraryItems.add({ id: uuid(), sourceType: 'manual', title, content, keywords: [...new Set(keywordText.split(/[、,，\n]+/).map((value) => value.trim()).filter(Boolean))], sourceLabel: '用户手写', createdAt: now, updatedAt: now })
    setMessage('已添加手写资料')
  }

  return <div className="relative flex h-[var(--app-height)] flex-col overflow-hidden bg-[#f4f4f6]">
    <TopBar title="资料库" showBack />
    <div className="flex-1 overflow-y-auto px-4 pb-8">
      <section className="mt-3 rounded-xl bg-white p-4">
        <p className="text-sm font-medium text-gray-900">收集资料</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">角色卡、外部世界书和联网结果都会先保存在这里。资料不会自动成为世界正史。</p>
        <input ref={fileRef} type="file" accept=".json,.lorebook,.png,application/json,image/png" className="hidden" onChange={(event) => void importFile(event.target.files?.[0])}/>
        <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="rounded-lg bg-gray-900 py-2.5 text-sm text-white disabled:opacity-50">{busy ? '处理中…' : '导入文件'}</button><button type="button" onClick={() => void addManual()} className="rounded-lg bg-gray-100 py-2.5 text-sm text-gray-700">手写资料</button></div>
        <div className="mt-2 flex gap-2"><input value={webQuery} onChange={(event) => setWebQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchWeb() }} placeholder="联网搜索新词、作品或资料" className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"/><button type="button" disabled={busy || !webQuery.trim()} onClick={() => void searchWeb()} className="rounded-lg bg-gray-100 px-4 text-sm text-gray-700 disabled:opacity-40">搜索</button></div>
        {message && <p className="mt-2 text-xs leading-relaxed text-gray-500">{message}</p>}
      </section>

      <div className="sticky top-0 z-10 -mx-4 mt-3 bg-[#f4f4f6] px-4 py-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资料名、关键词、来源或正文" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"/>
        <div className="mt-2 flex gap-2 overflow-x-auto">{(['all','character-card','worldbook','web','manual'] as const).map((value) => <button type="button" key={value} onClick={() => setSource(value)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${source === value ? 'bg-gray-900 text-white' : 'bg-white text-gray-500'}`}>{value === 'all' ? '全部' : SOURCE_LABELS[value]}</button>)}</div>
      </div>

      <div className="space-y-2">{visible.map((item) => <article key={item.id} className="rounded-xl bg-white p-4">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium text-gray-900">{item.title}</p><p className="mt-1 line-clamp-3 text-sm leading-relaxed text-gray-500">{item.content || '（资料包）'}</p></div>{'matchPercent' in item && query.trim() && <span className="shrink-0 rounded-full bg-green-50 px-2 py-1 text-[10px] text-green-700">{Number(item.matchPercent)}%匹配</span>}</div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]"><span className="rounded-full bg-gray-100 px-2 py-1 text-gray-500">{SOURCE_LABELS[item.sourceType]}</span>{item.keywords.slice(0, 4).map((keyword) => <span key={keyword} className="rounded-full bg-blue-50 px-2 py-1 text-blue-600">{keyword}</span>)}{item.sourceFileName && <span className="truncate rounded-full bg-gray-50 px-2 py-1 text-gray-400">{item.sourceFileName}</span>}</div>
        <button type="button" onClick={() => void db.libraryItems.delete(item.id)} className="mt-3 text-xs text-red-500">删除资料</button>
      </article>)}{visible.length === 0 && <p className="py-12 text-center text-sm text-gray-400">没有符合条件的资料</p>}</div>
    </div>
  </div>
}
