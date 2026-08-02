import { describe, expect, it } from 'vitest'
import { personalityTraitLine } from './prompt'
import { relationshipLine } from './relationship'

describe('established relationship prompt consistency', () => {
  it('does not downgrade a lover to a generic friend at medium warmth', () => {
    const line = relationshipLine('恋人', '', 45)
    expect(line).toContain('恋人关系')
    expect(line).toContain('既有关系')
    expect(line).not.toContain('算得上是朋友')
  })

  it('does not describe an established lover as still becoming acquainted', () => {
    const line = personalityTraitLine('爹系', 45, '恋人')
    expect(line).toContain('关系已确立')
    expect(line).not.toContain('逐渐熟悉')
  })

  it('keeps the ordinary friendship warmth wording for friends', () => {
    expect(relationshipLine('朋友', '', 45)).toContain('算得上是朋友')
  })
})
