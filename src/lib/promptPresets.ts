import type { AppSettings, Contact, PromptModuleSettings, PromptPreset } from '../types'
import { createDefaultPromptModules, normalizePromptModules } from './promptModules'
import { api } from './api/resources'
import { getOrUndef } from './api/client'
import { invalidate } from './api/keys'

export const SYSTEM_DEFAULT_PROMPT_PRESET_ID = 'system-default-prompt'

export function clonePromptModules(modules: PromptModuleSettings): PromptModuleSettings {
  return structuredClone(normalizePromptModules(modules))
}

export function systemDefaultPromptPreset(): PromptPreset {
  return {
    id: SYSTEM_DEFAULT_PROMPT_PRESET_ID,
    name: '默认提示词',
    modules: createDefaultPromptModules(),
    systemDefault: true,
    createdAt: 0,
    updatedAt: 0,
  }
}

export function normalizePromptPresets(value: unknown, legacyModules?: PromptModuleSettings): PromptPreset[] {
  const fallback = systemDefaultPromptPreset()
  const rows = Array.isArray(value) ? value : []
  const normalized = rows.flatMap((row): PromptPreset[] => {
    if (!row || typeof row !== 'object') return []
    const candidate = row as Partial<PromptPreset>
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return []
    return [{
      id: candidate.id,
      name: candidate.name.trim() || '未命名提示词',
      modules: normalizePromptModules(candidate.modules),
      systemDefault: candidate.id === SYSTEM_DEFAULT_PROMPT_PRESET_ID,
      createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
      updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : Date.now(),
    }]
  })
  const withoutSystem = normalized.filter((preset) => preset.id !== SYSTEM_DEFAULT_PROMPT_PRESET_ID)
  if (rows.length === 0 && legacyModules) {
    const legacy = normalizePromptModules(legacyModules)
    if (JSON.stringify(legacy) !== JSON.stringify(fallback.modules)) {
      withoutSystem.unshift({ id: 'migrated-global-prompt', name: '原全局提示词', modules: legacy, createdAt: Date.now(), updatedAt: Date.now() })
    }
  }
  return [fallback, ...withoutSystem]
}

export const FACTORY_PRESET_NAME = '默认提示词'

const FACTORY_HASH_KV_KEY = 'factoryPresetHash'

function factoryModulesHash(modules: PromptModuleSettings): string {
  const text = JSON.stringify(modules)
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  return String(hash >>> 0)
}

/**
 * Resolve the prompt modules for a contact in the two-layer model:
 * presetName → server preset (live by name) → legacy per-contact snapshot →
 * factory default. Group turns pass a bare "contact-less" resolution via
 * resolvePromptModules(undefined) which lands on the factory preset.
 */
export async function resolveContactPromptModules(contact: Contact | undefined, settings: Pick<AppSettings, 'promptModules'>): Promise<PromptModuleSettings> {
  if (contact?.presetName) {
    const preset = await getOrUndef(api.presets.get(contact.presetName))
    if (preset) return normalizePromptModules(preset.modules)
  }
  const factory = await getOrUndef(api.presets.get(FACTORY_PRESET_NAME))
  if (factory) return normalizePromptModules(factory.modules)
  return normalizePromptModules(settings.promptModules)
}

/**
 * Seed the server preset table: the read-only factory preset from code, plus
 * any user presets the legacy settings carried. The legacy "system default"
 * archive is deliberately skipped — it was always just a clone of the
 * factory preset and shares its name. Idempotent by name. The factory row is
 * refreshed whenever the code template changed since the last boot (hash in
 * kv), so app upgrades propagate new template text into the read-only row.
 */
export async function ensureServerPresets(settings: Pick<AppSettings, 'promptPresets' | 'promptModules'>): Promise<void> {
  const { isServerConfigured } = await import('./api/client')
  if (!isServerConfigured()) return
  const existing = new Set((await api.presets.list()).map((preset) => preset.name))
  const factoryModules = createDefaultPromptModules()
  if (!existing.has(FACTORY_PRESET_NAME)) {
    await api.presets.create(FACTORY_PRESET_NAME, factoryModules, true).catch(() => undefined)
    await api.kv.set(FACTORY_HASH_KV_KEY, factoryModulesHash(factoryModules)).catch(() => undefined)
    existing.add(FACTORY_PRESET_NAME)
  } else {
    const hash = factoryModulesHash(factoryModules)
    const storedHash = await getOrUndef(api.kv.get(FACTORY_HASH_KV_KEY))
    if (storedHash !== hash) {
      await api.presets.seedFactory(FACTORY_PRESET_NAME, factoryModules).catch(() => undefined)
      await api.kv.set(FACTORY_HASH_KV_KEY, hash).catch(() => undefined)
    }
  }
  for (const preset of normalizePromptPresets(settings.promptPresets, settings.promptModules)) {
    if (preset.systemDefault || existing.has(preset.name)) continue
    await api.presets.create(preset.name, preset.modules).catch(() => undefined)
    existing.add(preset.name)
  }
  invalidate('presets')
}
