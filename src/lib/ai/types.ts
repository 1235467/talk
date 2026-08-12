import type { AdminAiTraceStage, AiUsagePurpose } from '../../types'
import type { AiProviderId } from './providers'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: ChatToolCall[]
}

export interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type ChatCompletionStatus = 'ok' | 'empty' | 'blocked' | 'length' | 'malformed'

export interface ChatCompletionResult {
  status: ChatCompletionStatus
  content: string
  reasoning?: string
  finishReason?: string
  usage?: { promptTokens?: number; completionTokens?: number; reasoningTokens?: number; totalTokens?: number }
  retried?: boolean
  toolCalls?: ChatToolCall[]
}

export interface ChatCompletionOptions {
  apiKey: string
  baseUrl: string
  model: string
  provider?: AiProviderId
  messages: ChatMessage[]
  signal?: AbortSignal
  /**
   * Only safe for genuinely single-turn calls (persona generation, memory
   * summarization) that never carry accumulated assistant history. On the
   * main multi-turn chat call, forcing json_object mode was measured to
   * make the model emit pure-whitespace/blank completions from the 2nd
   * turn onward — see coalesceConsecutiveRoles's neighbor note and project
   * memory. Leave this off there and rely on prompt instructions instead.
   */
  jsonMode?: boolean
  purpose?: AiUsagePurpose
  automatic?: boolean
  trace?: { turnId: string; stage: AdminAiTraceStage; conversationId?: string }
  tools?: ChatToolDefinition[]
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
  /**
   * Progressive delivery for streaming responses: fires per content delta
   * when the provider profile enables streaming, once with the full content
   * otherwise.
   */
  onDelta?: (text: string) => void
}
