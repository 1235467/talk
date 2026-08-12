import { extractJsonObject } from './ai/protocol'

export type TurnLogicReview = { status: 'pass' | 'reject' | 'unavailable'; reason: string }

export function parseTurnLogicReview(raw: string): TurnLogicReview {
  const json = extractJsonObject(raw)
  if (!json) return { status: 'unavailable', reason: '逻辑审查模型没有返回有效JSON' }
  try {
    const parsed = JSON.parse(json) as { valid?: unknown; reason?: unknown }
    if (parsed.valid !== true && parsed.valid !== false) return { status: 'unavailable', reason: '逻辑审查模型返回的 JSON 缺少 valid 布尔值' }
    return {
      status: parsed.valid === true ? 'pass' : 'reject',
      reason: typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 240) : '',
    }
  } catch {
    return { status: 'unavailable', reason: '逻辑审查模型返回格式无效' }
  }
}
