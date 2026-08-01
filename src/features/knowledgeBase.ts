import { lazy } from 'react'
import type { FeatureModule } from './types'

const KnowledgeBasePage = lazy(() => import('../pages/KnowledgeBasePage').then(({ KnowledgeBasePage }) => ({ default: KnowledgeBasePage })))

export const knowledgeBaseModule: FeatureModule = {
  id: 'knowledgeBase',
  name: '资料库',
  icon: '📚',
  description: '统一保存角色卡、外部世界书、联网结果和手写资料',
  parentId: 'character-soul',
  routes: [{ path: '/library', component: KnowledgeBasePage }, { path: '/knowledge-base', component: KnowledgeBasePage }],
  discoverEntries: [{ to: '/library', icon: '📚', label: '资料库' }],
}
