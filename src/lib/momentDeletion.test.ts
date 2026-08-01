import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { deleteMomentCompletely } from './moments'

beforeEach(async () => {
  await db.open()
  await Promise.all([db.moments.clear(), db.momentComments.clear(), db.momentLikes.clear(), db.socialEvents.clear()])
})

describe('moment deletion', () => {
  it('removes comments, likes and social events with the post', async () => {
    await db.moments.add({ id: 'moment-a', contactId: 'user', content: '测试动态', createdAt: 1 })
    await db.momentComments.add({ id: 'comment-a', momentId: 'moment-a', authorContactId: 'user', content: '评论', createdAt: 2 })
    await db.momentLikes.add({ id: 'like-a', momentId: 'moment-a', likerId: 'user', createdAt: 2 })
    await db.socialEvents.add({ id: 'event-a', type: 'moment_commented', actorId: 'user', relatedContactIds: ['contact-a'], momentId: 'moment-a', summary: '测试', importance: 1, createdAt: 2 })

    expect(await deleteMomentCompletely('moment-a')).toBe(true)
    expect(await db.moments.get('moment-a')).toBeUndefined()
    expect(await db.momentComments.where('momentId').equals('moment-a').count()).toBe(0)
    expect(await db.momentLikes.where('momentId').equals('moment-a').count()).toBe(0)
    expect(await db.socialEvents.filter((event) => event.momentId === 'moment-a').count()).toBe(0)
  })
})
