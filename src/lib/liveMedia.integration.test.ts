/**
 * 真实第三方媒体活集成测试 —— 默认跳过，不进常规 `npx vitest run`。
 *
 * 为什么默认跳过：
 * 1. Atlas 生图是**按次付费**的 API 调用，每跑一次都花钱；
 * 2. 需要真实 API Key（GIPHY/Atlas），且调用真实外网接口，受速率和网络可用性影响。
 *
 * 什么时候值得手动跑一次：改了 `remoteMedia.ts` / `mediaProviders.ts` / 服务器
 * `/api/outbound` 转发之后，确认线上链路（Key 有效、代理正常、返回格式没变）。
 *
 * 手动运行：
 *   VITE_RUN_LIVE_MEDIA_TESTS=1 \
 *   VITE_LIVE_GIPHY_API_KEY=... \
 *   VITE_LIVE_ATLAS_API_KEY=... \
 *   npx vitest run src/lib/liveMedia.integration.test.ts
 */
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
