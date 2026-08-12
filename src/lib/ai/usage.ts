import { v4 as uuid } from 'uuid'
import { api } from '../api/resources'
import { invalidate } from '../api/keys'
import { useSettingsStore } from '../../store/useSettingsStore'
import { toDateKey } from '../time'
import type { AdminAiTraceStage, AiUsagePurpose } from '../../types'
import type { ChatMessage } from './types'

export class AiBudgetExceededError extends Error {
  constructor() { super('自动 AI 调用已达到今日预算上限') }
}

export async function assertAutomaticAiBudget(): Promise<void> {
  const cap = useSettingsStore.getState().automaticAiDailyCap
  if (!cap || cap < 1) return
  const today = toDateKey(new Date())
  const records = (await api.aiUsageRecords.list()).filter((r) => r.automatic && r.success && toDateKey(new Date(r.createdAt)) === today).length
  if (records >= cap) throw new AiBudgetExceededError()
}

export async function recordAiUsage(opts: {
  purpose: AiUsagePurpose; model: string; automatic: boolean; success: boolean
  inputTokens: number; outputTokens: number; estimated: boolean; error?: string
}) {
  await api.aiUsageRecords.put({ id: uuid(), createdAt: Date.now(), ...opts })
  invalidate('aiUsageRecords')
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3))
}

export async function traceAiCall(opts: { purpose: AiUsagePurpose; model: string; messages: ChatMessage[]; output?: string; error?: string; inputTokens: number; outputTokens: number; durationMs?: number; turnId?: string; stage?: AdminAiTraceStage; conversationId?: string }) {
  try {
    void api.aiTurns.put({ id: uuid(), createdAt: Date.now(), ...opts } as never).catch(() => undefined)
  } catch {}
}

/** Records deterministic follow-up work in the same Sky Eye timeline as AI calls. */
export async function traceTurnEvent(opts: {
  turnId?: string
  conversationId?: string
  stage: AdminAiTraceStage
  model?: string
  input?: string
  output?: string
  error?: string
  durationMs?: number
}): Promise<void> {
  await traceAiCall({
    purpose: 'other', model: opts.model ?? '本地执行',
    messages: opts.input ? [{ role: 'system', content: opts.input }] : [],
    output: opts.output, error: opts.error, inputTokens: 0, outputTokens: 0,
    durationMs: opts.durationMs, turnId: opts.turnId, stage: opts.stage,
    conversationId: opts.conversationId,
  })
}
