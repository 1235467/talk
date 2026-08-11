import { Capacitor } from '@capacitor/core'
import { useSettingsStore } from '../../store/useSettingsStore'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function serverBase(): string {
  return (useSettingsStore.getState().serverUrl || '').replace(/\/+$/, '')
}

export function isServerConfigured(): boolean {
  if (serverBase().length > 0) return true
  // Empty serverUrl means same-origin: legit in a browser (nginx or the vite
  // dev proxy serves /api on the same host), broken in the Capacitor shell
  // where origin is https://localhost and nothing listens there.
  return !Capacitor.isNativePlatform()
}

interface RequestOptions {
  method?: string
  body?: unknown
  params?: Record<string, string | number | undefined>
}

export async function apiFetch<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { serverToken } = useSettingsStore.getState()
  const url = new URL(`${serverBase()}/api${path}`, window.location.href)
  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(serverToken ? { Authorization: `Bearer ${serverToken}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const body = await response.json()
      if (typeof body?.error === 'string') message = body.error
    } catch {}
    throw new ApiError(response.status, message)
  }
  return response.json() as Promise<T>
}

export function mediaUrl(path: string): string {
  if (!path.startsWith('/')) return path
  return `${serverBase()}${path}`
}

/**
 * Third-party provider calls (Pexels/Tavily/Giphy/image/speech providers).
 * With a server configured they go through /api/outbound (one egress point,
 * no browser CORS); otherwise they hit the provider directly.
 * GET/HEAD requests with no body pass headers through; anything with a JSON
 * body is wrapped in the proxy envelope.
 */
export async function outboundFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const base = serverBase()
  if (!base) return fetch(url, init)
  const { serverToken } = useSettingsStore.getState()
  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((value, key) => {
    headers[key] = value
  })
  const method = (init.method ?? 'GET').toUpperCase()
  let body: unknown
  if (typeof init.body === 'string' && init.body) {
    try {
      body = JSON.parse(init.body)
    } catch {
      body = init.body
    }
  }
  return fetch(`${base}/api/outbound`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(serverToken ? { Authorization: `Bearer ${serverToken}` } : {}),
    },
    body: JSON.stringify({ url, method, headers, body }),
    signal: init.signal,
  })
}

/** With a server configured, AI calls go through /api/ai-proxy and no local key is needed. */
export function hasAiAccess(settings: { serverUrl?: string; apiKey?: string }): boolean {
  return Boolean((settings.serverUrl ?? serverBase()) || settings.apiKey?.trim())
}

/** Dexie's get() returned undefined for missing rows; the server answers 404 instead. */
export async function getOrUndef<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return undefined
    throw error
  }
}
