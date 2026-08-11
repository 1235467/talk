import { describe, expect, it } from 'vitest'
import { createDefaultImageProviders, createDefaultStickerProviders } from './mediaProviders'
import { generateRemoteImage, searchRemoteStickers } from './remoteMedia'

const giphyKey = import.meta.env.VITE_LIVE_GIPHY_API_KEY || ''
const atlasKey = import.meta.env.VITE_LIVE_ATLAS_API_KEY || ''
const runLive = import.meta.env.VITE_RUN_LIVE_MEDIA_TESTS === '1'

describe.runIf(runLive)('live remote media providers', () => {
  it('searches GIPHY and generates one real Atlas image', async () => {
    expect(giphyKey, 'missing GIPHY key').not.toBe('')
    expect(atlasKey, 'missing Atlas key').not.toBe('')

    const stickerProviders = createDefaultStickerProviders()
    stickerProviders.giphy.apiKey = giphyKey
    const stickers = await searchRemoteStickers({ stickerProvider: 'giphy', stickerProviders }, 'tired reaction')
    expect(stickers.length).toBeGreaterThan(0)
    expect(stickers[0].url).toMatch(/^https:\/\//)

    const imageProviders = createDefaultImageProviders()
    imageProviders.atlas.apiKey = atlasKey
    const image = await generateRemoteImage(
      { imageProvider: 'atlas', imageProviders },
      'an orange cat sitting by a convenience store window on a rainy night, cinematic lighting, cozy atmosphere',
    )
    console.info(JSON.stringify({ liveMedia: { giphyResults: stickers.length, atlasGenerated: !!image?.url } }))
    expect(image?.url).toMatch(/^(https:\/\/|data:image\/)/)
  }, 180_000)
})
