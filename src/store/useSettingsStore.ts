import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_STYLE_PROMPT } from '../lib/prompt'
import { INITIAL_WALLET_BALANCE } from '../lib/wallet'
import {
  createDefaultImageProviders,
  createDefaultStickerProviders,
  normalizeImageProviders,
  normalizeStickerProviders,
} from '../lib/mediaProviders'
import { createDefaultSpeechProviders, normalizeSpeechProviders } from '../lib/speechProviders'
import type { AppSettings } from '../types'
import { createDefaultPromptModules, normalizePromptModules } from '../lib/promptModules'
import { SYSTEM_DEFAULT_PROMPT_PRESET_ID, normalizePromptPresets } from '../lib/promptPresets'
import { normalizeChatPageSize } from '../lib/chatPagination'
import type { AiProviderId } from '../lib/aiProviders'
import { normalizeUiTheme } from '../lib/uiTheme'

/** AppSettings keys that are user data (shared across devices) rather than
 * per-device config. These mirror to the server kv store; everything else
 * (keys, providers, theme, layout) stays local. */
export const SERVER_SYNCED_KEYS = [
  'userNickname',
  'userAvatar',
  'userGender',
  'userBirthday',
  'userBio',
  'userVisualIdentity',
  'worldview',
  'momentsCoverPhoto',
  'albumSavedImages',
  'hiddenAlbumUrls',
  'promptModules',
  'proactiveMessageLog',
  'knowledgeQueryLog',
  'experienceMode',
  'enabledModules',
] as const

/** Pull server-kv values into the local store on launch (call after the user
 * configures serverUrl, or unconditionally — it no-ops without a server). */
export async function hydrateSettingsFromServer(): Promise<void> {
  try {
    const { api } = await import('../lib/api/resources')
    const { isServerConfigured } = await import('../lib/api/client')
    if (!isServerConfigured()) return
    const kv = await api.kv.list()
    const patch: Record<string, unknown> = {}
    for (const key of SERVER_SYNCED_KEYS) {
      if (key in kv && kv[key] !== undefined) patch[key] = kv[key]
    }
    if (Object.keys(patch).length) {
      useSettingsStore.setState(patch as Partial<AppSettings>)
    }
  } catch (error) {
    console.warn('[kv] hydrate failed', error)
  }
}

interface SettingsState extends AppSettings {
  setSettings: (patch: Partial<AppSettings>) => void
}

const envKey = import.meta.env.VITE_DEEPSEEK_API_KEY ?? ''
const envBaseUrl = import.meta.env.VITE_DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
const envTavilyKey = import.meta.env.VITE_TAVILY_API_KEY ?? ''
const envPexelsKey = import.meta.env.VITE_PEXELS_API_KEY ?? ''
const envGiphyKey = import.meta.env.VITE_GIPHY_API_KEY ?? ''
const envAtlasKey = import.meta.env.VITE_ATLAS_API_KEY ?? ''

function initialStickerProviders() {
  const providers = createDefaultStickerProviders()
  providers.giphy.apiKey = envGiphyKey
  return providers
}

function initialImageProviders() {
  const providers = createDefaultImageProviders()
  providers.atlas.apiKey = envAtlasKey
  return providers
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      experienceMode: 'free',
      serverUrl: '',
      serverToken: '',
      aiProvider: 'deepseek',
      apiKey: envKey,
      baseUrl: envBaseUrl,
      model: 'deepseek-v4-pro',
      utilityModel: 'deepseek-v4-flash',
      globalSystemPrompt: DEFAULT_STYLE_PROMPT,
      promptModules: createDefaultPromptModules(),
      promptPresets: normalizePromptPresets(undefined, createDefaultPromptModules()),
      activePromptPresetId: SYSTEM_DEFAULT_PROMPT_PRESET_ID,
      userNickname: '我',
      userAvatar: '🙂',
      userGender: '',
      userBirthday: '',
      userBio: '',
      userVisualIdentity: '',
      userVisualSeed: undefined,
      walletBalance: INITIAL_WALLET_BALANCE,
      userOccupation: '',
      userMonthlySalary: 0,
      jobBabyMode: false,
      momentsCoverPhoto: '',
      momentsLastReadAt: 0,
      proactiveDailyCap: 3,
      proactiveProbability: 0.25,
      proactiveSilenceThresholdMs: 45 * 60 * 1000,
      proactiveCooldownMs: 6 * 60 * 60 * 1000,
      proactiveMomentsMax: 3,
      proactiveTickIntervalMs: 5 * 60 * 1000,
      automaticAiDailyCap: 0,
      tavilyApiKey: envTavilyKey,
      worldview: '',
      worldbookMigrationCompleted: false,
      defaultWorldviewId: undefined,
      autoCompressLibraryImports: true,
      libraryCompressionThresholdTokens: 2000,
      pexelsApiKey: envPexelsKey,
      animeNsfwEnabled: false,
      avatarImageSource: 'anime',
      momentsImageSource: 'generated',
      hiddenAlbumUrls: [],
      albumSavedImages: [],
      stickerProvider: envGiphyKey ? 'giphy' : 'none',
      stickerProviders: initialStickerProviders(),
      imageProvider: envAtlasKey ? 'atlas' : 'none',
      imageProviders: initialImageProviders(),
      speechProvider: 'none',
      speechProviders: createDefaultSpeechProviders(),
      stickerApiUrl: '',
      stickerApiKey: '',
      imageApiUrl: '',
      imageApiKey: '',
      imageApiResponsePath: 'url',
      uiTheme: 'sage',
      themeMode: 'light',
      topInsetAdjustmentPx: 0,
      chatBackground: '',
      chatPageSize: 40,
      currencyIconMode: 'coin',
      animationsEnabled: true,
      customCurrencyEmoji: '💎',
      moodExpiryMs: 30 * 60 * 1000,
      adminModeEnabled: false,
      enabledModules: ['worldview', 'knowledgeBase', 'relationship', 'personalityTraits', 'intent', 'storyOutline', 'location'],
      setSettings: (patch) => {
        set(patch)
        // User data (not device config) mirrors to the server kv store so all
        // devices see the same profile/worldview/prompt modules. Writes are
        // fire-and-forget; hydration on launch is the authoritative read.
        for (const key of SERVER_SYNCED_KEYS) {
          if (key in patch) {
            void import('../lib/api/resources').then(({ api }) =>
              api.kv.set(key, (patch as Record<string, unknown>)[key]).catch((error) => console.warn('[kv] sync failed', key, error)),
            )
          }
        }
      },
    }),
    {
      name: 'talk-settings',
      version: 23,
      migrate: (persisted, version) => {
        const next = persisted as Partial<SettingsState>
        if (typeof next.serverUrl !== 'string') next.serverUrl = ''
        if (typeof next.serverToken !== 'string') next.serverToken = ''
        // Non-core features (shop/warehouse/career/saveLoad) are disabled until
        // they migrate to the server; strip them from any persisted list.
        if (Array.isArray(next.enabledModules)) {
          next.enabledModules = next.enabledModules.filter((id) => !['shop', 'warehouse', 'career', 'saveLoad'].includes(id))
        }
        if (next.experienceMode !== 'immersive' && next.experienceMode !== 'free') next.experienceMode = 'free'
        if (!['deepseek', 'openai', 'gemini', 'anthropic', 'xai', 'qwen', 'glm', 'minimax', 'kimi', 'custom'].includes(String(next.aiProvider))) {
          next.aiProvider = 'deepseek' as AiProviderId
        }
        if (version < 1 && Array.isArray(next.enabledModules) && !next.enabledModules.includes('intent')) {
          next.enabledModules = [...next.enabledModules, 'intent']
        }
        if (version < 2 && Array.isArray(next.enabledModules)) {
          next.enabledModules = next.enabledModules.filter((id) => id !== 'validator')
        }
        if (version < 3 && Array.isArray(next.enabledModules) && !next.enabledModules.includes('storyOutline')) {
          next.enabledModules = [...next.enabledModules, 'storyOutline']
        }
        if (version < 4 && Array.isArray(next.enabledModules) && !next.enabledModules.includes('career')) next.enabledModules = [...next.enabledModules, 'career']
        if (typeof next.userOccupation !== 'string') next.userOccupation = ''
        if (typeof next.userMonthlySalary !== 'number') next.userMonthlySalary = 0
        if (typeof next.jobBabyMode !== 'boolean') next.jobBabyMode = false
        if (typeof next.topInsetAdjustmentPx !== 'number') next.topInsetAdjustmentPx = 0
        if (typeof next.worldbookMigrationCompleted !== 'boolean') next.worldbookMigrationCompleted = false
        if (typeof next.autoCompressLibraryImports !== 'boolean') next.autoCompressLibraryImports = true
        if (typeof next.libraryCompressionThresholdTokens !== 'number') next.libraryCompressionThresholdTokens = 2000
        if (typeof next.automaticAiDailyCap !== 'number') next.automaticAiDailyCap = 0
        if (typeof next.userVisualIdentity !== 'string') next.userVisualIdentity = ''
        if (typeof next.userVisualSeed !== 'number') next.userVisualSeed = undefined
        if (typeof next.animeNsfwEnabled !== 'boolean') next.animeNsfwEnabled = false
        if (!['pexels', 'anime', 'generated'].includes(String(next.avatarImageSource))) next.avatarImageSource = 'anime'
        if (!['pexels', 'anime', 'generated'].includes(String(next.momentsImageSource))) next.momentsImageSource = 'generated'
        if (typeof next.animationsEnabled !== 'boolean') next.animationsEnabled = true
        next.chatPageSize = normalizeChatPageSize(next.chatPageSize)
        if (typeof next.stickerApiUrl !== 'string') next.stickerApiUrl = ''
        if (typeof next.stickerApiKey !== 'string') next.stickerApiKey = ''
        if (typeof next.imageApiUrl !== 'string') next.imageApiUrl = ''
        if (typeof next.imageApiKey !== 'string') next.imageApiKey = ''
        if (typeof next.imageApiResponsePath !== 'string') next.imageApiResponsePath = 'url'
        next.stickerProviders = normalizeStickerProviders(next.stickerProviders)
        next.imageProviders = normalizeImageProviders(next.imageProviders)
        next.speechProviders = normalizeSpeechProviders(next.speechProviders)
        if (version < 9) {
          if (next.stickerApiUrl?.trim() && !next.stickerProviders.custom.endpoint) {
            next.stickerProviders.custom.endpoint = next.stickerApiUrl.trim()
            next.stickerProviders.custom.apiKey = next.stickerApiKey?.trim() ?? ''
            next.stickerProvider = 'custom'
          }
          if (next.imageApiUrl?.trim() && !next.imageProviders.custom.endpoint) {
            next.imageProviders.custom.endpoint = next.imageApiUrl.trim()
            next.imageProviders.custom.apiKey = next.imageApiKey?.trim() ?? ''
            next.imageProviders.custom.responsePath = next.imageApiResponsePath?.trim() || 'url'
            next.imageProvider = 'custom'
          }
        }
        if (version < 10) {
          if (envGiphyKey && !next.stickerProviders.giphy.apiKey) {
            next.stickerProviders.giphy.apiKey = envGiphyKey
            if (!next.stickerProvider || next.stickerProvider === 'none') next.stickerProvider = 'giphy'
          }
          if (envAtlasKey && !next.imageProviders.atlas.apiKey) {
            next.imageProviders.atlas.apiKey = envAtlasKey
            if (!next.imageProvider || next.imageProvider === 'none') next.imageProvider = 'atlas'
          }
        }
        if (!['none', 'giphy', 'klipy', 'tenor', 'custom'].includes(String(next.stickerProvider))) next.stickerProvider = 'none'
        if (!['none', 'atlas', 'novelai', 'comfyui', 'stable-diffusion', 'custom'].includes(String(next.imageProvider))) next.imageProvider = 'none'
        if (!['none', 'doubao', 'mimo'].includes(String(next.speechProvider))) next.speechProvider = 'none'
        if (Array.isArray(next.enabledModules)) next.enabledModules = next.enabledModules.filter((id) => id !== 'mood')
        if (Array.isArray(next.enabledModules)) next.enabledModules = next.enabledModules.filter((id) => !['selfIteration', 'aiReplyAssist', 'promptModuleEditor'].includes(id))
        if (version < 16 && Array.isArray(next.enabledModules) && !next.enabledModules.includes('location')) next.enabledModules = [...next.enabledModules, 'location']
        next.uiTheme = normalizeUiTheme(next.uiTheme)
        next.promptModules = normalizePromptModules(next.promptModules, next.globalSystemPrompt)
        const normalizedPresets = normalizePromptPresets(next.promptPresets, next.promptModules)
        next.promptPresets = normalizedPresets
        if (!normalizedPresets.some((preset) => preset.id === next.activePromptPresetId)) {
          next.activePromptPresetId = normalizedPresets.find((preset) => !preset.systemDefault)?.id ?? SYSTEM_DEFAULT_PROMPT_PRESET_ID
        }
        return next
      },
    },
  ),
)
