import { describe, expect, it } from 'vitest'
import {
  parseJsonLoose,
} from './aiProtocol'

describe('parseJsonLoose', () => {
  it('parses plain JSON and fenced JSON', () => {
    expect(parseJsonLoose<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true })
    expect(parseJsonLoose<{ ok: boolean }>('```json\n{"ok":true}\n```')).toEqual({ ok: true })
  })

  it('extracts the first balanced object from surrounding model prose', () => {
    const raw = '处理完成： {"outer":{"text":"brace } inside string"},"items":[1,2]} 谢谢'
    expect(parseJsonLoose(raw)).toEqual({ outer: { text: 'brace } inside string' }, items: [1, 2] })
  })

  it('returns null for empty, incomplete, and invalid JSON', () => {
    expect(parseJsonLoose('')).toBeNull()
    expect(parseJsonLoose('{"ok":true')).toBeNull()
    expect(parseJsonLoose('not json at all')).toBeNull()
  })
})

