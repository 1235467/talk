import { lazy } from 'react'
import type { FeatureModule } from './types'

const WorldSettingsPage = lazy(() => import('../pages/WorldSettingsPage').then(({ WorldSettingsPage }) => ({ default: WorldSettingsPage })))
const WorldbookCollectionPage = lazy(() => import('../pages/WorldbookCollectionPage').then(({ WorldbookCollectionPage }) => ({ default: WorldbookCollectionPage })))

export const worldviewModule: FeatureModule = {
  id: 'worldview',
  name: '世界观',
  icon: '📖',
  description: '管理多个正史存档；每次生成只使用联系人或群聊所属的一个世界',
  parentId: 'character-soul',
  routes: [
    { path: '/world-settings', component: WorldSettingsPage },
    { path: '/world-settings/:collectionId', component: WorldbookCollectionPage },
  ],
  discoverEntries: [{ to: '/world-settings', icon: '📖', label: '世界观' }],
}
