import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Layers, LocateFixed } from 'lucide-react'
import { Avatar } from './Avatar'
import { getLocationIcon, getLocationTheme } from '../lib/locationThemes'
import { TERRAIN_LABELS } from '../lib/locationMap'
import type { Contact, LocationNode, TerrainType, WorldMapRecord } from '../types'

const CELL = 22
const MAX_SCALE = 2.6
interface Point { x: number; y: number }

function terrainDetail(context: CanvasRenderingContext2D, terrain: TerrainType, x: number, y: number, cell: number, texture: ReturnType<typeof getLocationTheme>['texture']) {
  const left = x * cell, top = y * cell
  context.save()
  context.globalAlpha = texture === 'future' ? .42 : .26
  if (terrain === 'river') {
    context.strokeStyle = '#fff'; context.lineWidth = 1
    context.beginPath(); context.moveTo(left + 4, top + 8); context.quadraticCurveTo(left + 10, top + 5, left + 18, top + 8); context.stroke()
  } else if (terrain === 'mountain') {
    context.fillStyle = texture === 'ink' ? '#314d3b' : '#4b5c4d'
    context.beginPath(); context.moveTo(left + 3, top + 18); context.lineTo(left + 11, top + 4); context.lineTo(left + 20, top + 18); context.closePath(); context.fill()
    context.strokeStyle = '#fff'; context.beginPath(); context.moveTo(left + 8, top + 9); context.lineTo(left + 11, top + 4); context.lineTo(left + 14, top + 9); context.stroke()
  } else if (terrain === 'urban') {
    context.fillStyle = texture === 'future' ? '#8f7cff' : '#fff'
    context.fillRect(left + 3, top + 4, 6, 6); context.fillRect(left + 12, top + 9, 7, 8)
  } else if (terrain === 'rural') {
    context.strokeStyle = '#fff'; context.lineWidth = 1
    context.beginPath(); context.moveTo(left + 2, top + 7); context.lineTo(left + 20, top + 3); context.moveTo(left + 3, top + 15); context.lineTo(left + 20, top + 11); context.stroke()
  } else if (terrain === 'grassland' && (x * 7 + y * 11) % 9 === 0) {
    context.fillStyle = texture === 'fantasy' ? '#365b42' : '#39744a'
    context.beginPath(); context.arc(left + 11, top + 12, 3.2, 0, Math.PI * 2); context.fill()
  } else if (terrain === 'beach') {
    context.fillStyle = '#fff'; context.beginPath(); context.arc(left + 7, top + 8, 1, 0, Math.PI * 2); context.arc(left + 15, top + 15, .8, 0, Math.PI * 2); context.fill()
  }
  context.restore()
}

export function LocationMapCanvas({ map, locations, activeLocationId, contacts = [], selectedLocationId, editing = false, placementMode = false, onBuildingClick, onMapClick }: {
  map: WorldMapRecord
  locations: LocationNode[]
  activeLocationId?: string
  contacts?: Contact[]
  selectedLocationId?: string
  editing?: boolean
  placementMode?: boolean
  onBuildingClick: (location: LocationNode) => void
  onMapClick?: (point: { x: number; y: number }) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<{ start?: Point; offset?: Point; distance?: number; moved: boolean }>({ moved: false })
  const initialized = useRef(false)
  const [viewport, setViewport] = useState({ width: 1, height: 1 })
  const [legendOpen, setLegendOpen] = useState(false)
  const mapWidth = map.width * CELL, mapHeight = map.height * CELL
  const minScale = Math.max(0.01, Math.min(viewport.width / mapWidth, viewport.height / mapHeight))
  const coverScale = Math.max(viewport.width / mapWidth, viewport.height / mapHeight)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const theme = getLocationTheme(map.themeId)
  const backgroundUrl = map.customBackgroundDataUrl ?? theme.backgroundUrl
  const roots = useMemo(() => locations.filter((location) => location.mapBinding), [locations])
  const byId = useMemo(() => new Map(locations.map((item) => [item.id, item])), [locations])
  const rootFor = useCallback((id?: string) => {
    let row = id ? byId.get(id) : undefined
    while (row && !row.mapBinding) row = row.parentId ? byId.get(row.parentId) : undefined
    return row
  }, [byId])
  const activeRoot = rootFor(activeLocationId)
  const peopleByRoot = useMemo(() => {
    const result = new Map<string, Contact[]>()
    for (const contact of contacts) {
      const root = rootFor(contact.currentLocationId)
      if (!root) continue
      result.set(root.id, [...(result.get(root.id) ?? []), contact])
    }
    return result
  }, [contacts, rootFor])

  const clamp = useCallback((value: Point, nextScale: number) => {
    const width = mapWidth * nextScale, height = mapHeight * nextScale
    return {
      x: width <= viewport.width ? (viewport.width - width) / 2 : Math.max(viewport.width - width, Math.min(0, value.x)),
      y: height <= viewport.height ? (viewport.height - height) / 2 : Math.max(viewport.height - height, Math.min(0, value.y)),
    }
  }, [mapHeight, mapWidth, viewport])

  const focusPoint = useCallback((location?: LocationNode) => {
    if (location?.mapBinding) return { x: (location.mapBinding.x + .5) * CELL, y: (location.mapBinding.y + .5) * CELL }
    const cityRoots = roots.filter((item) => ['office', 'mall', 'hospital', 'school', 'residence'].includes(item.mapBinding?.buildingCategory ?? ''))
    const candidates = cityRoots.length ? cityRoots : roots
    if (!candidates.length) return { x: mapWidth / 2, y: mapHeight / 2 }
    return {
      x: candidates.reduce((sum, item) => sum + (item.mapBinding!.x + .5) * CELL, 0) / candidates.length,
      y: candidates.reduce((sum, item) => sum + (item.mapBinding!.y + .5) * CELL, 0) / candidates.length,
    }
  }, [mapHeight, mapWidth, roots])

  const resetToCurrent = useCallback(() => {
    const next = Math.max(minScale, Math.min(MAX_SCALE, Math.max(.82, coverScale)))
    const focus = focusPoint(activeRoot)
    setScale(next)
    setOffset(clamp({ x: viewport.width / 2 - focus.x * next, y: viewport.height / 2 - focus.y * next }, next))
  }, [activeRoot, clamp, coverScale, focusPoint, minScale, viewport])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(host)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (viewport.width <= 1 || viewport.height <= 1 || initialized.current) return
    initialized.current = true; resetToCurrent()
  }, [resetToCurrent, viewport])
  useEffect(() => { initialized.current = false }, [map.seed])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = mapWidth * dpr; canvas.height = mapHeight * dpr
    canvas.style.width = `${mapWidth}px`; canvas.style.height = `${mapHeight}px`
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, mapWidth, mapHeight)
    for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
      const terrain = map.tiles[y * map.width + x] ?? 'grassland'
      context.fillStyle = theme.palette[terrain]
      context.fillRect(x * CELL, y * CELL, CELL + .6, CELL + .6)
      terrainDetail(context, terrain, x, y, CELL, theme.texture)
    }
    for (const road of map.roads ?? []) {
      if (road.points.length < 2) continue
      context.lineJoin = 'round'; context.lineCap = 'round'
      context.strokeStyle = theme.roadEdge; context.lineWidth = road.kind === 'primary' ? 8 : 5
      context.beginPath(); road.points.forEach((point, index) => index ? context.lineTo((point.x + .5) * CELL, (point.y + .5) * CELL) : context.moveTo((point.x + .5) * CELL, (point.y + .5) * CELL)); context.stroke()
      context.strokeStyle = theme.road; context.lineWidth = road.kind === 'primary' ? 5 : 3
      context.stroke()
    }
  }, [map, mapHeight, mapWidth, theme])

  const local = (clientX: number, clientY: number) => {
    const rect = hostRef.current!.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }
  const zoom = (requested: number, focal: Point) => {
    const next = Math.max(minScale, Math.min(MAX_SCALE, requested))
    const worldX = (focal.x - offset.x) / scale, worldY = (focal.y - offset.y) / scale
    setScale(next); setOffset(clamp({ x: focal.x - worldX * next, y: focal.y - worldY * next }, next))
  }
  // Explicit matrix keeps screen-space translation independent from zoom.
  const transform = `matrix(${scale},0,0,${scale},${offset.x},${offset.y})`

  return <div ref={hostRef} data-testid="location-map" data-ui-scope="special" className={`relative h-full touch-none overflow-hidden ${placementMode ? 'cursor-crosshair' : ''}`} style={{ backgroundColor: theme.palette.grassland }}
    onWheel={(event) => { event.preventDefault(); zoom(scale * (event.deltaY > 0 ? .9 : 1.1), local(event.clientX, event.clientY)) }}
    onPointerDown={(event) => { if ((event.target as HTMLElement).closest('button')) return; event.currentTarget.setPointerCapture(event.pointerId); const point = local(event.clientX, event.clientY); pointers.current.set(event.pointerId, point); gesture.current = { start: point, offset, moved: false } }}
    onPointerMove={(event) => {
      if (!pointers.current.has(event.pointerId)) return
      pointers.current.set(event.pointerId, local(event.clientX, event.clientY)); const points = [...pointers.current.values()]
      if (points.length >= 2) {
        const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
        const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
        if (gesture.current.distance) zoom(scale * distance / gesture.current.distance, midpoint)
        gesture.current.distance = distance; gesture.current.moved = true
      } else if (gesture.current.start && gesture.current.offset) {
        const dx = points[0].x - gesture.current.start.x, dy = points[0].y - gesture.current.start.y
        if (Math.abs(dx) + Math.abs(dy) > 4) gesture.current.moved = true
        setOffset(clamp({ x: gesture.current.offset.x + dx, y: gesture.current.offset.y + dy }, scale))
      }
    }}
    onPointerUp={(event) => {
      const point = local(event.clientX, event.clientY); const wasMoved = gesture.current.moved
      pointers.current.delete(event.pointerId); gesture.current = { moved: false }
      if (!wasMoved && editing && onMapClick && !(event.target as HTMLElement).closest('button')) onMapClick({ x: Math.max(0, Math.min(map.width - 1, Math.floor((point.x - offset.x) / scale / CELL))), y: Math.max(0, Math.min(map.height - 1, Math.floor((point.y - offset.y) / scale / CELL))) })
    }}>
    {backgroundUrl && <img src={backgroundUrl} alt={map.customBackgroundDataUrl ? '自定义地图背景' : `${theme.name}地图背景`} draggable={false} className="pointer-events-none absolute left-0 top-0 origin-top-left object-cover" style={{ width: mapWidth, height: mapHeight, maxWidth: 'none', maxHeight: 'none', transform }} />}
    <canvas ref={canvasRef} className={`pointer-events-none absolute left-0 top-0 origin-top-left shadow-xl ${backgroundUrl ? 'opacity-0' : ''}`} style={{ transform }} />
    <div className="pointer-events-none absolute inset-0">
      {roots.map((location) => {
        const binding = location.mapBinding!, current = activeRoot?.id === location.id, selected = selectedLocationId === location.id
        const people = peopleByRoot.get(location.id) ?? [], icon = getLocationIcon(binding.iconId ?? binding.buildingCategory)
        return <button key={location.id} type="button" aria-label={`${location.name}${people.length > 0 ? ` · ${people.length}人` : ''}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => onBuildingClick(location)} className="pointer-events-auto absolute z-10 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center" style={{ left: offset.x + (binding.x + .5) * CELL * scale, top: offset.y + (binding.y + .5) * CELL * scale }}>
          <span className={`relative flex h-10 w-10 items-center justify-center rounded-2xl border-2 bg-white/90 text-[25px] shadow-lg transition-transform ${current ? 'border-[var(--ui-special)] ring-4 ring-[var(--ui-special-border)]' : selected ? 'border-gray-700 scale-110' : 'border-white'}`}>
            {binding.customIconDataUrl ? <img src={binding.customIconDataUrl} alt="" className="h-8 w-8 object-contain" /> : icon.glyph}
            {people.length > 0 && <b className="absolute -right-2 -top-2 min-w-5 rounded-full bg-[var(--ui-special)] px-1 text-center text-[10px] leading-5 text-white">{people.length}</b>}
          </span>
          <span className="absolute top-[47px] max-w-28 whitespace-nowrap rounded-md bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold text-gray-800 shadow">{location.name}</span>
          {people.length > 0 && <span className="absolute -bottom-5 flex -space-x-1">{people.slice(0, 2).map((contact) => <Avatar key={contact.id} avatar={contact.avatar} color={contact.avatarColor} size={18} />)}{people.length > 2 && <i className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-white bg-gray-800 px-0.5 text-[8px] not-italic text-white">+{people.length - 2}</i>}</span>}
        </button>
      })}
    </div>
    <button type="button" aria-label="地图图例" onClick={() => setLegendOpen((value) => !value)} className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-xl bg-white text-gray-800 shadow-lg"><Layers size={21} /></button>
    {legendOpen && <div className="absolute right-3 top-16 z-20 w-40 rounded-2xl bg-white p-3 shadow-xl"><p className="mb-2 text-xs font-semibold text-gray-800">{theme.name} · 图例</p><div className="grid grid-cols-2 gap-2">{Object.entries(theme.palette).map(([terrain, color]) => <span key={terrain} className="flex items-center gap-1.5 text-[10px] text-gray-600"><i className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />{TERRAIN_LABELS[terrain as TerrainType]}</span>)}</div></div>}
    <button type="button" aria-label="回到当前位置" onClick={resetToCurrent} className="absolute bottom-5 right-4 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-white text-gray-800 shadow-xl"><LocateFixed size={23} /></button>
    {placementMode && <div className="pointer-events-none absolute inset-x-10 top-4 z-20 rounded-full bg-gray-900/90 px-4 py-2 text-center text-xs text-white shadow">点击地图选择新的位置</div>}
  </div>
}
