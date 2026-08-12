import type { ChatMessage } from './types'

/**
 * Merges consecutive same-role messages into one. Each AI turn is stored as
 * several separate assistant bubbles in the db (one per sentence/sticker),
 * so naively mapping history 1:1 produces long runs of back-to-back
 * "assistant" messages with no interleaved "user" turn — most chat APIs
 * (and the underlying chat template) expect strict user/assistant
 * alternation, and violating it visibly degrades reply quality from the
 * second turn onward. Coalescing restores one message per real turn.
 */
export function coalesceConsecutiveRoles(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  for (const m of messages) {
    const last = result[result.length - 1]
    // Tool-call exchanges must keep their exact message boundaries: merging
    // would break the assistant.tool_calls ↔ tool.tool_call_id pairing.
    if (last && last.role === m.role && !last.tool_calls && !m.tool_calls && !last.tool_call_id && !m.tool_call_id) {
      last.content = `${last.content}\n${m.content}`
    } else {
      result.push({ ...m })
    }
  }
  return result
}
