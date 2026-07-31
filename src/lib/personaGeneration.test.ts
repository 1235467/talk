import { describe, expect, it } from 'vitest'
import { buildPersonaGenerationPrompt, parsePersonaGeneration, type PersonaAnswers } from './prompt'

const answers: PersonaAnswers = {
  personalityTags: ['慢热'],
  ageRange: '20-25岁',
  gender: '女',
  relationship: '朋友',
  personalityTrait: '猫系',
  hobbies: ['看书'],
  extra: '',
}

describe('persona initial warmth', () => {
  it('asks the model to decide initial warmth only for Nuwa drafts', () => {
    expect(buildPersonaGenerationPrompt({ ...answers, draftMode: true }, 'anime')).toContain('"initialWarmth": 35')
    expect(buildPersonaGenerationPrompt({ ...answers, draftMode: false }, 'anime')).not.toContain('"initialWarmth": 35')
  })

  it('rounds and clamps the model-provided value', () => {
    const parsed = parsePersonaGeneration(JSON.stringify({
      name: '阿澄', persona: '测试人设', schedule: [], personalityTrait: '猫系', mbti: 'INFP', initialWarmth: 128.7,
    }))
    expect(parsed?.initialWarmth).toBe(100)
  })

  it('requires and parses structured past experiences', () => {
    expect(buildPersonaGenerationPrompt(answers, 'anime', undefined, '世界书中的旧事')).toContain('"pastExperiences"')
    const parsed = parsePersonaGeneration(JSON.stringify({
      name: '林夏', persona: '测试人设', schedule: [], personalityTrait: '猫系', mbti: 'INFP',
      pastExperiences: [{ title: '重逢', period: '去年', summary: '与旧友重新取得联系。', relatedContactNames: ['周晴'], importance: 88 }],
    }))
    expect(parsed?.pastExperiences).toEqual([{ title: '重逢', period: '去年', summary: '与旧友重新取得联系。', relatedContactNames: ['周晴'], importance: 88 }])
  })
})
