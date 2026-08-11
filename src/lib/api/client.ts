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
