import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db } from '../db/db'
import { TopBar } from '../components/TopBar'
import { LocationMapCanvas } from '../components/LocationMapCanvas'
import { Avatar } from '../components/Avatar'
import { TERRAIN_COLORS, TERRAIN_LABELS } from '../lib/locationMap'
import { childLocations, enterLocation, locationCounts, realSeason, syncContactLocationsAt } from '../lib/locations'
import type { Contact, LocationNode, TerrainType } from '../types'

const EMPTY_LOCATIONS: LocationNode[] = []
const EMPTY_CONTACTS: Contact[] = []

export function LocationsPage() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<LocationNode | null>(null)
  const [error, setError] = useState('')
  const [entering, setEntering] = useState('')
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const sync = () => void syncContactLocationsAt(new Date()).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
    sync()
    const timer = window.setInterval(() => { setNow(new Date()); sync() }, 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const map = useLiveQuery(() => db.worldMaps.get('active'), [])
  const locations = useLiveQuery(() => db.locations.orderBy('sortOrder').toArray(), []) ?? EMPTY_LOCATIONS
  const state = useLiveQuery(() => db.locationModuleState.get('active'), [])
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) ?? EMPTY_CONTACTS
  const active = locations.find((item) => item.id === state?.currentLocationId)
  const children = useMemo(() => selected ? childLocations(selected.id, locations) : [], [locations, selected])
  const counts = useMemo(() => locationCounts(contacts, locations), [contacts, locations])
  const timeText = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(now)

  async function enter(location: LocationNode) {
    setEntering(location.id); setError('')
    try { await enterLocation(location.id); void navigate('/') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setEntering('') }
  }

  return <div className="relative flex h-[var(--app-height)] flex-col overflow-hidden bg-[#f4f4f6]">
    <TopBar title="地点" showBack />
    <header className="shrink-0 bg-white px-4 pb-2 pt-2 shadow-sm">
      <div className="flex items-center justify-between gap-3"><div><p className="text-xs text-gray-500">现实时间 · {timeText}</p><p className="mt-0.5 text-[11px] text-gray-400">{realSeason(now)}{active ? ` · 当前在${active.name}` : ' · 选择一个地点进入'}</p></div>{active && <button type="button" onClick={() => navigate('/chat/talk-location-conversation')} className="rounded-full bg-violet-50 px-3 py-1.5 text-xs text-violet-600">回到地点群聊</button>}</div>
      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">{Object.entries(TERRAIN_COLORS).map(([terrain, color]) => <span key={terrain} className="flex items-center gap-1 text-[9px] text-gray-500"><i className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />{TERRAIN_LABELS[terrain as TerrainType]}</span>)}</div>
      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600">{error}</p>}
    </header>
    <main className="relative min-h-0 flex-1">{map ? <LocationMapCanvas map={map} locations={locations} activeLocationId={state?.currentLocationId} counts={counts} onBuildingClick={setSelected} /> : <div className="flex h-full items-center justify-center text-sm text-gray-400">地图加载中…</div>}</main>
    {selected && <div className="absolute inset-x-0 bottom-0 z-30 rounded-t-3xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-2xl">
      <div className="flex items-start justify-between"><div><h2 className="font-semibold text-gray-900">{selected.name}</h2><p className="mt-0.5 text-xs text-gray-400">{selected.description}</p></div><button type="button" onClick={() => setSelected(null)} className="px-2 text-xl text-gray-400">×</button></div>
      <div className="mt-3 grid grid-cols-2 gap-2">{(children.length ? children : [selected]).map((location) => {
        const people = contacts.filter((contact) => contact.currentLocationId === location.id)
        return <button type="button" key={location.id} disabled={!!entering} onClick={() => void enter(location)} className={`rounded-xl border px-3 py-3 text-left text-sm disabled:opacity-50 ${state?.currentLocationId === location.id ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-gray-200 text-gray-700'}`}><span className="flex items-center justify-between gap-2"><span className="truncate">{location.name}</span><b className="shrink-0 text-xs">{people.length}人</b></span><span className="mt-1 block truncate text-[10px] text-gray-400">{entering === location.id ? '正在进入…' : location.description}</span><span className="mt-2 flex -space-x-1">{people.slice(0, 5).map((contact) => <Avatar key={contact.id} avatar={contact.avatar} color={contact.avatarColor} size={22} />)}{people.length === 0 && <span className="text-[10px] text-gray-400">当前无人</span>}</span></button>
      })}</div>
    </div>}
  </div>
}
