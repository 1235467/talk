import { describe, expect, it } from 'vitest'
import { momentNoveltyIssue } from './moments'

describe('moment novelty guard', () => {
  it('rejects an exact post even when whitespace and punctuation differ', () => {
    expect(momentNoveltyIssue('今晚加班修图，窗外就下雨了。戴上耳机倒也不错！', [
      { content: '今晚加班修图 窗外就下雨了 戴上耳机倒也不错' },
    ])).toContain('完全相同')
  })

  it('allows unrelated posts from the same person', () => {
    expect(momentNoveltyIssue('下班路上买到了惦记很久的面包，热乎乎的。', [
      { content: '今晚加班修图，窗外就下雨了，戴上耳机倒也不错。' },
    ])).toBeNull()
  })
})
