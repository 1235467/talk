import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api/resources'
import type { Message } from '../types'
import { isAiTestId } from './aiTestIsolation'

/** Only incoming (assistant) messages count as unread — the user's own sent messages never do, regardless of lastReadAt. */
export function unreadCountFor(lastReadAt: number | undefined, messages: Message[]): number {
  const since = lastReadAt ?? 0
  return messages.filter((m) => m.role === 'assistant' && m.createdAt > since).length
}

interface UnreadCounts {
  byConversation: Map<string, number>
  lastMessageByConversation: Map<string, Message>
  total: number
}

const EMPTY_COUNTS: UnreadCounts = { byConversation: new Map(), lastMessageByConversation: new Map(), total: 0 }

/**
 * Shared unread counts computed from two react-query subscriptions — previously every consumer
 * (BottomNav + MessagesPage + SearchOverlay) ran its own `db.messages.toArray()` full-table scan on
 * each Dexie change. Now the scan + grouping happens once per query invalidation and all consumers
 * read the same cached query data (query keys match the table names used by invalidate()).
 */
function useUnreadCounts(): UnreadCounts {
  const { data: conversations } = useQuery({ queryKey: ['conversations'], queryFn: () => api.conversations.list() })
  const { data: messages } = useQuery({ queryKey: ['messages'], queryFn: () => api.messages.list() })
  return useMemo(() => {
    if (!conversations || !messages) return EMPTY_COUNTS
    const visibleConversations = conversations.filter((item) => !isAiTestId(item.id))
    const visibleMessages = messages.filter((item) => !isAiTestId(item.conversationId))
    const messagesByConv = new Map<string, Message[]>()
    const lastMessageByConversation = new Map<string, Message>()
    for (const m of visibleMessages) {
      const arr = messagesByConv.get(m.conversationId)
      if (arr) arr.push(m)
      else messagesByConv.set(m.conversationId, [m])
      const previous = lastMessageByConversation.get(m.conversationId)
      if (!previous || m.createdAt > previous.createdAt) lastMessageByConversation.set(m.conversationId, m)
    }
    const byConversation = new Map<string, number>()
    let total = 0
    for (const c of visibleConversations) {
      const n = unreadCountFor(c.lastReadAt, messagesByConv.get(c.id) ?? [])
      byConversation.set(c.id, n)
      total += n
    }
    return { byConversation, lastMessageByConversation, total }
  }, [conversations, messages])
}

/** Total unread across all conversations. Backed by the shared query cache. */
export function useTotalUnread(): number {
  return useUnreadCounts().total
}

/** Per-conversation unread counts from the same shared queries. */
export function useUnreadByConversation(): Map<string, number> {
  return useUnreadCounts().byConversation
}

/** Latest message for each conversation, computed during the same scan as unread counts. */
export function useLastMessageByConversation(): Map<string, Message> {
  return useUnreadCounts().lastMessageByConversation
}
