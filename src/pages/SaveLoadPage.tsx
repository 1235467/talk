import { useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Clock3, Database, Map, RotateCcw, Trash2 } from 'lucide-react'
import { TopBar } from '../components/TopBar'
import { Avatar } from '../components/Avatar'
import { db } from '../db/db'
import {
  createContactSave, createMapSave, createWorldbookSave, deleteScopedSave,
  restoreContactSave, restoreMapSave, restoreWorldbookSave,
} from '../lib/scopedSaves'
import { displayName } from '../lib/contact'

type Tab = 'contacts' | 'global'
type Detail = { type: 'contact'; id: string } | { type: 'worldbook'; id: string } | { type: 'map' } | null

const dateText = (value?: number) => value ? new Date(value).toLocaleString() : '暂无存档'
const automaticName = () => `手动存档 · ${new Date().toLocaleString()}`

function SnapshotActions({ busy, onRestore, onDelete }: { busy: boolean; onRestore: () => void; onDelete: () => void }) {
  return <div className="mt-3 flex gap-2">
    <button type="button" disabled={busy} onClick={onRestore} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-gray-900 py-2 text-xs text-white disabled:opacity-50"><RotateCcw size={13} />回档</button>
    <button type="button" disabled={busy} onClick={onDelete} aria-label="删除存档" className="rounded-lg bg-red-50 px-3 text-red-500 disabled:opacity-50"><Trash2 size={14} /></button>
  </div>
}

export function SaveLoadPage() {
  const contacts = useLiveQuery(() => db.contacts.orderBy('createdAt').reverse().toArray(), []) ?? []
  const storylines = useLiveQuery(() => db.contactStorylines.toArray(), []) ?? []
  const contactSnapshots = useLiveQuery(() => db.contactSaveSnapshots.orderBy('createdAt').reverse().toArray(), []) ?? []
  const globalSnapshots = useLiveQuery(() => db.globalSaveSnapshots.orderBy('createdAt').reverse().toArray(), []) ?? []
  const worlds = useLiveQuery(() => db.worldbookCollections.orderBy('updatedAt').reverse().toArray(), []) ?? []
  const map = useLiveQuery(() => db.worldMaps.get('active'), [])
  const locations = useLiveQuery(() => db.locations.toArray(), []) ?? []
  const [tab, setTab] = useState<Tab>('contacts')
  const [detail, setDetail] = useState<Detail>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const worldNameById = new globalThis.Map(worlds.map((world) => [world.id, world.name]))
  const storylineById = new globalThis.Map(storylines.map((line) => [line.id, line]))

  const run = async (id: string, work: () => Promise<void>, done: string) => {
    setBusy(id); setMessage('')
    try { await work(); setMessage(done) } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(null) }
  }
  const goBack = () => { setDetail(null); setMessage('') }

  if (detail?.type === 'contact') {
    const contact = contacts.find((item) => item.id === detail.id)
    if (!contact) return null
    const saves = contactSnapshots.filter((save) => save.contactId === contact.id)
    const groups = new globalThis.Map<string, typeof saves>()
    for (const save of saves) groups.set(save.storylineId, [...(groups.get(save.storylineId) ?? []), save])
    const sections = [...groups.entries()].sort(([, a], [, b]) => b[0].createdAt - a[0].createdAt)
    const create = () => void run('contact-create', () => createContactSave(contact, { name: automaticName(), kind: 'manual' }), '新建存档成功')
    return <DetailPage title={`${displayName(contact)}的存档`} onBack={goBack} onCreate={create} creating={busy === 'contact-create'} message={message}>
      <p className="mb-3 text-xs leading-relaxed text-gray-400">每条剧情线拥有独立聊天记录与角色记忆。回档只影响 {displayName(contact)}，不会改动其他联系人。</p>
      {sections.map(([lineId, lineSaves]) => {
        const line = storylineById.get(lineId)
        const worldName = line?.worldviewId ? worldNameById.get(line.worldviewId) : undefined
        return <section key={lineId} className="mb-4"><div className="mb-2"><h2 className="text-sm font-medium text-gray-800">{line?.name ?? '旧剧情线'}</h2><p className="mt-0.5 text-[11px] text-gray-400">{worldName ?? '未绑定世界观'}{line?.active ? ' · 当前剧情线' : ' · 已归档'}</p></div><div className="space-y-2">{lineSaves.map((save) => <ContactSaveCard key={save.id} save={save} worldName={worldName} busy={busy === save.id} onRestore={() => { if (window.confirm('回档会覆盖此联系人当前剧情线的聊天记录和角色记忆，并切换到该存档所属的剧情线。确定继续吗？')) void run(save.id, () => restoreContactSave(save.id), '已回档到该联系人存档') }} onDelete={() => void run(save.id, () => deleteScopedSave(save.id, 'contact'), '存档已删除')} />)}</div></section>
      })}
      {!saves.length && <Empty text="还没有存档。点击上方“新建存档”即可保存当前状态。" />}
    </DetailPage>
  }

  if (detail?.type === 'worldbook') {
    if (detail.id === '__list__') {
      return <div className="flex h-[var(--app-height)] flex-col overflow-hidden bg-[#f4f4f6]"><TopBar title="世界书" showBack onBack={goBack} /><div className="flex-1 overflow-y-auto p-4"><p className="mb-3 text-xs leading-relaxed text-gray-400">选择一个世界书，查看与回档它自己的版本历史。</p><div className="space-y-2">{worlds.map((world) => { const saves = globalSnapshots.filter((save) => save.resourceType === 'worldbook' && save.resourceId === world.id); return <button type="button" key={world.id} onClick={() => { setDetail({ type: 'worldbook', id: world.id }); setMessage('') }} className="flex w-full items-center gap-3 rounded-xl bg-white p-4 text-left active:bg-gray-50"><Database size={19} className="text-gray-600" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-gray-900">{world.name}</span><span className="mt-1 block text-xs text-gray-400">共 {saves.length} 个存档</span><span className="mt-0.5 block text-[11px] text-gray-400">最近存档：{dateText(saves[0]?.createdAt)}</span></span><ChevronRight size={18} className="text-gray-300" /></button> })}</div>{!worlds.length && <Empty text="还没有世界书" />}</div></div>
    }
    const world = worlds.find((item) => item.id === detail.id)
    if (!world) return null
    const saves = globalSnapshots.filter((save) => save.resourceType === 'worldbook' && save.resourceId === world.id)
    const create = () => void run('world-create', () => createWorldbookSave(world.id, automaticName()), '新建世界书存档成功')
    return <DetailPage title={`${world.name}的存档`} onBack={goBack} onCreate={create} creating={busy === 'world-create'} message={message}>
      <p className="mb-3 text-xs leading-relaxed text-gray-400">世界书是全局资源。回档会影响所有当前绑定“{world.name}”的联系人。</p>
      <div className="space-y-2">{saves.map((save) => <GlobalSaveCard key={save.id} save={save} busy={busy === save.id} onRestore={() => { if (window.confirm(`回档世界书“${world.name}”会影响所有绑定它的联系人。确定继续吗？`)) void run(save.id, () => restoreWorldbookSave(save.id), '世界书已回档') }} onDelete={() => void run(save.id, () => deleteScopedSave(save.id, 'global'), '存档已删除')} />)}</div>
      {!saves.length && <Empty text="还没有存档。点击上方“新建存档”即可保存当前世界书。" />}
    </DetailPage>
  }

  if (detail?.type === 'map') {
    const saves = globalSnapshots.filter((save) => save.resourceType === 'map' && save.resourceId === 'active')
    const create = () => void run('map-create', () => createMapSave(automaticName()), '新建地图存档成功')
    return <DetailPage title="地图存档" onBack={goBack} onCreate={create} creating={busy === 'map-create'} message={message}>
      <p className="mb-3 text-xs leading-relaxed text-gray-400">当前地图含 {locations.length} 个地点。回档会覆盖全部地图与地点数据。</p>
      <div className="space-y-2">{saves.map((save) => <GlobalSaveCard key={save.id} save={save} busy={busy === save.id} onRestore={() => { if (window.confirm('回档地图会影响全部地点与正在使用地图的联系人。确定继续吗？')) void run(save.id, () => restoreMapSave(save.id), '地图已回档') }} onDelete={() => void run(save.id, () => deleteScopedSave(save.id, 'global'), '存档已删除')} />)}</div>
      {!saves.length && <Empty text="还没有存档。点击上方“新建存档”即可保存当前地图。" />}
    </DetailPage>
  }

  return <div className="flex h-[var(--app-height)] flex-col overflow-hidden bg-[#f4f4f6]">
    <TopBar title="存档与回档" showBack />
    <div className="border-b border-gray-100 bg-white px-4 py-2"><div className="grid grid-cols-2 rounded-lg bg-gray-100 p-1"><button type="button" onClick={() => setTab('contacts')} className={`rounded-md py-2 text-sm ${tab === 'contacts' ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-500'}`}>联系人组</button><button type="button" onClick={() => setTab('global')} className={`rounded-md py-2 text-sm ${tab === 'global' ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-500'}`}>全局存档</button></div></div>
    <div className="flex-1 overflow-y-auto p-4">
      {tab === 'contacts' ? <><p className="mb-3 text-xs leading-relaxed text-gray-400">每位联系人独立保存聊天记录、角色记忆和剧情线；世界书、地图作为全局资源另行管理。</p><div className="space-y-2">{contacts.map((contact) => { const saves = contactSnapshots.filter((save) => save.contactId === contact.id); return <button type="button" key={contact.id} onClick={() => { setDetail({ type: 'contact', id: contact.id }); setMessage('') }} className="flex w-full items-center gap-3 rounded-xl bg-white p-3 text-left active:bg-gray-50"><Avatar avatar={contact.avatar} color={contact.avatarColor} size={44} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-gray-900">{displayName(contact)}</span><span className="mt-1 block text-xs text-gray-400">共 {saves.length} 个存档</span><span className="mt-0.5 block text-[11px] text-gray-400">最近存档：{dateText(saves[0]?.createdAt)}</span></span><ChevronRight size={18} className="text-gray-300" /></button> })}</div>{!contacts.length && <Empty text="还没有联系人" />}</> : <><p className="mb-3 text-xs leading-relaxed text-gray-400">世界书与地图是可复用的全局资源。回档它们会影响所有正在绑定该资源的联系人。</p><div className="space-y-2"><button type="button" onClick={() => { setDetail({ type: 'worldbook', id: '__list__' }); setMessage('') }} className="flex w-full items-center gap-3 rounded-xl bg-white p-4 text-left active:bg-gray-50"><Database size={20} className="text-gray-600" /><span className="flex-1"><span className="block text-sm font-medium text-gray-900">世界书</span><span className="mt-1 block text-xs text-gray-400">{worlds.length} 个世界书</span></span><ChevronRight size={18} className="text-gray-300" /></button><button type="button" disabled={!map} onClick={() => { setDetail({ type: 'map' }); setMessage('') }} className="flex w-full items-center gap-3 rounded-xl bg-white p-4 text-left active:bg-gray-50 disabled:opacity-50"><Map size={20} className="text-gray-600" /><span className="flex-1"><span className="block text-sm font-medium text-gray-900">地图</span><span className="mt-1 block text-xs text-gray-400">{map ? `${locations.length} 个地点` : '当前还没有地图'}</span></span><ChevronRight size={18} className="text-gray-300" /></button></div></>}
    </div>
  </div>
}

function DetailPage({ title, onBack, onCreate, creating, message, children }: { title: string; onBack: () => void; onCreate: () => void; creating: boolean; message: string; children: ReactNode }) {
  return <div className="flex h-[var(--app-height)] flex-col overflow-hidden bg-[#f4f4f6]"><TopBar title={title} showBack onBack={onBack} /><div className="flex-1 overflow-y-auto p-4"><button type="button" onClick={onCreate} disabled={creating} className="mb-4 w-full rounded-xl bg-gray-900 py-3 text-sm font-medium text-white disabled:opacity-50">{creating ? '正在创建…' : '新建存档'}</button>{children}{message && <p className="mt-3 text-center text-xs text-gray-500">{message}</p>}</div></div>
}

function ContactSaveCard({ save, worldName, busy, onRestore, onDelete }: { save: { id: string; name: string; kind: string; createdAt: number; snapshot: { messages: unknown[]; memories: Array<{ content: string; updatedAt: number }> } }; worldName?: string; busy: boolean; onRestore: () => void; onDelete: () => void }) {
  const newest = [...save.snapshot.memories].sort((a, b) => b.updatedAt - a.updatedAt)[0]
  return <article className="rounded-xl bg-white p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-medium text-gray-900">{save.name}</p><p className="mt-1 text-[11px] text-gray-400">{save.kind === 'automatic' ? '自动存档' : '手动存档'} · {dateText(save.createdAt)}</p></div><Clock3 size={15} className="text-gray-300" /></div><p className="mt-3 text-xs text-gray-600">聊天记录：{save.snapshot.messages.length} 条 · 角色记忆：{save.snapshot.memories.length} 条</p><p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500">最近记忆：{newest?.content || '暂无角色记忆'}</p><p className="mt-2 text-[11px] text-gray-400">世界书：{worldName ?? '未绑定世界观'}</p><SnapshotActions busy={busy} onRestore={onRestore} onDelete={onDelete} /></article>
}

function GlobalSaveCard({ save, busy, onRestore, onDelete }: { save: { id: string; name: string; kind: string; createdAt: number }; busy: boolean; onRestore: () => void; onDelete: () => void }) {
  return <article className="rounded-xl bg-white p-3"><p className="text-sm font-medium text-gray-900">{save.name}</p><p className="mt-1 text-[11px] text-gray-400">{save.kind === 'automatic' ? '自动存档' : '手动存档'} · {dateText(save.createdAt)}</p><SnapshotActions busy={busy} onRestore={onRestore} onDelete={onDelete} /></article>
}

function Empty({ text }: { text: string }) { return <div className="rounded-xl bg-white px-4 py-10 text-center text-sm text-gray-400">{text}</div> }
