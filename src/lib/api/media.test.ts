import { afterEach, describe, expect, it } from 'vitest'
import { resetFakeServer } from '../../test/setup'
import { uploadDataUrlIfNeeded } from './media'

describe('uploadDataUrlIfNeeded', () => {
  afterEach(() => resetFakeServer())

  it('uploads data URLs and returns the /media/ reference', async () => {
    const result = await uploadDataUrlIfNeeded('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg')
    expect(result).toMatch(/^\/media\//)
  })

  it('passes http URLs and existing media references through untouched', async () => {
    expect(await uploadDataUrlIfNeeded('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(await uploadDataUrlIfNeeded('/media/abc.png')).toBe('/media/abc.png')
  })
})
