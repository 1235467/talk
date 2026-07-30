/** Use Electron's same-origin protocol proxy without changing Android/web behavior. */
export function appFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const isPackagedDesktop = typeof window !== 'undefined' && Boolean(window.talkDesktop) && window.location.protocol === 'talk:'
  if (!/^https?:\/\//i.test(raw) || !isPackagedDesktop) return fetch(input, init)
  return fetch(`talk://app/__api__/${encodeURIComponent(raw)}`, init)
}
