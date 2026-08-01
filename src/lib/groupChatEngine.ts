import { v4 as uuid } from 'uuid'
import { db } from '../db/db'
import { chatCompletion as chatCompletionResult, chatCompletionText as chatCompletion, coalesceConsecutiveRoles, type ChatCompletionOptions, type ChatMessage } from './deepseek'
import {
  buildGroupJsonConversionPrompt,
  buildGroupRawChatPrompt,
  buildLocationRawChatPrompt,
  groupTypingDelayMs,
  parseGroupAiResponse,
  parseGroupRawDraft,
  pickSociallyConnectedSpeakers,
  serializeGroupTurn,
  stripSpeakerNamePrefix,
} from './groupChat'
import { parseJsonLoose } from './aiProtocol'
import { CONTEXT_WINDOW_SIZE, maybeUpdateGroupMemory, nonGroupScopedMemoriesText } from './memory'
import { aiRelationshipPrompt } from './contactRelations'
import { resolveKnowledgeQueries } from './knowledgeBase'
import { isModuleEnabled } from '../features'
import { describeCurrentTime } from './time'
import { displayName } from './contact'
import { previewForMessage } from './messagePreview'
import { buildUserProfileText, nextMessageTimestamp, useChatEngineStore } from './chatEngine'
import { reviewTurnLogic } from './turnLogicReviewer'
import { trackRemoteStickerSend } from './remoteMedia'
import { resolveBubbleMedia } from './bubbleMedia'
import { createTurnController, revealSequentially } from './conversationRuntime'
import { isImageProviderReady, isStickerProviderReady } from './mediaProviders'
import { realSeason, resolveLocationParticipants, syncContactLocationsAt, type LocationParticipants } from './locations'
import { recentSocialEventsText, recordSocialEvent } from './socialEvents'
import { recentSharedOriginalContext } from './sharedRecentContext'
import { createGroupPlan, planCardMessage } from './groupPlans'
import { useChatUiStore } from '../store/useChatUiStore'
import { retrieveWorldbookContext } from './worldbook'
import { featureActive, promptModuleEnabled } from './promptModules'
import { realisticReplyDelayMs } from './replyTiming'
import type { AppSettings, Contact, Group, GroupAiBubble, Message, Sticker } from '../types'

/** Load recent structured memories for each speaker in parallel. */
async function loadSpeakerMemories(speakers: Contact[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const results = await Promise.all(speakers.map(async (s) => {
    const text = await nonGroupScopedMemoriesText(s.id)
    return { id: s.id, text }
  }))
  for (const { id, text } of results) {
    if (text) map.set(id, text)
  }
  return map
}

/**
 * Same background-engine shape as chatEngine.ts (module-level bookkeeping,
 * reuses the same useChatEngineStore keyed by conversationId so ChatPage's
 * aiTyping/error subscription works unchanged for group conversations too)
 * — kept in its own file rather than folded into chatEngine.ts because the
 * group turn genuinely has a different shape (multiple personas per turn,
 * no relationship-dimension updates, a smaller text/sticker-only protocol)
 * and entangling the two would make chatEngine.ts's single-contact
 * assumptions harder to reason about. Memory (facts/style/plans) *is*
 * updated per speaker, via maybeUpdateGroupMemory — see memory.ts.
 */
const turns = createTurnController()

async function bestEffortUtilityCompletion(opts: ChatCompletionOptions): Promise<string> {
  try {
    const result = await chatCompletionResult(opts)
    if (result.status === 'ok' || (result.status === 'length' && result.content.trim())) return result.content
    console.warn(`[group] 格式转换器不可用 status=${result.status}，保留本地草稿`)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    console.warn('[group] 格式转换器调用失败，保留本地草稿', error)
  }
  return ''
}

function scheduleGroupAiTurn(
  conversationId: string,
  group: Group,
  members: Contact[],
  settings: AppSettings,
  stickers: Sticker[],
  streamId: string,
): void {
  const delay = realisticReplyDelayMs(isModuleEnabled('realisticReplies'))
  if (delay === 0) {
    void runGroupAiTurn(conversationId, group, members, settings, stickers, streamId)
    return
  }
  const timer = setTimeout(() => {
    if (!turns.isCurrent(conversationId, streamId)) return
    void runGroupAiTurn(conversationId, group, members, settings, stickers, streamId)
  }, delay)
  turns.addTimer(conversationId, timer)
}

function parseGroupTurnDebugPayload(
  mainPrompt: string,
  rawText: string,
  draftFeedback: string | undefined,
  jsonRaw: string,
  finalRaw: string,
  bubbles: GroupAiBubble[],
  knowledgeQueries: string[],
  turnSummary: string,
  groupVibe: string,
  storyOutline?: string,
): unknown {
  const parsed = parseJsonLoose(finalRaw)
  if (parsed && typeof parsed === 'object') {
    return { ...(parsed as Record<string, unknown>), mainPrompt, rawText, draftFeedback, jsonRaw, finalRaw, parsedBubbles: bubbles, storyOutline, promptTrace: { sections: [{ label: '群聊主提示词', content: mainPrompt }] } }
  }
  if (parsed !== null) return parsed
  return { mainPrompt, rawText, draftFeedback, jsonRaw, finalRaw, parsedBubbles: bubbles, knowledgeQueries, turnSummary, groupVibe, storyOutline, promptTrace: { sections: [{ label: '群聊主提示词', content: mainPrompt }] } }
}

/** Admin-only safe stop for a group generation and its queued bubbles. */
export function stopGroupAiTurn(conversationId: string): void {
  turns.begin(conversationId, uuid())
  useChatEngineStore.getState().patch(conversationId, { aiTyping: false, typingLabel: undefined, error: '已由管理员停止本轮群聊生成' })
}

export function resetAllGroupChatTurns(): void {
  turns.resetAll()
}

function parseCompressedGroupMemory(raw: string): string | null {
  const parsed = parseJsonLoose<{ memory?: unknown }>(raw)
  return typeof parsed?.memory === 'string' && parsed.memory.trim() ? parsed.memory.trim() : null
}

async function updateGroupMemoryAndVibe(opts: {
  group: Group
  aiTurnId: string
  settings: AppSettings
  turnSummary: string
  groupVibe: string
}): Promise<void> {
  const { group, aiTurnId, settings } = opts
  const now = Date.now()
  const timeLabel = new Date(now).toLocaleString()
  const turnSummary = opts.turnSummary.trim()
  const nextTurnCount = (group.memoryTurnCount ?? 0) + 1
  const appendedMemory = turnSummary
    ? [group.memory?.trim() ?? '', `[${timeLabel}] ${turnSummary}`].filter(Boolean).join('\n')
    : (group.memory ?? '')
  const patch: Partial<Group> = {
    memory: appendedMemory,
    vibe: opts.groupVibe.trim() || group.vibe || '',
    memoryTurnCount: nextTurnCount,
  }

  if (nextTurnCount % 5 === 0 && appendedMemory.trim()) {
    try {
      const raw = await chatCompletion({
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.utilityModel,
        jsonMode: true,
        messages: [
          {
            role: 'system',
            content: `你是群聊记忆压缩器。把群"${group.name}"的群聊记忆按时间线压缩，保留重要事件、固定梗、关系变化、长期氛围，不要保留流水账。输出JSON: {"memory":"..."}`,
          },
          {
            role: 'user',
            content: appendedMemory.slice(-5000),
          },
        ],
        purpose: 'memory',
        automatic: true,
      })
      const compressed = parseCompressedGroupMemory(raw)
      if (compressed) patch.memory = compressed
    } catch {
      // best-effort; keep appended memory if compression fails
    }
  }

  await db.groups.update(group.id, patch)
  const turn = await db.aiTurns.get(aiTurnId)
  if (turn?.parsed && typeof turn.parsed === 'object') {
    await db.aiTurns.update(aiTurnId, {
      parsed: { ...(turn.parsed as Record<string, unknown>), groupMemoryUpdate: patch },
    })
  }
}

function messageLabel(message: Message, contactById: Map<string, Contact>, userNickname: string): string {
  if (message.role === 'user') return userNickname || '我'
  const speaker = message.speakerContactId ? contactById.get(message.speakerContactId) : undefined
  return speaker ? displayName(speaker) : '某人'
}

function messageBody(message: Message): string {
  if (message.type === 'sticker') return `[表情: ${message.content}]`
  if (message.type === 'link') return `[链接: ${message.content}]`
  if (message.type === 'gift') return `[礼物: ${message.content}]`
  if (message.type === 'scheduleChange') return `[日程: ${message.content}]`
  return message.content
}

function formatGroupHistoryMessage(
  message: Message,
  contactById: Map<string, Contact>,
  messageById: Map<string, Message>,
  userNickname: string,
): ChatMessage {
  const speakerLabel = messageLabel(message, contactById, userNickname)
  const parts: string[] = []
  if (message.mentions?.length) {
    const names = message.mentions.map((id) => contactById.get(id)).filter((c): c is Contact => !!c).map(displayName)
    if (names.length > 0) parts.push(`@${names.join(' @')}`)
  }
  if (message.replyToMessageId) {
    const replied = messageById.get(message.replyToMessageId)
    if (replied) parts.push(`replying to ${messageLabel(replied, contactById, userNickname)}: "${messageBody(replied)}"`)
  }
  parts.push(messageBody(message))
  return { role: message.role, content: `${speakerLabel}: ${parts.join(' | ')}` }
}

function targetedContextText(
  latestUserMessage: Message | undefined,
  contactById: Map<string, Contact>,
  messageById: Map<string, Message>,
  userNickname: string,
): string {
  if (!latestUserMessage) return ''
  const lines: string[] = []
  if (latestUserMessage.mentions?.length) {
    const names = latestUserMessage.mentions.map((id) => contactById.get(id)).filter((c): c is Contact => !!c).map(displayName)
    if (names.length > 0) lines.push(`User explicitly @mentioned: ${names.join(', ')}`)
  }
  if (latestUserMessage.replyToMessageId) {
    const replied = messageById.get(latestUserMessage.replyToMessageId)
    if (replied) {
      lines.push(`User is replying to ${messageLabel(replied, contactById, userNickname)}: "${messageBody(replied)}"`)
    }
  }
  return lines.join('\n')
}

export async function sendGroupMessage(
  conversationId: string,
  group: Group,
  members: Contact[],
  settings: AppSettings,
  stickers: Sticker[],
  text: string,
  mentionContactIds: string[] = [],
  replyToMessageId?: string,
): Promise<void> {
  if (!text.trim()) return
  if (group.kind === 'location' && group.locationId) {
    await syncContactLocationsAt(new Date())
    const participants = await resolveLocationParticipants(group.locationId)
    members = participants.activeMembers.filter((member) => (member.worldviewId || settings.defaultWorldviewId) === (group.worldviewId || settings.defaultWorldviewId))
    group = { ...group, memberContactIds: members.map((member) => member.id) }
    await db.groups.update(group.id, { memberContactIds: group.memberContactIds })
  }
  if (!settings.apiKey && members.length > 0) {
    useChatEngineStore.getState().patch(conversationId, { error: '还没有配置API Key 请先去"我-设置"里填写' })
    return
  }

  const streamId = uuid()
  turns.begin(conversationId, streamId)
  useChatEngineStore.getState().patch(conversationId, { error: '', typingLabel: '群成员' })

  const messageCreatedAt = await nextMessageTimestamp(conversationId)
  const msg: Message = {
    id: uuid(),
    conversationId,
    role: 'user',
    type: 'text',
    content: text.trim(),
    mentions: mentionContactIds.length > 0 ? Array.from(new Set(mentionContactIds)) : undefined,
    replyToMessageId,
    createdAt: messageCreatedAt,
  }
  await db.messages.add(msg)
  await db.conversations.update(conversationId, { updatedAt: messageCreatedAt })
  if (group.kind === 'location' && members.length === 0) {
    useChatEngineStore.getState().patch(conversationId, { aiTyping: false, typingLabel: undefined, error: '' })
    return
  }
  if (msg.mentions?.length || msg.replyToMessageId) {
    const mentionedNames = msg.mentions
      ?.map((id) => members.find((member) => member.id === id))
      .filter((member): member is Contact => !!member)
      .map(displayName)
      .join('、')
    await recordSocialEvent({
      type: 'group_targeted_message',
      actorId: 'user',
      relatedContactIds: Array.from(new Set([...(msg.mentions ?? []), ...group.memberContactIds])),
      conversationId,
      groupId: group.id,
      messageId: msg.id,
      summary: mentionedNames
        ? `群聊"${group.name}"里，用户@了${mentionedNames}: ${text.trim()}`
        : `群聊"${group.name}"里，用户回复了一条消息: ${text.trim()}`,
      importance: 2,
    })
  }

  scheduleGroupAiTurn(conversationId, group, members, settings, stickers, streamId)
}

/** Trigger a group reply after a non-text user action has already been stored. */
export async function triggerGroupAiTurn(
  conversationId: string,
  group: Group,
  members: Contact[],
  settings: AppSettings,
  stickers: Sticker[],
): Promise<void> {
  if (!settings.apiKey) {
    useChatEngineStore.getState().patch(conversationId, { error: '还没有配置 API Key，请先去“我 / 设置”里填写' })
    return
  }
  const streamId = uuid()
  turns.begin(conversationId, streamId)
  useChatEngineStore.getState().patch(conversationId, { error: '', typingLabel: '群成员' })
  scheduleGroupAiTurn(conversationId, group, members, settings, stickers, streamId)
}

export async function regenerateGroupAiTurn(
  conversationId: string,
  group: Group,
  members: Contact[],
  settings: AppSettings,
  stickers: Sticker[],
  aiTurnId: string,
): Promise<void> {
  if (!settings.apiKey) {
    useChatEngineStore.getState().patch(conversationId, { error: '还没有配置 API Key，请先去“我 / 设置”里填写' })
    return
  }

  const streamId = uuid()
  turns.begin(conversationId, streamId)
  useChatEngineStore.getState().patch(conversationId, { error: '', typingLabel: '群成员' })

  const turnMessages = await db.messages
    .where('conversationId')
    .equals(conversationId)
    .filter((message) => message.debugAiTurnId === aiTurnId)
    .toArray()
  if (turnMessages.length > 0) await db.messages.bulkDelete(turnMessages.map((message) => message.id))
  await db.aiTurns.delete(aiTurnId)
  await db.conversations.update(conversationId, { updatedAt: Date.now() })

  scheduleGroupAiTurn(conversationId, group, members, settings, stickers, streamId)
}

async function runGroupAiTurn(
  conversationId: string,
  group: Group,
  members: Contact[],
  settings: AppSettings,
  stickers: Sticker[],
  streamId: string,
): Promise<void> {
  const engine = useChatEngineStore.getState()
  const turnStartedAt = performance.now()
  engine.patch(conversationId, { aiTyping: true, error: '', typingLabel: '群成员' })
  console.log(`[group] 开始生成回复 群=${group.name} conversationId=${conversationId}`)
  try {
    let locationParticipants: LocationParticipants | undefined
    if (group.kind === 'location' && group.locationId) {
      await syncContactLocationsAt(new Date())
      locationParticipants = await resolveLocationParticipants(group.locationId)
      members = locationParticipants.activeMembers.filter((member) => (member.worldviewId || settings.defaultWorldviewId) === (group.worldviewId || settings.defaultWorldviewId))
      group = { ...group, memberContactIds: members.map((member) => member.id) }
      await db.groups.update(group.id, { memberContactIds: group.memberContactIds })
    }
    if (members.length === 0) {
      engine.patch(conversationId, { error: group.kind === 'location' ? '' : '这个群里已经没有成员了', aiTyping: false, typingLabel: undefined })
      return
    }

    const contactById = new Map(members.map((c) => [c.id, c]))

    const history = await db.messages.where('conversationId').equals(conversationId).sortBy('createdAt')
    const messageById = new Map(history.map((m) => [m.id, m]))
    const latestUserMessage = [...history].reverse().find((m) => m.role === 'user')
    const preferredSpeakerIds = new Set(latestUserMessage?.mentions ?? [])
    const replied = latestUserMessage?.replyToMessageId ? messageById.get(latestUserMessage.replyToMessageId) : undefined
    if (replied?.role === 'assistant' && replied.speakerContactId) preferredSpeakerIds.add(replied.speakerContactId)
    const speakers = await pickSociallyConnectedSpeakers(members, Array.from(preferredSpeakerIds), group.speakerLimit ?? 3)
    console.log(`[group] 本轮发言人: ${speakers.map((s) => s.name).join('、')}`)
    const targetContext = targetedContextText(latestUserMessage, contactById, messageById, settings.userNickname)
    const recentEventsText = await recentSocialEventsText(members.map((m) => m.id), 4)
    const sharedOriginalContext = promptModuleEnabled(settings, 'memory') ? await recentSharedOriginalContext(members.map((m) => m.id), settings.userNickname, {
      maxMessages: 60,
      maxChars: 10_000,
      // This group already contributes its recent raw history below. Excluding
      // it here avoids paying twice for the same messages.
      excludeConversationId: conversationId,
    }) : ''
    const worldbookText = featureActive(settings, 'worldview') ? await retrieveWorldbookContext([group.name, group.vibe, targetContext, history.slice(-10).map((m) => m.content).join(' '), members.map((m) => `${m.name} ${m.systemPrompt}`).join(' ')].filter(Boolean).join('\n'), { worldviewId: group.worldviewId }) : ''

    const speakerMemoriesMap = promptModuleEnabled(settings, 'memory') ? await loadSpeakerMemories(speakers) : new Map<string, string>()
    const aiRelationshipText = featureActive(settings, 'relationship') ? await aiRelationshipPrompt(members) : ''
    const remoteStickerSearchEnabled = isStickerProviderReady(settings)
    const imageGenerationEnabled = isImageProviderReady(settings)
    const mediaPromptOptions = { remoteStickerSearchEnabled, imageGenerationEnabled }
    const location = group.kind === 'location' && group.locationId ? await db.locations.get(group.locationId) : undefined
    const promptBuilder = group.kind === 'location' ? buildLocationRawChatPrompt : buildGroupRawChatPrompt
    const participantPositions = locationParticipants
      ? [
          ...locationParticipants.here.map((contact) => `- ${displayName(contact)}：here，正在当前地点`),
          ...locationParticipants.audible.map(({ contact, audibility }) => `- ${displayName(contact)}：${audibility}，位于${contact.currentLocationId ?? '未知地点'}`),
        ].join('\n')
      : ''
    const systemPrompt = promptBuilder({
      stylePrompt: settings.globalSystemPrompt,
      groupName: group.name,
      allMembers: members,
      speakers,
      stickerNames: stickers.map((s) => s.name),
      remoteStickerSearchEnabled,
      imageGenerationEnabled,
      imageSearchEnabled: !!settings.pexelsApiKey,
      groupMemoryText: group.memory,
      groupVibeText: group.vibe,
      allowAiChatter: group.allowAiChatter ?? true,
      energyLevel: group.energyLevel ?? 'normal',
      currentTimeText: describeCurrentTime(new Date()),
      userProfileText: buildUserProfileText(settings),
      targetedContextText: targetContext,
      recentEventsText: recentEventsText || undefined,
      worldviewText: worldbookText || undefined,
      knowledgeDigestText: undefined,
      selfIterationGlobalText: featureActive(settings, 'selfIteration') ? settings.selfIterationGlobalPrompt : undefined,
      speakerMemoriesMap,
      aiRelationshipText,
      locationContextText: location
        ? `当前地点：${location.name}\n地点描述：${location.description}\n设备现实时间：${describeCurrentTime(new Date())}\n现实季节：${realSeason(new Date())}\n人物位置与听觉状态：\n${participantPositions || '当前没有任何人物能听见'}\n模型只能从本轮可发言成员中选择说话人。muffled人物只能隔墙、隔门或从远处搭话。`
        : undefined,
      promptModules: settings.promptModules,
      enabledModules: settings.enabledModules,
    })
    if (!systemPrompt.trim()) throw new Error('对话核心提示词模块已屏蔽')

    const recentHistory = history.slice(-CONTEXT_WINDOW_SIZE)
    const controller = new AbortController()
    turns.setAbortController(conversationId, controller)

    // ChatSLG retired per-turn pre-draft outlines because they add a complete
    // serial model request before every group reply. The main prompt already
    // contains the same planning, persona, pacing, and topic contracts.
    const storyOutline = ''
    // Group history needs an explicit "who said this" label per line — unlike
    // 1:1 chat where the single assistant persona is implicit from the system
    // prompt, a group turn's assistant block can contain several different
    // people, and role:"assistant" alone can't distinguish them across turns.
    const chatMessages: ChatMessage[] = coalesceConsecutiveRoles([
      { role: 'system', content: [systemPrompt, sharedOriginalContext].filter(Boolean).join('\n\n') },
      ...recentHistory.map((m): ChatMessage => formatGroupHistoryMessage(m, contactById, messageById, settings.userNickname)),
    ])
    let rawText = await chatCompletion({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      model: settings.model,
      messages: chatMessages,
      signal: controller.signal,
      purpose: 'chat',
      thinking: 'disabled',
      temperature: 0.9,
      maxTokens: 1000,
      trace: { turnId: streamId, stage: 'first_chat', conversationId },
    })

    if (!turns.isCurrent(conversationId, streamId)) return
    console.log(`[group] 主模型群聊草稿(${rawText.length}字): ${rawText.slice(0, 160)}...`)
    let draftFeedback: string | undefined
    let localDraft = parseGroupRawDraft(rawText, speakers, stickers.map((sticker) => sticker.name), remoteStickerSearchEnabled)
    localDraft.groupVibe = group.vibe || '自然、轻松的日常群聊。'
    let parsedTurn = localDraft
    let jsonRaw = serializeGroupTurn(localDraft)
    if (!localDraft.valid || localDraft.needsUtility) {
      draftFeedback = !localDraft.valid
        ? `格式已交给多功能模型修复：${localDraft.reason || '草稿格式不完整'}`
        : '本轮可能包含共同计划，交给多功能模型提取结构化动作。'
      jsonRaw = await bestEffortUtilityCompletion({
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.utilityModel,
        messages: [{
          role: 'system',
          content: buildGroupJsonConversionPrompt(rawText, speakers, stickers.map((s) => s.name), mediaPromptOptions),
        }, {
          role: 'user',
          content: '请执行上述转换，并且只输出指定的 JSON 对象。',
        }],
        jsonMode: true,
        signal: controller.signal,
        thinking: 'disabled',
        temperature: 0.1,
        maxTokens: 900,
        trace: { turnId: streamId, stage: 'other', conversationId },
      })
      if (!turns.isCurrent(conversationId, streamId)) return
      const converted = parseGroupAiResponse(jsonRaw, speakers.length)
      if (converted.bubbles.length > 0) parsedTurn = { ...converted, valid: true, needsUtility: false }
      else jsonRaw = serializeGroupTurn(localDraft)
      console.log(`[group] ${draftFeedback}`)
    } else {
      console.log('[group] 本地解析完成，跳过草稿审查与多功能模型转换')
    }

    let finalRaw = jsonRaw
    let { bubbles, knowledgeQueries, turnSummary, groupVibe, planCandidates } = parsedTurn
    const initiallyRequestedKnowledge = [...knowledgeQueries]
    let reviewFailure = draftFeedback
    const runLogicReview = (stage: 'first_quality' | 'second_quality') => reviewTurnLogic({
      settings,
      latestUserText: latestUserMessage?.content ?? '',
      draftText: rawText,
      personaFacts: [
        ...speakers.map((speaker) => `${displayName(speaker)}：${speaker.systemPrompt.slice(0, 700)}${speaker.personaConstraints ? `；硬约束=${speaker.personaConstraints.slice(0, 350)}` : ''}${featureActive(settings, 'personalityTraits') && speaker.personalityTrait ? `；人格特质=${speaker.personalityTrait}` : ''}${promptModuleEnabled(settings, 'memory') && speaker.sharedHistory ? `；共同过往锚点=${speaker.sharedHistory.slice(0, 500)}` : ''}`),
        `群聊设置：热闹程度=${group.energyLevel ?? 'normal'}；AI互聊=${group.allowAiChatter === false ? '关闭' : '开启'}`,
        targetContext ? `本轮定向上下文=${targetContext.slice(0, 600)}` : '',
        featureActive(settings, 'worldview') && worldbookText ? `命中世界书=${worldbookText.slice(0, 800)}` : '',
      ].filter(Boolean).join('\n'),
      recentContext: recentHistory
        .slice(-4)
        .map((message) => formatGroupHistoryMessage(message, contactById, messageById, settings.userNickname).content)
        .join('\n'),
      signal: controller.signal,
      trace: { turnId: streamId, stage, conversationId },
    })
    let logicReview = bubbles.length > 0 ? await runLogicReview('first_quality') : undefined
    if (!turns.isCurrent(conversationId, streamId)) return
    if (logicReview?.status === 'unavailable') {
      draftFeedback = `审查降级：${logicReview.reason}`
      console.warn(`[group] 逻辑审查不可用，放行已解析回复 群=${group.name} 原因=${logicReview.reason}`)
    }
    if (logicReview?.status === 'reject') {
      reviewFailure = logicReview.reason || '群聊回复存在客观逻辑问题'
      draftFeedback = reviewFailure
      console.warn(`[group] 逻辑自检要求主模型重写 群=${group.name} 原因=${reviewFailure}`)
      rawText = await chatCompletion({
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        messages: coalesceConsecutiveRoles([
          ...chatMessages,
          { role: 'assistant', content: rawText },
          {
            role: 'user',
            content: `上一版群聊回复存在客观逻辑错误：${reviewFailure}
请依据原始上下文重写完整群聊草稿。不要解释，不要输出JSON；每行仍严格使用 <人名>（想法）[心情]“消息内容”。`,
          },
        ]),
        signal: controller.signal,
        purpose: 'chat',
        thinking: 'disabled',
        temperature: 0.75,
        maxTokens: 1000,
        trace: { turnId: streamId, stage: 'second_chat', conversationId },
      })
      if (!turns.isCurrent(conversationId, streamId)) return
      localDraft = parseGroupRawDraft(rawText, speakers, stickers.map((sticker) => sticker.name), remoteStickerSearchEnabled)
      localDraft.groupVibe = group.vibe || '自然、轻松的日常群聊。'
      if (!localDraft.valid || localDraft.needsUtility) {
        jsonRaw = await bestEffortUtilityCompletion({
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          model: settings.utilityModel,
          messages: [{
            role: 'system',
            content: buildGroupJsonConversionPrompt(rawText, speakers, stickers.map((sticker) => sticker.name), mediaPromptOptions),
          }, {
            role: 'user',
            content: '请执行上述转换，并且只输出指定的 JSON 对象。',
          }],
          jsonMode: true,
          signal: controller.signal,
          thinking: 'disabled',
          temperature: 0.1,
          maxTokens: 900,
          trace: { turnId: streamId, stage: 'other', conversationId },
        })
        const converted = parseGroupAiResponse(jsonRaw, speakers.length)
        if (converted.bubbles.length > 0) {
          ;({ bubbles, knowledgeQueries, turnSummary, groupVibe, planCandidates } = converted)
        } else {
          jsonRaw = serializeGroupTurn(localDraft)
          ;({ bubbles, knowledgeQueries, turnSummary, groupVibe, planCandidates } = localDraft)
        }
      } else {
        jsonRaw = serializeGroupTurn(localDraft)
        ;({ bubbles, knowledgeQueries, turnSummary, groupVibe, planCandidates } = localDraft)
      }
      finalRaw = jsonRaw
      logicReview = bubbles.length > 0 ? await runLogicReview('second_quality') : undefined
      if (logicReview?.status === 'unavailable') {
        draftFeedback = `二次审查降级：${logicReview.reason}`
        console.warn(`[group] 二次逻辑审查不可用，放行重写回复 群=${group.name} 原因=${logicReview.reason}`)
      } else if (logicReview?.status === 'reject') {
        throw new Error(`主模型重写后仍未通过群聊逻辑自检：${logicReview.reason || '未知原因'}`)
      }
    }
    knowledgeQueries = Array.from(new Set([...initiallyRequestedKnowledge, ...knowledgeQueries])).slice(0, 2)
    if (featureActive(settings, 'knowledgeBase') && knowledgeQueries.length > 0) {
      const knowledge = await resolveKnowledgeQueries(knowledgeQueries, settings)
      if (knowledge.text) {
        rawText = await chatCompletion({ apiKey:settings.apiKey,baseUrl:settings.baseUrl,model:settings.model,messages:[...chatMessages,{role:'user',content:`刚才出现了你们不了解的词。搜索结果如下：\n${knowledge.text}${reviewFailure?`\n\n上一版审查问题：${reviewFailure}，重写时同时修正。`:''}\n请基于结果重新生成群聊草稿，保持原群聊格式，像刚查明白后自然接话，不要写成报告。`}],signal:controller.signal, thinking:'disabled',temperature:0.9,maxTokens:1800,trace:{turnId:streamId,stage:'second_chat',conversationId} })
        localDraft = parseGroupRawDraft(rawText, speakers, stickers.map((sticker) => sticker.name), remoteStickerSearchEnabled)
        localDraft.groupVibe = group.vibe || '自然、轻松的日常群聊。'
        if (!localDraft.valid || localDraft.needsUtility) {
          jsonRaw = await bestEffortUtilityCompletion({apiKey:settings.apiKey,baseUrl:settings.baseUrl,model:settings.utilityModel,messages:[{role:'system',content:buildGroupJsonConversionPrompt(rawText,speakers,stickers.map(s=>s.name),mediaPromptOptions)},{role:'user',content:'请执行上述转换，并且只输出指定的 JSON 对象。'}],jsonMode:true,signal:controller.signal,thinking:'disabled',temperature:0.1,maxTokens:1400,trace:{turnId:streamId,stage:'other',conversationId}})
          finalRaw=jsonRaw
          const converted=parseGroupAiResponse(finalRaw,speakers.length)
          if(converted.bubbles.length>0){;({bubbles,knowledgeQueries,turnSummary,groupVibe,planCandidates}=converted)}
          else{jsonRaw=serializeGroupTurn(localDraft);finalRaw=jsonRaw;({bubbles,knowledgeQueries,turnSummary,groupVibe,planCandidates}=localDraft)}
        } else {
          jsonRaw = serializeGroupTurn(localDraft)
          finalRaw = jsonRaw
          ;({bubbles,knowledgeQueries,turnSummary,groupVibe,planCandidates}=localDraft)
        }
      }
    }
    console.log(`[group] 收到回复(${finalRaw.length}字) 解析出${bubbles.length}条气泡 群=${group.name}`)
    if (bubbles.length === 0) {
      console.warn(`[group] 本轮没有人回复 群=${group.name} 原始内容: ${rawText.slice(0, 200)}`)
      engine.patch(conversationId, { error: '群里这次没有人回复 可以再发一条试试', aiTyping: false, typingLabel: undefined })
      return
    }
    const aiTurnId = uuid()
    await db.aiTurns.add({
      id: aiTurnId,
      conversationId,
      raw: finalRaw,
      parsed: parseGroupTurnDebugPayload(systemPrompt, rawText, draftFeedback, jsonRaw, finalRaw, bubbles, knowledgeQueries, turnSummary, groupVibe, storyOutline),
      knowledgeQueries,
      createdAt: Date.now(),
    })
    const createdPlans = []
    for (const candidate of planCandidates) {
      const plan = await createGroupPlan({
        group,
        conversationId,
        title: candidate.title,
        summary: candidate.summary,
        location: candidate.location,
        participantContactIds: candidate.participantIndexes.map((index) => speakers[index - 1]?.id).filter((id): id is string => !!id),
      })
      if (plan) createdPlans.push(plan)
    }
    for (const plan of createdPlans) await db.messages.add(planCardMessage(plan))
    void updateGroupMemoryAndVibe({ group, aiTurnId, settings, turnSummary, groupVibe })
    console.info(`[group-perf] 模型与自检完成=${Math.round(performance.now() - turnStartedAt)}ms 群=${group.name}`)
    revealGroupBubbles(conversationId, group, members, speakers, bubbles, streamId, settings, stickers, aiTurnId, turnSummary, turnStartedAt)
  } catch (err) {
    if (!turns.isCurrent(conversationId, streamId)) return
    if (err instanceof DOMException && err.name === 'AbortError') return
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[group] 生成回复出错 群=${group.name}:`, message)
    engine.patch(conversationId, { error: message, aiTyping: false, typingLabel: undefined })
  }
}

function revealGroupBubbles(
  conversationId: string,
  group: Group,
  members: Contact[],
  speakers: Contact[],
  bubbles: GroupAiBubble[],
  streamId: string,
  settings: AppSettings,
  stickers: Sticker[],
  aiTurnId: string,
  turnSummary: string,
  turnStartedAt = performance.now(),
): void {
  revealSequentially({
    conversationId,
    streamId,
    items: bubbles,
    controller: turns,
    // Reveal the first completed message immediately. A later message only
    // starts after the previous one, including image/sticker API work, has
    // been persisted so mixed media can never overtake its intended slot.
    delayMs: (bubble, i) => i > 0 ? groupTypingDelayMs(bubble) : 0,
    reveal: async (bubble, i) => {
      const speaker = speakers[bubble.speakerIndex - 1]
      useChatEngineStore.getState().patch(conversationId, {
        typingLabel: speaker ? displayName(speaker) : '群成员',
      })
      const { imagePayload, imageFailed, remoteSticker, stickerFailed } =
        await resolveBubbleMedia(bubble, settings, stickers)
      const content =
        bubble.type === 'text'
          ? stripSpeakerNamePrefix(
              bubble.content,
              members.map((m) => m.name),
            )
          : bubble.type === 'sticker' ? (stickerFailed ? '表情没找到…' : bubble.name) : imageFailed ? '图片没发出来…' : bubble.caption || '[图片]'

      const messageCreatedAt = await nextMessageTimestamp(conversationId)
      const msg: Message = {
        id: uuid(),
        conversationId,
        role: 'assistant',
        type: (bubble.type === 'image' && imageFailed) || (bubble.type === 'sticker' && stickerFailed) ? 'text' : bubble.type,
        content,
        speakerContactId: speaker?.id,
        debugAiTurnId: aiTurnId,
        debugParsedBubble: bubble,
        thought: bubble.thought,
        sticker: remoteSticker ? { url: remoteSticker.url, provider: remoteSticker.provider } : undefined,
        image: imagePayload,
        createdAt: messageCreatedAt,
      }
      await db.messages.add(msg)
      if (remoteSticker) void trackRemoteStickerSend(remoteSticker)
      if (i === 0) {
        console.info(`[group-perf] 首条气泡显示=${Math.round(performance.now() - turnStartedAt)}ms 群=${group.name}`)
      }
      if (speaker?.id && bubble.mood) {
        await db.contacts.update(speaker.id, {
          mood: { text: bubble.mood, expiresAt: Date.now() + settings.moodExpiryMs },
        })
      }
      await db.conversations.update(conversationId, { updatedAt: messageCreatedAt })

      if (useChatUiStore.getState().activeConversationId !== conversationId) {
        useChatUiStore.getState().showNotification({
          id: uuid(),
          conversationId,
          contactName: group.name,
          contactAvatar: group.avatar,
          contactAvatarColor: group.avatarColor,
          preview: previewForMessage(msg, speaker ? displayName(speaker) : undefined),
        })
      }

          if (i === bubbles.length - 1) {
        useChatEngineStore.getState().patch(conversationId, { aiTyping: false, typingLabel: undefined })
        void maybeUpdateGroupMemory(group.id, conversationId, members, settings)

        // A group conversation is shared context: unlike a private chat, it
        // can naturally colour a member's later 1:1 chat and a follow-up
        // moment. Persist only the model's one-line group summary, never the
        // raw transcript, so this creates continuity without leaking details
        // from messages that were not meant to leave the group.
        if (turnSummary.trim()) {
          await recordSocialEvent({
            type: 'group_turn',
            actorId: speaker?.id ?? 'user',
            relatedContactIds: group.memberContactIds,
            conversationId,
            groupId: group.id,
            messageId: msg.id,
            summary: `群聊“${group.name}”刚聊到：${turnSummary.trim()}`,
            importance: 2,
          })
        }
          }
    },
    onError: (error) => console.error('[group] 气泡写入失败', error),
  })
}
