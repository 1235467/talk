import { api } from './resources'

/**
 * Persist a freshly produced data URL as a media file and return its
 * `/media/<file>` reference. Anything else (http URL, existing /media/
 * reference) passes through untouched, so callers can feed mixed sources.
 */
export async function uploadDataUrlIfNeeded(url: string): Promise<string> {
  if (!url.startsWith('data:')) return url
  const { url: path } = await api.media.upload(url)
  return path
}
