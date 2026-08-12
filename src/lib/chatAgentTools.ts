import type { AiBubble, GroupAiBubble } from '../types'
import { parseJsonLoose, serializePrivateTurn, type ParsedAiTurn } from './ai/protocol'
import { normalizeMood } from './mood'
import type { ChatCompletionOptions, ChatMessage, ChatToolCall, ChatToolDefinition } from './ai/types'
import { chatCompletion, chatCompletionText } from './ai/client'

/**
 * Tool-calling agent turns: the model emits schema-bound tool calls for every
 * visible message and action instead of free text in a line protocol. APIs
 * without (usable) tool support get a utility-model plan conversion; the
 * per-provider agentMode toggle (Settings → AI 接口) selects between this
 * pipeline and the legacy cascade in responseQuality.ts.
 */

export interface AgentToolContext {
  apiKey: string
  baseUrl: string
  model: string
  utilityModel: string
  messages: ChatMessage[]
  signal?: AbortSignal
  purpose: ChatCompletionOptions['purpose']
  automatic?: boolean
  trace: NonNullable<ChatCompletionOptions['trace']>
  stickerNames: string[]
  stickerSearchEnabled: boolean
  imageEnabled: boolean
  knowledgeEnabled: boolean
  scheduleEnabled: boolean
  locationIds: string[]
}

export interface GroupPlanCandidate {
  title: string
  summary: string
  participantIndexes: number[]
  location?: string
}

export interface ParsedGroupToolTurn {
  bubbles: GroupAiBubble[]
  knowledgeQueries: string[]
  turnSummary: string
  groupVibe: string
  planCandidates: GroupPlanCandidate[]
}

export interface AgentTurn<T> {
  parsed: T
  /** Serialized form kept on the ai-turn debug record. */
  raw: string
  /** false when the API returned no tool_calls and a utility model converted the draft. */
  native: boolean
}

const MAX_TOOL_ROUNDS = 3
const MAX_TEXT_COMPLETION_ROUNDS = 2
const MAX_KNOWLEDGE_QUERIES = 2

const PRIVATE_ACTION_TOOLS = new Set(['create_schedule', 'transfer_money', 'send_red_packet', 'request_loan', 'decide_loan', 'purchase_gift'])
const GROUP_ACTION_TOOLS = new Set(['create_schedule'])

const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const positiveInteger = (value: unknown) => {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? number : 0
}

function fn(name: string, description: string, properties: Record<string, unknown>, required: string[]): ChatToolDefinition {
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
  }
}

const MOOD_DESCRIPTION = '角色当前心情，用自然的中文词语（如开心、担心、期待、平静），不要使用 emoji。'
const THOUGHT_DESCRIPTION = '角色这一刻没有说出口的真实想法，用自然的中文，不得留空。'

const commonProperties = () => ({
  thought: { type: 'string', description: THOUGHT_DESCRIPTION },
  mood: { type: 'string', description: MOOD_DESCRIPTION },
})

export function privateChatTools(opts: Pick<AgentToolContext, 'stickerNames' | 'stickerSearchEnabled' | 'imageEnabled' | 'knowledgeEnabled' | 'scheduleEnabled' | 'locationIds'>): ChatToolDefinition[] {
  const tools = [fn('send_text', '发送一条普通聊天消息。每条独立消息调用一次，并按实际发送顺序排列调用。', {
    content: { type: 'string', description: '用户可见的自然聊天正文。' }, ...commonProperties(),
  }, ['content', 'thought', 'mood'])]
  if (opts.stickerNames.length || opts.stickerSearchEnabled) tools.push(fn('send_sticker', '发送一个表情包。没有真实发送意图时不要调用。', {
    name: opts.stickerSearchEnabled
      ? { type: 'string', description: '简短具体的表情搜索词，优先英文；也可使用已知本地表情名。' }
      : { type: 'string', enum: opts.stickerNames, description: '必须逐字选择一个本地表情名。' },
    ...commonProperties(),
  }, ['name', 'thought', 'mood']))
  if (opts.imageEnabled) tools.push(fn('send_image', '生成或搜索并发送一张图片。只有角色确实决定发图时调用。', {
    query: { type: 'string', description: '完整英文画面提示，清楚描述主体、场景、动作、构图、光线、颜色和氛围。' },
    caption: { type: 'string', description: '随图片发送给用户看的简短配文。' },
    kind: { type: 'string', enum: ['selfie', 'portrait', 'scene', 'object'] },
    participants: { type: 'array', items: { type: 'string', enum: ['self', 'user'] }, description: '画面中出现的人：本人用 self，用户用 user，纯场景或物品用空数组。' },
    ...commonProperties(),
  }, ['query', 'caption', 'kind', 'participants', 'thought', 'mood']))
  if (opts.knowledgeEnabled) tools.push(fn('search_knowledge', '查询角色当前确实不懂、但回答用户前必须弄清楚的新词、作品或事实。查询后系统会把结果交回角色重新回答。', {
    query: { type: 'string', description: '简短、可搜索的查询词。' },
  }, ['query']))
  if (opts.scheduleEnabled && opts.locationIds.length) tools.push(fn('create_schedule', '记录已经形成的具体线下安排。只要日期、整点开始和结束时间、合法地点都已确定——无论是接受用户提议还是角色主动承诺——就应调用。仅讨论可能性、反问、拒绝、附带未满足条件或信息不全时不要调用。此卡片不能代替自然聊天，必须同时调用 send_text 说清角色的回应。', {
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    startHour: { type: 'integer', minimum: 0, maximum: 23 },
    endHour: { type: 'integer', minimum: 1, maximum: 24 },
    locationId: { type: 'string', enum: opts.locationIds },
    activity: { type: 'string' },
    phoneAccess: { type: 'string', enum: ['available', 'unavailable'] },
    summary: { type: 'string' },
    ...commonProperties(),
  }, ['date', 'startHour', 'endHour', 'locationId', 'activity', 'phoneAccess', 'summary', 'thought', 'mood']))
  tools.push(
    fn('transfer_money', '角色决定立即向用户转账时调用。', { amount: { type: 'integer', minimum: 1 }, note: { type: 'string', description: '转账附言。' }, ...commonProperties() }, ['amount', 'note', 'thought', 'mood']),
    fn('send_red_packet', '角色决定立即向用户发送红包时调用。', { amount: { type: 'integer', minimum: 1 }, blessing: { type: 'string', description: '红包祝福语。' }, ...commonProperties() }, ['amount', 'blessing', 'thought', 'mood']),
    fn('request_loan', '角色决定向用户借钱时调用。', { amount: { type: 'integer', minimum: 1 }, reason: { type: 'string', description: '借钱理由。' }, ...commonProperties() }, ['amount', 'reason', 'thought', 'mood']),
    fn('decide_loan', '角色处理一个上下文中明确存在的待处理借款时调用。', { loanId: { type: 'string' }, decision: { type: 'string', enum: ['accept', 'reject'] }, amount: { type: 'integer', minimum: 1 }, ...commonProperties() }, ['loanId', 'decision', 'amount', 'thought', 'mood']),
    fn('purchase_gift', '角色决定立即购买礼物送给用户时调用。', { amount: { type: 'integer', minimum: 1 }, name: { type: 'string' }, icon: { type: 'string', description: '礼物图标 emoji。' }, description: { type: 'string' }, ...commonProperties() }, ['amount', 'name', 'icon', 'description', 'thought', 'mood']),
  )
  return tools
}

export function groupChatTools(opts: Pick<AgentToolContext, 'stickerNames' | 'stickerSearchEnabled' | 'imageEnabled' | 'knowledgeEnabled' | 'scheduleEnabled' | 'locationIds'>, speakerNames: string[], memberNames: string[]): ChatToolDefinition[] {
  const speakerIndexProperty = {
    speakerIndex: { type: 'integer', minimum: 1, maximum: speakerNames.length, description: `发言人索引：${speakerNames.map((name, index) => `${index + 1}=${name}`).join('，')}。` },
  }
  const tools: ChatToolDefinition[] = [
    fn('send_text', '发送一条普通聊天消息。每条独立消息调用一次，并按实际发送顺序排列调用。', {
      ...speakerIndexProperty,
      content: { type: 'string', description: '群成员可见的自然聊天正文。' }, ...commonProperties(),
    }, ['speakerIndex', 'content', 'thought', 'mood']),
  ]
  if (opts.stickerNames.length || opts.stickerSearchEnabled) tools.push(fn('send_sticker', '发送一个表情包。没有真实发送意图时不要调用。', {
    ...speakerIndexProperty,
    name: opts.stickerSearchEnabled
      ? { type: 'string', description: '简短具体的表情搜索词，优先英文；也可使用已知本地表情名。' }
      : { type: 'string', enum: opts.stickerNames, description: '必须逐字选择一个本地表情名。' },
    ...commonProperties(),
  }, ['speakerIndex', 'name', 'thought', 'mood']))
  if (opts.imageEnabled) tools.push(fn('send_image', '生成或搜索并发送一张图片。只有发言者确实决定发图时调用。', {
    ...speakerIndexProperty,
    query: { type: 'string', description: '完整英文画面提示，清楚描述主体、场景、动作、构图、光线、颜色和氛围。' },
    caption: { type: 'string', description: '随图片发送的简短配文。' },
    kind: { type: 'string', enum: ['selfie', 'portrait', 'group', 'scene', 'object'] },
    participantIndexes: { type: 'array', items: { type: 'integer', minimum: 1, maximum: memberNames.length }, description: `画面中出现的完整群成员索引：${memberNames.map((name, index) => `${index + 1}=${name}`).join('，')}。纯场景或物品用空数组。` },
    includeUser: { type: 'boolean', description: '画面中是否出现用户本人。' },
    ...commonProperties(),
  }, ['speakerIndex', 'query', 'caption', 'kind', 'participantIndexes', 'includeUser', 'thought', 'mood']))
  if (opts.knowledgeEnabled) tools.push(fn('search_knowledge', '查询发言者确实不懂、但参与讨论前必须弄清楚的新词、作品或事实。查询后系统会把结果交回并重新生成。', {
    query: { type: 'string', description: '简短、可搜索的查询词。' },
  }, ['query']))
  if (opts.scheduleEnabled && opts.locationIds.length) tools.push(fn('create_schedule', '发言者为自己记录已经形成的具体线下安排。仅讨论可能性、反问、拒绝或信息不全时不要调用。此卡片不能代替自然聊天，同一发言者必须同时调用 send_text。', {
    ...speakerIndexProperty,
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    startHour: { type: 'integer', minimum: 0, maximum: 23 },
    endHour: { type: 'integer', minimum: 1, maximum: 24 },
    locationId: { type: 'string', enum: opts.locationIds },
    activity: { type: 'string' },
    phoneAccess: { type: 'string', enum: ['available', 'unavailable'] },
    summary: { type: 'string' },
    ...commonProperties(),
  }, ['speakerIndex', 'date', 'startHour', 'endHour', 'locationId', 'activity', 'phoneAccess', 'summary', 'thought', 'mood']))
  tools.push(fn('propose_plan', '本轮至少两位成员明确达成一项共同计划时调用（群计划卡片，需成员确认后成行）。只是提议、讨论或单方面想法时不要调用。', {
    title: { type: 'string', description: '计划标题。' },
    summary: { type: 'string', description: '计划的一句话说明。' },
    participantIndexes: { type: 'array', items: { type: 'integer', minimum: 1, maximum: speakerNames.length }, description: `参与成员的发言人索引：${speakerNames.map((name, index) => `${index + 1}=${name}`).join('，')}。` },
    location: { type: 'string', description: '可选的地点描述。' },
  }, ['title', 'summary', 'participantIndexes']))
  return tools
}

function argumentsObject(call: ChatToolCall): Record<string, unknown> | null {
  const parsed = parseJsonLoose<unknown>(call.function.arguments)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
}

function scheduleBubble(args: Record<string, unknown>): Extract<AiBubble, { type: 'scheduleChange' }> | null {
  const date = text(args.date, 10)
  const locationId = text(args.locationId, 80)
  const activity = text(args.activity, 16)
  const summary = text(args.summary, 40)
  const startHour = Number(args.startHour)
  const endHour = Number(args.endHour)
  const phoneAccess = args.phoneAccess
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(startHour) || startHour < 0 || startHour > 23) return null
  if (!Number.isInteger(endHour) || endHour < 1 || endHour > 24 || startHour === endHour) return null
  if (!locationId || !activity || !summary || (phoneAccess !== 'available' && phoneAccess !== 'unavailable')) return null
  return { type: 'scheduleChange', date, startHour, endHour, location: locationId, locationId, activity, summary, phoneAccess }
}

export function parsePrivateToolCalls(calls: ChatToolCall[]): ParsedAiTurn {
  const bubbles: AiBubble[] = []
  const knowledgeQueries: string[] = []
  const thoughts: string[] = []
  let mood: string | undefined
  for (const call of calls) {
    const args = argumentsObject(call)
    if (!args) continue
    const thought = text(args.thought, 100)
    const textualMood = text(args.mood, 20)
    if (call.function.name !== 'search_knowledge' && (!thought || !textualMood)) continue
    if (thought) thoughts.push(thought)
    if (textualMood) mood = normalizeMood(textualMood)
    if (call.function.name === 'send_text') {
      const content = text(args.content, 2_000)
      if (content) bubbles.push({ type: 'text', content })
    } else if (call.function.name === 'send_sticker') {
      const name = text(args.name, 100)
      if (name) bubbles.push({ type: 'sticker', name })
    } else if (call.function.name === 'send_image') {
      const query = text(args.query, 2_000)
      if (query) bubbles.push({
        type: 'image', query,
        caption: text(args.caption, 200) || undefined,
        kind: ['selfie', 'portrait', 'scene', 'object'].includes(String(args.kind)) ? args.kind as 'selfie' | 'portrait' | 'scene' | 'object' : undefined,
        participants: Array.isArray(args.participants) ? args.participants.filter((value): value is 'self' | 'user' => value === 'self' || value === 'user') : undefined,
      })
    } else if (call.function.name === 'search_knowledge') {
      const query = text(args.query, 120)
      if (query && knowledgeQueries.length < MAX_KNOWLEDGE_QUERIES) knowledgeQueries.push(query)
    } else if (call.function.name === 'create_schedule') {
      const bubble = scheduleBubble(args)
      if (bubble) bubbles.push(bubble)
    } else if (call.function.name === 'transfer_money') {
      const amount = positiveInteger(args.amount)
      if (amount) bubbles.push({ type: 'transfer', amount, note: text(args.note, 80) })
    } else if (call.function.name === 'send_red_packet') {
      const amount = positiveInteger(args.amount)
      if (amount) bubbles.push({ type: 'redPacket', amount, note: text(args.blessing, 80) })
    } else if (call.function.name === 'request_loan') {
      const amount = positiveInteger(args.amount)
      if (amount) bubbles.push({ type: 'loanRequest', amount, note: text(args.reason, 80) })
    } else if (call.function.name === 'decide_loan') {
      const amount = positiveInteger(args.amount)
      const loanId = text(args.loanId, 100)
      const decision = args.decision
      if (amount && loanId && (decision === 'accept' || decision === 'reject')) bubbles.push({ type: 'loanDecision', amount, loanId, decision })
    } else if (call.function.name === 'purchase_gift') {
      const amount = positiveInteger(args.amount)
      const name = text(args.name, 30)
      if (amount && name) bubbles.push({ type: 'giftPurchase', amount, name, icon: text(args.icon, 8), description: text(args.description, 80) })
    }
  }
  return { bubbles, knowledgeQueries, mood, thought: thoughts.join('；').slice(0, 100) || undefined }
}

export function parseGroupToolCalls(calls: ChatToolCall[], speakerCount: number, memberCount = speakerCount): ParsedGroupToolTurn {
  const bubbles: GroupAiBubble[] = []
  const knowledgeQueries: string[] = []
  const planCandidates: GroupPlanCandidate[] = []
  for (const call of calls) {
    const args = argumentsObject(call)
    if (!args) continue
    if (call.function.name === 'search_knowledge') {
      const query = text(args.query, 120)
      if (query && knowledgeQueries.length < MAX_KNOWLEDGE_QUERIES) knowledgeQueries.push(query)
      continue
    }
    if (call.function.name === 'propose_plan') {
      const title = text(args.title, 40)
      const summary = text(args.summary, 120)
      const participantIndexes = Array.isArray(args.participantIndexes)
        ? Array.from(new Set(args.participantIndexes.map(Number).filter((index) => Number.isInteger(index) && index >= 1 && index <= speakerCount)))
        : []
      if (title && summary && participantIndexes.length >= 2) planCandidates.push({ title, summary, participantIndexes, location: text(args.location, 60) || undefined })
      continue
    }
    const speakerIndex = Number(args.speakerIndex)
    if (!Number.isInteger(speakerIndex) || speakerIndex < 1 || speakerIndex > speakerCount) continue
    const thought = text(args.thought, 100)
    const textualMood = text(args.mood, 20)
    if (!thought || !textualMood) continue
    const common = { speakerIndex, thought, mood: normalizeMood(textualMood) }
    if (call.function.name === 'send_text') {
      const content = text(args.content, 2_000)
      if (content) bubbles.push({ ...common, type: 'text', content })
    } else if (call.function.name === 'send_sticker') {
      const name = text(args.name, 100)
      if (name) bubbles.push({ ...common, type: 'sticker', name })
    } else if (call.function.name === 'send_image') {
      const query = text(args.query, 2_000)
      if (query) bubbles.push({
        ...common, type: 'image', query,
        caption: text(args.caption, 200) || undefined,
        kind: ['selfie', 'portrait', 'group', 'scene', 'object'].includes(String(args.kind)) ? args.kind as 'selfie' | 'portrait' | 'group' | 'scene' | 'object' : undefined,
        participantIndexes: Array.isArray(args.participantIndexes) ? Array.from(new Set(args.participantIndexes.map(Number).filter((index) => Number.isInteger(index) && index >= 1 && index <= memberCount))) : [speakerIndex],
        includeUser: args.includeUser === true,
      })
    } else if (call.function.name === 'create_schedule') {
      const bubble = scheduleBubble(args)
      if (bubble) bubbles.push({ ...common, ...bubble })
    }
  }
  return {
    bubbles,
    knowledgeQueries,
    turnSummary: bubbles.map((bubble) => bubble.type === 'text' ? bubble.content : bubble.type).join(' ').slice(0, 160),
    groupVibe: bubbles.at(-1)?.mood ?? '平静',
    planCandidates,
  }
}

interface ToolPlan {
  calls?: Array<{ name?: unknown; arguments?: unknown }>
}

/** Draft → tool-call plan via the utility model, for APIs that return prose instead of tool_calls. */
async function fallbackCalls(opts: AgentToolContext, raw: string, tools: ChatToolDefinition[]): Promise<ChatToolCall[]> {
  const allowed = tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters }))
  const output = await chatCompletionText({
    apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.utilityModel || opts.model,
    messages: [{ role: 'system', content: `你是结构化聊天行动规划器。把主模型草稿转换为工具调用计划，不改变原意、不新增行动。心情必须用自然的中文词语，禁止 emoji。只输出 JSON：{"calls":[{"name":"send_text","arguments":{}}]}。只能使用给定工具，arguments 必须符合对应参数结构。\n可用工具：${JSON.stringify(allowed)}\n主模型草稿：\n${raw}` }],
    jsonMode: true, purpose: 'quality', signal: opts.signal,
    trace: { ...opts.trace, stage: 'tool_call' },
  })
  const plan = parseJsonLoose<ToolPlan>(output)
  if (!Array.isArray(plan?.calls)) return []
  return plan.calls.flatMap((entry, index) => {
    if (typeof entry?.name !== 'string' || !allowed.some((tool) => tool.name === entry.name)) return []
    if (!entry.arguments || typeof entry.arguments !== 'object') return []
    return [{ id: `fallback_${index}`, type: 'function' as const, function: { name: entry.name, arguments: JSON.stringify(entry.arguments) } }]
  })
}

const hasActionWithoutText = (calls: ChatToolCall[], actionNames: Set<string>) =>
  calls.some((call) => actionNames.has(call.function.name)) && !calls.some((call) => call.function.name === 'send_text')

/** Action cards may never stand alone — force the model to accompany them with natural chat text. */
async function completeActionText(
  opts: AgentToolContext,
  calls: ChatToolCall[],
  assistantContent: string,
  validate: (textCalls: ChatToolCall[]) => boolean,
  expectedSpeakerIndex?: number,
): Promise<ChatToolCall[]> {
  const messages: ChatMessage[] = [
    ...opts.messages,
    { role: 'assistant', content: assistantContent, tool_calls: calls },
    ...calls.map((call): ChatMessage => ({
      role: 'tool',
      tool_call_id: call.id,
      content: JSON.stringify({ success: true, staged: true, message: `动作已验证并暂存，不要重复调用。现在必须用 send_text 自然回应${expectedSpeakerIndex ? `，speakerIndex 必须为 ${expectedSpeakerIndex}` : ''}。` }),
    })),
  ]
  for (let round = 0; round < MAX_TEXT_COMPLETION_ROUNDS; round++) {
    const response = await chatCompletion({
      apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, messages,
      tools: [fn('send_text', '发送一条普通聊天消息。', {
        ...(expectedSpeakerIndex ? { speakerIndex: { type: 'integer', minimum: expectedSpeakerIndex, maximum: expectedSpeakerIndex } } : {}),
        content: { type: 'string', description: '用户可见的自然聊天正文。' }, ...commonProperties(),
      }, expectedSpeakerIndex ? ['speakerIndex', 'content', 'thought', 'mood'] : ['content', 'thought', 'mood'])],
      toolChoice: { type: 'function', function: { name: 'send_text' } },
      signal: opts.signal, purpose: opts.purpose, automatic: opts.automatic,
      trace: { ...opts.trace, stage: 'tool_call' },
    })
    if (response.status !== 'ok') throw new Error('动作已生成，但模型没有返回配套聊天消息')
    let textCalls = (response.toolCalls ?? []).filter((call) => call.function.name === 'send_text')
    if (!textCalls.length && response.content.trim()) {
      const sendTextTool = privateChatTools({ stickerNames: [], stickerSearchEnabled: false, imageEnabled: false, knowledgeEnabled: false, scheduleEnabled: false, locationIds: [] })
      textCalls = await fallbackCalls(opts, response.content, sendTextTool)
    }
    if (textCalls.length && validate(textCalls)) return [...textCalls, ...calls]
    const attemptedCalls = response.toolCalls ?? []
    if (attemptedCalls.length) {
      messages.push({ role: 'assistant', content: response.content, tool_calls: attemptedCalls })
      messages.push(...attemptedCalls.map((call): ChatMessage => ({
        role: 'tool', tool_call_id: call.id,
        content: JSON.stringify({ success: false, code: 'INVALID_ARGUMENTS', message: `send_text 参数无效${expectedSpeakerIndex ? `，speakerIndex 必须为 ${expectedSpeakerIndex}` : ''}，请重试。` }),
      })))
    } else {
      messages.push({ role: 'system', content: `必须调用 send_text 给出自然聊天正文${expectedSpeakerIndex ? `，speakerIndex 必须为 ${expectedSpeakerIndex}` : ''}。` })
    }
  }
  throw new Error('动作已生成，但连续两次未能生成有效的配套聊天消息')
}

function serializeGroupTurn(parsed: ParsedGroupToolTurn): string {
  return JSON.stringify({ messages: parsed.bubbles, turnSummary: parsed.turnSummary, groupVibe: parsed.groupVibe, knowledgeQueries: parsed.knowledgeQueries, planCandidates: parsed.planCandidates })
}

export async function generatePrivateAgentTurn(opts: AgentToolContext): Promise<AgentTurn<ParsedAiTurn>> {
  const tools = privateChatTools(opts)
  const messages = [...opts.messages]
  const accepted: ChatToolCall[] = []
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await chatCompletion({
      apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, messages,
      tools, toolChoice: 'required', signal: opts.signal, purpose: opts.purpose, automatic: opts.automatic,
    })
    if (response.status !== 'ok') throw new Error('模型没有返回有效的聊天行动')
    const nativeCalls = response.toolCalls ?? []
    if (!nativeCalls.length) {
      const converted = await fallbackCalls(opts, response.content, tools)
      const calls = hasActionWithoutText(converted, PRIVATE_ACTION_TOOLS)
        ? await completeActionText(opts, converted, response.content, (textCalls) => parsePrivateToolCalls(textCalls).bubbles.some((bubble) => bubble.type === 'text'))
        : converted
      const parsed = parsePrivateToolCalls(calls)
      return { parsed, raw: serializePrivateTurn(parsed), native: false }
    }
    const invalid = nativeCalls.filter((call) => {
      const parsed = parsePrivateToolCalls([call])
      return parsed.bubbles.length === 0 && parsed.knowledgeQueries.length === 0
    })
    accepted.push(...nativeCalls.filter((call) => !invalid.includes(call)))
    if (!invalid.length) {
      const calls = hasActionWithoutText(accepted, PRIVATE_ACTION_TOOLS)
        ? await completeActionText(opts, accepted, response.content, (textCalls) => parsePrivateToolCalls(textCalls).bubbles.some((bubble) => bubble.type === 'text'))
        : accepted
      const parsed = parsePrivateToolCalls(calls)
      return { parsed, raw: serializePrivateTurn(parsed), native: true }
    }
    messages.push({ role: 'assistant', content: response.content, tool_calls: nativeCalls })
    for (const call of nativeCalls) {
      messages.push({
        role: 'tool', tool_call_id: call.id,
        content: invalid.includes(call)
          ? JSON.stringify({ success: false, code: 'INVALID_ARGUMENTS', message: '参数不符合工具 schema，或可见消息缺少 thought/中文文字 mood。请只重试失败调用，不要重复成功调用。' })
          : JSON.stringify({ success: true, staged: true, message: '调用已暂存，不要重复。' }),
      })
    }
  }
  const calls = hasActionWithoutText(accepted, PRIVATE_ACTION_TOOLS)
    ? await completeActionText(opts, accepted, '', (textCalls) => parsePrivateToolCalls(textCalls).bubbles.some((bubble) => bubble.type === 'text'))
    : accepted
  const parsed = parsePrivateToolCalls(calls)
  if (!parsed.bubbles.length && !parsed.knowledgeQueries.length) throw new Error('模型连续返回了无效的工具参数')
  return { parsed, raw: serializePrivateTurn(parsed), native: true }
}

export async function generateGroupAgentTurn(opts: AgentToolContext & { speakerNames: string[]; memberNames: string[] }): Promise<AgentTurn<ParsedGroupToolTurn>> {
  const tools = groupChatTools(opts, opts.speakerNames, opts.memberNames)
  const messages = [...opts.messages]
  const accepted: ChatToolCall[] = []
  const parse = (calls: ChatToolCall[]) => parseGroupToolCalls(calls, opts.speakerNames.length, opts.memberNames.length)
  const completeIfNeeded = async (calls: ChatToolCall[], assistantContent: string) => {
    if (!hasActionWithoutText(calls, GROUP_ACTION_TOOLS)) return calls
    const schedule = calls.find((call) => call.function.name === 'create_schedule')
    const scheduleArgs = schedule ? argumentsObject(schedule) : null
    const speakerIndex = Number(scheduleArgs?.speakerIndex)
    const expected = Number.isInteger(speakerIndex) && speakerIndex > 0 ? speakerIndex : undefined
    return completeActionText(opts, calls, assistantContent, (textCalls) =>
      parse(textCalls).bubbles.some((bubble) => bubble.type === 'text' && (!expected || bubble.speakerIndex === expected)), expected)
  }
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await chatCompletion({
      apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, messages,
      tools, toolChoice: 'required', signal: opts.signal, purpose: opts.purpose, automatic: opts.automatic,
    })
    if (response.status !== 'ok') throw new Error('模型没有返回有效的群聊行动')
    const nativeCalls = response.toolCalls ?? []
    if (!nativeCalls.length) {
      const converted = await fallbackCalls(opts, response.content, tools)
      const parsed = parse(await completeIfNeeded(converted, response.content))
      return { parsed, raw: serializeGroupTurn(parsed), native: false }
    }
    const invalid = nativeCalls.filter((call) => {
      const parsed = parse([call])
      return parsed.bubbles.length === 0 && parsed.knowledgeQueries.length === 0 && parsed.planCandidates.length === 0
    })
    accepted.push(...nativeCalls.filter((call) => !invalid.includes(call)))
    if (!invalid.length) {
      const parsed = parse(await completeIfNeeded(accepted, response.content))
      return { parsed, raw: serializeGroupTurn(parsed), native: true }
    }
    messages.push({ role: 'assistant', content: response.content, tool_calls: nativeCalls })
    for (const call of nativeCalls) {
      messages.push({
        role: 'tool', tool_call_id: call.id,
        content: invalid.includes(call)
          ? JSON.stringify({ success: false, code: 'INVALID_ARGUMENTS', message: 'speakerIndex、参数、thought 或中文文字 mood 无效；只重试失败调用。' })
          : JSON.stringify({ success: true, staged: true, message: '已暂存，不要重复。' }),
      })
    }
  }
  const parsed = parse(await completeIfNeeded(accepted, ''))
  if (!parsed.bubbles.length && !parsed.knowledgeQueries.length) throw new Error('模型连续返回了无效的群聊工具参数')
  return { parsed, raw: serializeGroupTurn(parsed), native: true }
}
