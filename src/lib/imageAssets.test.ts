import { beforeEach, describe, expect, it } from 'vitest'
import { resetFakeServer } from '../test/setup'
import { api } from './api/resources'
import { useSettingsStore } from '../store/useSettingsStore'
import type { AppSettings, Contact } from '../types'
import { composeImagePrompt, createMediaAsset } from './imageAssets'

function contact(id: string, name: string, identity: string): Contact {
  return {
    id, name, avatar: '🙂', avatarColor: '#ddd', systemPrompt: `${name} persona`,
    visualIdentity: identity, visualSeed: id.charCodeAt(0), createdAt: 1,
    memoryFacts: '', memoryStyle: '', memoryUpdatedAt: 1, memoryMessageCursor: 0,
    relationshipBase: 'friend', relationshipDynamic: '',
  }
}

function settings(style: AppSettings['imageProviders']['atlas']['visualStyle'] = 'asian-realistic'): AppSettings {
  const current = useSettingsStore.getState()
  return {
    ...current,
    imageProvider: 'atlas',
    userNickname: 'Mina',
    imageProviders: {
      ...current.imageProviders,
      atlas: { ...current.imageProviders.atlas, visualStyle: style, customVisualStyle: 'muted watercolor editorial art' },
    },
  }
}

beforeEach(async () => {
  resetFakeServer()
})

describe('persistent image assets and prompt orchestration', () => {
  it('composes Atlas style before stable identities with an exact people constraint', () => {
    const prompt = composeImagePrompt({
      scene: 'friends taking a photo beside a lake', kind: 'group',
      contacts: [contact('a', 'Ari', 'oval face, short black hair'), contact('b', 'Bea', 'round face, long brown hair')],
      includeUser: true, userIdentity: 'angular face, shoulder-length dark hair', settings: settings(), provider: 'atlas',
    })

    expect(prompt).toContain('authentic contemporary Asian people')
    expect(prompt).toContain('Person A (Ari): oval face, short black hair')
    expect(prompt).toContain('Person B (Bea): round face, long brown hair')
    expect(prompt).toContain('Person C (Mina): angular face, shoulder-length dark hair')
    expect(prompt).toContain('Show exactly 3 distinct people')
    expect(prompt).toContain('do not blend faces')
  })

  it('supports custom Atlas style but does not apply it to other providers', () => {
    const atlasPrompt = composeImagePrompt({ scene: 'portrait', kind: 'portrait', contacts: [], includeUser: false, settings: settings('custom'), provider: 'atlas' })
    const otherPrompt = composeImagePrompt({ scene: 'portrait', kind: 'portrait', contacts: [], includeUser: false, settings: settings('custom'), provider: 'novelai' })
    expect(atlasPrompt).toContain('muted watercolor editorial art')
    expect(otherPrompt).not.toContain('muted watercolor editorial art')
  })

  it.each([
    ['european-realistic', 'authentic contemporary European people'],
    ['anime', 'high-quality modern 2D anime illustration'],
  ] as const)('applies the %s Atlas preset', (style, expected) => {
    expect(composeImagePrompt({ scene: 'portrait', kind: 'portrait', contacts: [], includeUser: false, settings: settings(style), provider: 'atlas' })).toContain(expected)
  })

  it('persists a queued placeholder task without storing provider API keys', async () => {
    const configured = settings()
    configured.imageProviders.atlas.apiKey = 'secret-key-that-must-not-be-stored'
    const asset = await createMediaAsset({ origin: 'chat', originId: 'message-1', conversationId: 'conversation-1', ownerContactIds: ['a'], scene: 'a quiet cafe', settings: configured })
    const stored = await api.mediaAssets.get(asset.id)
    expect(stored?.status).toBe('queued')
    expect(JSON.stringify(stored)).not.toContain('secret-key-that-must-not-be-stored')
  })
})
