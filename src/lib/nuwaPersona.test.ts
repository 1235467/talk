import { describe, expect, it } from 'vitest'
import { localNuwaFormatIssues, parseNuwaReview, parseNuwaStructuredResult } from './nuwaPersona'

describe('Nuwa persona protocol', () => {
  it('parses fenced JSON and legacy Chinese field aliases', () => {
    const parsed = parseNuwaStructuredResult('```json\n{"真名":"林夏","昵称":"小夏","兴趣爱好":["摄影","徒步"]}\n```')
    expect(parsed?.realName).toBe('林夏')
    expect(parsed?.nickname).toBe('小夏')
    expect(parsed?.hobbies).toBe('摄影、徒步')
  })

  it('reports missing, wrongly typed, and extra fields', () => {
    const issues = localNuwaFormatIssues('{"realName":42,"extra":"value"}')
    expect(issues.join('\n')).toContain('缺少字段')
    expect(issues.join('\n')).toContain('字段必须是字符串：realName')
    expect(issues.join('\n')).toContain('包含未允许字段：extra')
  })

  it('keeps only string review issues', () => {
    expect(parseNuwaReview('{"valid":false,"issues":["缺少生日",42]}'))
      .toEqual({ valid: false, issues: ['缺少生日'] })
  })
})
