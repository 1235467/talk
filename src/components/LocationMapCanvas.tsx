import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TERRAIN_COLORS } from '../lib/locationMap'
import type { LocationNode, WorldMapRecord } from '../types'

const CELL = 22
const MAX_SCALE = 2.4
const ICONS: Record<string, string> = {
  residence: '🏠', school: '🏫', office: '🏢', mall: '🏬', hospital: '🏥', park: '🌳', beach: '🏖️', scenic: '⛰️', farm: '🚜', custom: '📍',
}
interface Point { x: number; y: number }

export function LocationMapCanvas({ map, locations, activeLocationId, counts, onBuildingClick }: {
  map: WorldMapRecord
  locations: LocationNode[]
  activeLocationId?: string
  counts?: Map<string, number>
  onBuildingClick: (location: LocationNode) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<{ start?: Point; offset?: Point; distance?: number; moved: boolean }>({ moved: false })
  const [viewport, setViewport] = useState({ width: 1, height: 1 })
  const mapWidth = map.width * CELL, mapHeight = map.height * CELL
  const minScale = Math.min(viewport.width / mapWidth, viewport.height / mapHeight)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })

  const clamp = useCallback((value: Point, nextScale: number) => {
    const width = mapWidth * nextScale, height = mapHeight * nextScale
    return {
      x: width <= viewport.width ? (viewport.width - width) / 2 : Math.max(viewport.width - width, Math.min(0, value.x)),
      y: height <= viewport.height ? (viewport.height - height) / 2 : Math.max(viewport.height - height, Math.min(0, value.y)),
    }
  }, [mapHeight, mapWidth, viewport])
  const reset = useCallback(() => {
    const next = Math.max(0.01, Math.min(MAX_SCALE, minScale))
    setScale(next)
    setOffset(clamp({ x: 0, y: 0 }, next))
  }, [clamp, minScale])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(host)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { if (viewport.width > 1 && viewport.height > 1) reset() }, [viewport.width, viewport.height, reset])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = mapWidth * dpr
    canvas.height = mapHeight * dpr
    canvas.style.width = `${mapWidth}px`
    canvas.style.height = `${mapHeight}px`
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
      context.fillStyle = TERRAIN_COLORS[map.tiles[y * map.width + x]]
      context.fillRect(x * CELL, y * CELL, CELL, CELL)
      context.strokeStyle = 'rgba(255,255,255,.22)'
      context.strokeRect(x * CELL, y * CELL, CELL, CELL)
    }
  }, [map, mapHeight, mapWidth])

  const roots = useMemo(() => locations.filter((location) => location.mapBinding), [locations])
  const rootById = useMemo(() => new Map(locations.map((item) => [item.id, item])), [locations])
  let activeRoot = activeLocationId ? rootById.get(activeLocationId) : undefined
  while (activeRoot && !activeRoot.mapBinding) activeRoot = activeRoot.parentId ? rootById.get(activeRoot.parentId) : undefined
  const local = (clientX: number, clientY: number) => {
    const rect = hostRef.current!.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }
  const zoom = (requested: number, focal: Point) => {
    const next = Math.max(minScale, Math.min(MAX_SCALE, requested))
    const worldX = (focal.x - offset.x) / scale, worldY = (focal.y - offset.y) / scale
    setScale(next)
    setOffset(clamp({ x: focal.x - worldX * next, y: focal.y - worldY * next }, next))
  }

  return <div ref={hostRef} className="relative h-full touch-none overflow-hidden bg-slate-200"
    onWheel={(event) => { event.preventDefault(); zoom(scale * (event.deltaY > 0 ? 0.9 : 1.1), local(event.clientX, event.clientY)) }}
    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const point = local(event.clientX, event.clientY); pointers.current.set(event.pointerId, point); gesture.current = { start: point, offset, moved: false } }}
    onPointerMove={(event) => {
      if (!pointers.current.has(event.pointerId)) return
      pointers.current.set(event.pointerId, local(event.clientX, event.clientY))
      const points = [...pointers.current.values()]
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
    onPointerUp={(event) => { pointers.current.delete(event.pointerId); gesture.current = { moved: false } }}>
    <canvas ref={canvasRef} className="absolute left-0 top-0 origin-top-left shadow-xl" style={{ transform: `translate(${offset.x}px,${offset.y}px) scale(${scale})` }} />
    <div className="pointer-events-none absolute inset-0">
      {roots.map((location) => {
        const binding = location.mapBinding!
        const current = activeRoot?.id === location.id
        return <button key={location.id} type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => onBuildingClick(location)} className="pointer-events-auto absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: offset.x + (binding.x + 0.5) * CELL * scale, top: offset.y + (binding.y + 0.5) * CELL * scale }}>
          <span className={`flex h-10 w-10 items-center justify-center rounded-full border-2 border-white text-xl shadow-lg ${current ? 'bg-violet-600 ring-2 ring-violet-200' : 'bg-slate-800'}`}>{ICONS[binding.buildingCategory] ?? '📍'}</span>
          <span className="mt-0.5 block max-w-24 truncate rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">{location.name} · {counts?.get(location.id) ?? 0}人</span>
        </button>
      })}
    </div>
    <div className="absolute bottom-3 right-3 z-20 flex rounded-full bg-white p-1 shadow">
      <button type="button" onClick={() => zoom(scale - 0.2, { x: viewport.width / 2, y: viewport.height / 2 })} className="h-8 w-8 rounded-full">−</button>
      <button type="button" onClick={reset} className="px-2 text-xs">复位</button>
      <button type="button" onClick={() => zoom(scale + 0.2, { x: viewport.width / 2, y: viewport.height / 2 })} className="h-8 w-8 rounded-full">＋</button>
    </div>
  </div>
}
