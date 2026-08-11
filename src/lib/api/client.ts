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
  return serverBase().length > 0
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
