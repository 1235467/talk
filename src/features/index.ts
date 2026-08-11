import { useSettingsStore } from '../store/useSettingsStore'
import { shopModule } from './shop'
import { warehouseModule } from './warehouse'
import { worldviewModule } from './worldview'
import { knowledgeBaseModule } from './knowledgeBase'
import { relationshipModule } from './relationship'
import { personalityTraitsModule } from './personalityTraits'
import { proactiveChatModule } from './proactiveChat'
import { mindReadingModule } from './mindReading'
import { intentModule } from './intent'
import { storyOutlineModule } from './storyOutline'
import { careerModule } from './career'
import { lifeSimulationModule } from './lifeSimulation'
import { saveLoadModule } from './saveLoad'
import { realisticRepliesModule } from './realisticReplies'
import { locationModule } from './location'
import { directOutputModule } from './directOutput'
import type { FeatureModule, ParentModule } from './types'

// ---- parent modules (accordion groups in the UI) ----

export const PARENT_MODULES: ParentModule[] = [
  {
    id: 'character-soul',
    name: '角色灵魂',
    icon: '✨',
    description: '世界观、资料库、好感度、特色人格、心情系统、读心与AI内部意图',
  },
  {
    id: 'chat-assist',
    name: '聊天辅助',
    icon: '🛠️',
    description: 'AI自主行为等辅助能力',
  },
  {
    id: 'more-interaction',
    name: '更多互动',
    icon: '🎁',
    description: '商城购物与仓库赠送',
  },
]

// ---- registry ----
// Every module gets listed here. When you add a new module, import it above
// and add it to this array — that's the only registration step needed.

export const ALL_MODULES: FeatureModule[] = [
  shopModule,
  warehouseModule,
  worldviewModule,
  knowledgeBaseModule,
  relationshipModule,
  personalityTraitsModule,
  proactiveChatModule,
  mindReadingModule,
  intentModule,
  storyOutlineModule,
  careerModule,
  lifeSimulationModule,
  saveLoadModule,
  realisticRepliesModule,
  locationModule,
  directOutputModule,
]

/** Modules that don't belong to any parent — shown as standalone toggles. */
export const STANDALONE_MODULES = ALL_MODULES.filter((m) => !m.parentId)

export const IMMERSIVE_RESTRICTED_MODULES = new Set(['location', 'mindReading', 'intent', 'lifeSimulation', 'storyOutline'])

export function isModuleAllowedInExperienceMode(id: string, mode = useSettingsStore.getState().experienceMode): boolean {
  return mode !== 'immersive' || !IMMERSIVE_RESTRICTED_MODULES.has(id)
}

function moduleEffectivelyEnabled(id: string, state = useSettingsStore.getState()): boolean {
  if (state.experienceMode === 'immersive' && id === 'realisticReplies') return true
  return isModuleAllowedInExperienceMode(id, state.experienceMode) && state.enabledModules.includes(id)
}

// ---- helpers ----

/** React hook: is a specific module enabled? */
export function useModuleEnabled(id: string): boolean {
  return useSettingsStore((s) => s.experienceMode === 'immersive' && id === 'realisticReplies'
    ? true
    : isModuleAllowedInExperienceMode(id, s.experienceMode) && s.enabledModules.includes(id))
}

/** Non-reactive read for use outside React components (e.g. chat engine). */
export function isModuleEnabled(id: string): boolean {
  return moduleEffectivelyEnabled(id)
}

// ---- defaults ----

/** Every module is on by default except opt-in background/debug modules. */
export const DEFAULT_ENABLED_MODULES: string[] = ALL_MODULES
  .filter((m) => m.id !== 'proactiveChat' && m.id !== 'mindReading' && m.id !== 'lifeSimulation' && m.id !== 'realisticReplies' && m.id !== 'directOutput')
  .map((m) => m.id)
