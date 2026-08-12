import { describe, expect, it } from 'vitest'
import { resolveChatCompletionsUrl, resolveModelsUrl } from './providers'

describe('AI provider URL resolution', () => {
  it.each([
    ['https://api.example.com', 'https://api.example.com/chat/completions'],
    ['https://api.example.com/v1', 'https://api.example.com/v1/chat/completions'],
    ['https://api.example.com/api', 'https://api.example.com/api/chat/completions'],
    // Verbatim like SillyTavern: trailing slashes and full endpoint URLs are
    // the user's responsibility; the preview in SettingsPage shows the result.
    ['https://api.example.com/v1/', 'https://api.example.com/v1//chat/completions'],
    ['https://api.example.com/v1/chat/completions', 'https://api.example.com/v1/chat/completions/chat/completions'],
  ])('uses a custom base URL verbatim: %s', (input, expected) => {
    expect(resolveChatCompletionsUrl(input, 'custom')).toBe(expected)
  })

  it('pins named providers to the registry endpoint, ignoring stored overrides', () => {
    expect(resolveChatCompletionsUrl('https://user-proxy.example.com/x', 'openai'))
      .toBe('https://api.openai.com/v1/chat/completions')
    expect(resolveChatCompletionsUrl('', 'gemini'))
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
  })

  it('treats anthropic as user-editable like custom', () => {
    expect(resolveChatCompletionsUrl('https://proxy.example.com/anth', 'anthropic'))
      .toBe('https://proxy.example.com/anth/chat/completions')
    expect(resolveChatCompletionsUrl('', 'anthropic'))
      .toBe('https://api.anthropic.com/v1/chat/completions')
  })

  it('rejects empty custom input and non-http URLs', () => {
    expect(() => resolveChatCompletionsUrl('', 'custom')).toThrow('请填写 Base URL')
    expect(() => resolveChatCompletionsUrl('123456', 'custom')).toThrow('http:// 或 https://')
  })

  it('derives the models URL only for providers that declare a models endpoint', () => {
    expect(resolveModelsUrl('', 'deepseek')).toBe('https://api.deepseek.com/models')
    expect(resolveModelsUrl('https://ignored.example.com', 'openai')).toBe('https://api.openai.com/v1/models')
    expect(resolveModelsUrl('https://api.anthropic.com/v1', 'anthropic')).toBeNull()
    expect(resolveModelsUrl('https://api.example.com/v1', 'custom')).toBeNull()
  })
})
