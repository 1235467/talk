import { beforeEach, describe, expect, it } from 'vitest'
import { resetFakeServer } from '../test/setup'
import { api } from './api/resources'
import { getOrUndef } from './api/client'
import { deleteMomentCompletely } from './moments'
import { useSettingsStore } from '../store/useSettingsStore'

beforeEach(async () => {
  resetFakeServer()
  useSettingsStore.getState().setSettings({ albumSavedImages: [], hiddenAlbumUrls: [] })
})

describe('moment deletion', () => {
  it('removes comments, likes and social events with the post', async () => {
    await api.moments.put({ id: 'moment-a', contactId: 'user', content: '测试动态', createdAt: 1 })
    await api.momentComments.put({ id: 'comment-a', momentId: 'moment-a', authorContactId: 'user', content: '评论', createdAt: 2 })
    await api.momentLikes.put({ id: 'like-a', momentId: 'moment-a', likerId: 'user', createdAt: 2 })
    await api.socialEvents.put({ id: 'event-a', type: 'moment_commented', actorId: 'user', relatedContactIds: ['contact-a'], momentId: 'moment-a', summary: '测试', importance: 1, createdAt: 2 })

    expect(await deleteMomentCompletely('moment-a')).toBe(true)
    expect(await getOrUndef(api.moments.get('moment-a'))).toBeUndefined()
    expect(await api.momentComments.list({ momentId: 'moment-a' })).toHaveLength(0)
    expect(await api.momentLikes.list({ momentId: 'moment-a' })).toHaveLength(0)
    expect((await api.socialEvents.list()).filter((event) => event.momentId === 'moment-a')).toHaveLength(0)
  })

  it('keeps a deleted Moment image as a standalone album image', async () => {
    await api.moments.put({ id: 'moment-image', contactId: 'user', content: '带照片的动态', imageUrl: 'https://images.pexels.com/photos/1.jpg', createdAt: 3 })

    expect(await deleteMomentCompletely('moment-image')).toBe(true)
    expect(useSettingsStore.getState().albumSavedImages).toEqual([{
      url: 'https://images.pexels.com/photos/1.jpg',
      createdAt: 3,
      source: 'Pexels 实拍图',
      caption: '带照片的动态',
    }])
  })

  it('deletes the persistent generated-image asset linked to a Moment', async () => {
    await api.mediaAssets.put({ id: 'asset-a', origin: 'moment', originId: 'moment-asset', ownerContactIds: [], provider: 'atlas', status: 'completed', phase: 'completed', scene: 'lake', kind: 'scene', prompt: 'lake', attempt: 1, createdAt: 1, updatedAt: 2 })
    await api.moments.put({ id: 'moment-asset', contactId: 'user', content: 'lake', imageAssetId: 'asset-a', createdAt: 1 })
    await deleteMomentCompletely('moment-asset')
    expect(await getOrUndef(api.mediaAssets.get('asset-a'))).toBeUndefined()
  })
})
