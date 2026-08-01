import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { MapPinned, Pencil, Upload, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { db } from '../db/db'
import { isAiTestId } from '../lib/aiTestIsolation'
import { TopBar } from '../components/TopBar'
import { LocationMapCanvas } from '../components/LocationMapCanvas'
import { Avatar } from '../components/Avatar'
import { DEFAULT_LOCATION_THEME_ID, getLocationIcon, LOCATION_ICON_OPTIONS, LOCATION_MAP_THEMES } from '../lib/locationThemes'
import { childLocations, enterLocation, realSeason, syncContactLocationsAt, upgradeLocationMap } from '../lib/locations'
import type { Contact, LocationNode, TerrainType } from '../types'

const EMPTY_LOCATIONS: LocationNode[] = []
const EMPTY_CONTACTS: Contact[] = []
const ALL_TERRAINS: TerrainType[] = ['river', 'grassland', 'beach', 'mountain', 'urban', 'rural']

interface LocationFormState {
  name: string
  description: string
  access: LocationNode['access']
  iconId: string
  customIconDataUrl?: string
}
const EMPTY_FORM: LocationFormState = { name: '', description: '', access: 'public', iconId: 'custom' }

function readImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败'))
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

export function LocationsPage() {
  const navigate = useNavigate()
  const [selectedId, setSelectedId] = useState<string>()
  const [error, setError] = useState('')
  const [entering, setEntering] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [manageOpen, setManageOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [formMode, setFormMode] = useState<'new' | 'edit'>()
  const [form, setForm] = useState<LocationFormState>(EMPTY_FORM)
  const [draftPoint, setDraftPoint] = useState<{ x: number; y: number }>()
  const [movingId, setMovingId] = useState<string>()
  const [iconSearch, setIconSearch] = useState('')

  useEffect(() => {
    const sync = () => void syncContactLocationsAt(new Date()).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
    sync(); const timer = window.setInterval(() => { setNow(new Date()); sync() }, 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const map = useLiveQuery(() => db.worldMaps.get('active'), [])
  const locations = useLiveQuery(() => db.locations.orderBy('sortOrder').toArray(), []) ?? EMPTY_LOCATIONS
  const state = useLiveQuery(() => db.locationModuleState.get('active'), [])
  const contacts = (useLiveQuery(() => db.contacts.toArray(), []) ?? EMPTY_CONTACTS).filter((item) => !isAiTestId(item.id))
  const active = locations.find((item) => item.id === state?.currentLocationId)
  const selected = locations.find((item) => item.id === selectedId)
  const children = useMemo(() => selected ? childLocations(selected.id, locations) : [], [locations, selected])
  const timeText = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(now)
  const selectedPeople = useMemo(() => {
    if (!selected) return []
    const ids = new Set([selected.id])
    let changed = true
    while (changed) {
      changed = false
      for (const item of locations) if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); changed = true }
    }
    return contacts.filter((contact) => !!contact.currentLocationId && ids.has(contact.currentLocationId))
  }, [contacts, locations, selected])
  const filteredIcons = useMemo(() => {
    const query = iconSearch.trim().toLocaleLowerCase()
    return LOCATION_ICON_OPTIONS.filter((item) => !query || `${item.label} ${item.category} ${item.keywords}`.toLocaleLowerCase().includes(query))
  }, [iconSearch])

  async function enter(location: LocationNode) {
    setEntering(location.id); setError('')
    try { await enterLocation(location.id); void navigate('/') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setEntering('') }
  }

  function openEdit(location: LocationNode) {
    setSelectedId(location.id)
    setForm({ name: location.name, description: location.description, access: location.access, iconId: location.mapBinding?.iconId ?? location.mapBinding?.buildingCategory ?? 'custom', customIconDataUrl: location.mapBinding?.customIconDataUrl })
    setFormMode('edit'); setIconSearch('')
  }

  function handleMarker(location: LocationNode) {
    if (editMode) openEdit(location)
    else setSelectedId(location.id)
  }

  async function handleMapClick(point: { x: number; y: number }) {
    if (!map) return
    if (movingId) {
      const location = locations.find((item) => item.id === movingId)
      if (location?.mapBinding) await db.locations.update(location.id, { mapBinding: { ...location.mapBinding, x: point.x, y: point.y }, updatedAt: Date.now() })
      setMovingId(undefined); setSelectedId(location?.id); return
    }
    setDraftPoint(point); setForm(EMPTY_FORM); setFormMode('new'); setIconSearch('')
  }

  async function saveLocation() {
    if (!map || !form.name.trim()) { setError('请填写地点名称'); return }
    setError('')
    try {
      if (formMode === 'new') {
        if (!draftPoint) return
        const nowAt = Date.now(), icon = getLocationIcon(form.iconId)
        await db.locations.add({
          id: crypto.randomUUID(), name: form.name.trim(), kind: 'custom', description: form.description.trim() || '用户创建的地点。', access: form.access,
          mapBinding: { x: draftPoint.x, y: draftPoint.y, allowedTerrains: ALL_TERRAINS, buildingCategory: icon.id, iconId: icon.id, customIconDataUrl: form.customIconDataUrl },
          userCreated: true, sortOrder: Math.max(100, ...locations.map((item) => item.sortOrder)) + 10, createdAt: nowAt, updatedAt: nowAt,
        })
      } else if (selected?.mapBinding) {
        const icon = getLocationIcon(form.iconId)
        await db.locations.update(selected.id, { name: form.name.trim(), description: form.description.trim(), access: form.access, mapBinding: { ...selected.mapBinding, buildingCategory: icon.id, iconId: icon.id, customIconDataUrl: form.customIconDataUrl }, updatedAt: Date.now() })
      }
      setFormMode(undefined); setDraftPoint(undefined)
    } catch (reason) { setError(reason instanceof Error && reason.name === 'ConstraintError' ? '地点名称不能重复' : reason instanceof Error ? reason.message : String(reason)) }
  }

  async function deleteSelected() {
    if (!selected?.userCreated || !window.confirm(`删除地点“${selected.name}”？此操作无法撤销。`)) return
    const affected = contacts.filter((contact) => contact.currentLocationId === selected.id)
    await db.transaction('rw', db.locations, db.contacts, db.locationModuleState, async () => {
      await db.locations.delete(selected.id)
      for (const contact of affected) await db.contacts.update(contact.id, { currentLocationId: undefined, locationSource: undefined, locationUpdatedAt: Date.now() })
      if (state?.currentLocationId === selected.id) await db.locationModuleState.update('active', { currentLocationId: undefined, updatedAt: Date.now() })
    })
    setSelectedId(undefined); setFormMode(undefined)
  }

  async function importIcon(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { setError('地点图标不能超过 2MB'); return }
    try { const customIconDataUrl = await readImage(file); setForm((value) => ({ ...value, customIconDataUrl, iconId: 'custom' })) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  async function importBackground(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file || !map) return
    if (file.size > 8 * 1024 * 1024) { setError('地图背景不能超过 8MB'); return }
    try { await db.worldMaps.update('active', { customBackgroundDataUrl: await readImage(file), customBackgroundName: file.name, mode: 'custom', updatedAt: Date.now() }) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  return <div className="relative flex h-[var(--app-height)] flex-col overflow-hidden bg-[#f4f4f6]">
    <TopBar title="地点" showBack right={<button type="button" aria-label="地图管理" onClick={() => setManageOpen(true)} className="flex h-9 w-9 items-center justify-center text-gray-700"><Pencil size={18} /></button>} />
    <main className="relative min-h-0 flex-1">{map ? <>
      <LocationMapCanvas map={map} locations={locations} activeLocationId={state?.currentLocationId} contacts={contacts} selectedLocationId={selectedId} editing={editMode} placementMode={!!movingId} onBuildingClick={handleMarker} onMapClick={(point) => void handleMapClick(point)} />
      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-76px)] rounded-xl bg-white/95 px-3 py-2 shadow-lg"><p className="truncate text-xs font-medium text-gray-700">{active ? `当前在 ${active.name}` : '选择一个地点进入'}</p><p className="mt-0.5 text-[10px] text-gray-400">{timeText} · {realSeason(now)}</p></div>
      {active && <button type="button" onClick={() => navigate('/chat/talk-location-conversation')} className="absolute bottom-5 left-4 z-20 rounded-full bg-white px-3 py-2 text-xs font-medium text-[var(--ui-special-ink)] shadow-lg">回到地点群聊</button>}
      {editMode && !movingId && <div className="pointer-events-none absolute inset-x-14 bottom-5 z-10 rounded-full bg-gray-900/90 px-4 py-2 text-center text-xs text-white">编辑模式：点地点修改，点空白处新增</div>}
    </> : <div className="flex h-full items-center justify-center text-sm text-gray-400">地图加载中…</div>}
    {error && <button type="button" onClick={() => setError('')} className="absolute inset-x-3 top-16 z-50 rounded-xl bg-red-50 px-3 py-2 text-left text-xs text-red-600 shadow">{error}</button>}
    </main>

    {selected && !editMode && <div className="absolute inset-x-0 bottom-0 z-30 max-h-[68%] overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-2xl">
      <div className="flex items-start justify-between"><div><h2 className="font-semibold text-gray-900">{selected.name}</h2><p className="mt-0.5 text-xs text-gray-400">{selected.description}</p></div><button type="button" onClick={() => setSelectedId(undefined)} className="flex h-8 w-8 items-center justify-center text-gray-400"><X size={20} /></button></div>
      <section className="mt-3 rounded-2xl bg-gray-50 p-3"><p className="text-xs font-medium text-gray-700">当前在这里 · {selectedPeople.length}人</p>{selectedPeople.length ? <div className="mt-2 flex flex-wrap gap-3">{selectedPeople.map((contact) => <span key={contact.id} className="flex items-center gap-1.5 text-xs text-gray-600"><Avatar avatar={contact.avatar} color={contact.avatarColor} size={26} />{contact.remark || contact.name}</span>)}</div> : <p className="mt-1 text-[11px] text-gray-400">当前无人</p>}</section>
      <div className="mt-3 grid grid-cols-2 gap-2">{(children.length ? children : [selected]).map((location) => {
        const people = contacts.filter((contact) => contact.currentLocationId === location.id)
        return <button type="button" key={location.id} disabled={!!entering} onClick={() => void enter(location)} className={`rounded-xl border px-3 py-3 text-left text-sm disabled:opacity-50 ${state?.currentLocationId === location.id ? 'border-[var(--ui-special)] bg-[var(--ui-special-soft)] text-[var(--ui-special-ink)]' : 'border-gray-200 text-gray-700'}`}><span className="flex items-center justify-between gap-2"><span className="truncate">{location.name}</span>{people.length > 0 && <b className="shrink-0 text-xs">{people.length}人</b>}</span><span className="mt-1 block truncate text-[10px] text-gray-400">{entering === location.id ? '正在进入…' : location.description}</span>{people.length > 0 && <span className="mt-2 flex flex-wrap gap-1">{people.slice(0, 4).map((contact) => <span key={contact.id} className="flex items-center gap-1 text-[9px]"><Avatar avatar={contact.avatar} color={contact.avatarColor} size={20} />{contact.remark || contact.name}</span>)}</span>}</button>
      })}</div>
    </div>}

    {manageOpen && map && <div className="absolute inset-0 z-40 flex flex-col bg-[#f4f4f6]">
      <TopBar title="地图管理" onBack={() => setManageOpen(false)} showBack />
      <div className="flex-1 overflow-y-auto p-4 pb-8">
        <section className="rounded-2xl bg-white p-4"><h2 className="text-sm font-semibold text-gray-900">地图主题</h2><p className="mt-1 text-xs text-gray-400">只改变视觉，不改变地点和人物数据</p><div className="mt-3 grid grid-cols-2 gap-2">{LOCATION_MAP_THEMES.map((theme) => <button key={theme.id} type="button" onClick={() => void db.worldMaps.update('active', { themeId: theme.id, updatedAt: Date.now() })} className={`overflow-hidden rounded-xl border p-2 text-left ${map.themeId === theme.id || (!map.themeId && theme.id === DEFAULT_LOCATION_THEME_ID) ? 'border-[var(--ui-special)] ring-1 ring-[var(--ui-special)]' : 'border-gray-200'}`}><span className="mb-2 grid h-9 grid-cols-3 overflow-hidden rounded-lg"><i style={{ background: theme.palette.urban }} /><i style={{ background: theme.palette.grassland }} /><i style={{ background: theme.palette.river }} /></span><b className="text-xs text-gray-800">{theme.name}</b><small className="mt-0.5 block text-[9px] text-gray-400">{theme.description}</small></button>)}</div></section>
        <section className="mt-3 rounded-2xl bg-white p-4"><h2 className="text-sm font-semibold text-gray-900">自定义背景</h2><p className="mt-1 text-xs text-gray-400">导入自己的世界地图，再在上面自由放置地点</p><div className="mt-3 flex gap-2"><label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-gray-900 px-3 py-2.5 text-xs text-white"><Upload size={15} />导入地图<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void importBackground(event)} /></label>{map.customBackgroundDataUrl && <button type="button" onClick={() => void db.worldMaps.update('active', { customBackgroundDataUrl: undefined, customBackgroundName: undefined, mode: 'fixed', updatedAt: Date.now() })} className="rounded-xl border border-gray-200 px-3 text-xs text-gray-600">清除</button>}</div>{map.customBackgroundName && <p className="mt-2 truncate text-[10px] text-gray-400">当前：{map.customBackgroundName}</p>}</section>
        <section className="mt-3 rounded-2xl bg-white p-4"><h2 className="text-sm font-semibold text-gray-900">地点编辑</h2><p className="mt-1 text-xs text-gray-400">新增、移动地点，或更换官方和自定义图标</p><button type="button" onClick={() => { setEditMode(true); setManageOpen(false); setSelectedId(undefined) }} className="mt-3 w-full rounded-xl bg-gray-900 px-3 py-2.5 text-xs text-white">进入编辑模式</button></section>
        {map.generatorVersion < 2 && <section className="mt-3 rounded-2xl bg-white p-4"><h2 className="text-sm font-semibold text-gray-900">结构化地图 v2</h2><p className="mt-1 text-xs text-gray-400">升级河流、城区、道路和地点布局。地点资料不会删除，但坐标会重新安排。</p><button type="button" onClick={() => { if (window.confirm('升级会重新安排内置地点坐标，确定继续？')) void upgradeLocationMap().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))) }} className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-xs text-gray-700">升级当前地图</button></section>}
      </div>
    </div>}

    {editMode && <button type="button" onClick={() => { setEditMode(false); setMovingId(undefined); setFormMode(undefined) }} className="absolute right-3 top-[54px] z-30 rounded-full bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-lg">完成编辑</button>}

    {formMode && <div className="absolute inset-x-0 bottom-0 z-50 max-h-[78%] overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-2xl">
      <div className="flex items-center justify-between"><h2 className="font-semibold text-gray-900">{formMode === 'new' ? '新增地点' : '编辑地点'}</h2><button type="button" onClick={() => { setFormMode(undefined); setDraftPoint(undefined) }}><X size={20} /></button></div>
      <label className="mt-4 block text-xs text-gray-500">地点名称<input value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="例如：魔法学院" /></label>
      <label className="mt-3 block text-xs text-gray-500">地点描述<textarea value={form.description} onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))} className="mt-1 h-16 w-full resize-none rounded-xl border px-3 py-2 text-sm" placeholder="简单描述这个地点" /></label>
      <div className="mt-3"><label className="text-xs text-gray-500">地点图标</label><input value={iconSearch} onChange={(event) => setIconSearch(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" placeholder="搜索城堡、医院、书院……" /><div className="mt-2 grid max-h-40 grid-cols-5 gap-2 overflow-y-auto">{filteredIcons.map((icon) => <button key={icon.id} type="button" onClick={() => setForm((value) => ({ ...value, iconId: icon.id, customIconDataUrl: undefined }))} className={`flex min-h-14 flex-col items-center justify-center rounded-xl border text-2xl ${form.iconId === icon.id && !form.customIconDataUrl ? 'border-[var(--ui-special)] bg-[var(--ui-special-soft)]' : 'border-gray-100'}`} title={`${icon.category} · ${icon.label}`}>{icon.glyph}<small className="mt-0.5 max-w-full truncate px-1 text-[8px] text-gray-500">{icon.label}</small></button>)}</div><label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 py-2 text-xs text-gray-600"><Upload size={14} />上传自定义图标<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void importIcon(event)} /></label>{form.customIconDataUrl && <div className="mt-2 flex items-center gap-2 text-xs text-gray-500"><img src={form.customIconDataUrl} alt="自定义图标预览" className="h-10 w-10 rounded-lg object-contain" />已选择自定义图标</div>}</div>
      <label className="mt-3 block text-xs text-gray-500">访问权限<select value={form.access} onChange={(event) => setForm((value) => ({ ...value, access: event.target.value as LocationNode['access'] }))} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm"><option value="public">公开</option><option value="restricted">受限</option><option value="private">私人</option></select></label>
      <div className="mt-4 flex gap-2">{formMode === 'edit' && selected?.mapBinding && <button type="button" onClick={() => { setMovingId(selected.id); setFormMode(undefined) }} className="flex items-center justify-center gap-1 rounded-xl border border-gray-200 px-3 py-2.5 text-xs text-gray-700"><MapPinned size={15} />重新定位</button>}<button type="button" onClick={() => void saveLocation()} className="flex-1 rounded-xl bg-gray-900 py-2.5 text-sm text-white">保存</button></div>
      {formMode === 'edit' && selected?.userCreated && <button type="button" onClick={() => void deleteSelected()} className="mt-3 w-full py-2 text-xs text-red-500">删除这个地点</button>}
    </div>}
  </div>
}
