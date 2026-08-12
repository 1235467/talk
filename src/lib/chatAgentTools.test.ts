import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFakeServer } from '../test/setup'
import { useSettingsStore } from '../store/useSettingsStore'
import { generateGroupAgentTurn, generatePrivateAgentTurn, parseGroupToolCalls, parsePrivateToolCalls } from './chatAgentTools'
import { chatCompletion } from './deepseek'
import type { ChatToolCall } from './deepseek'

const BASE_OPTS = {
  apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1', model: 'main-model', utilityModel: 'util-model',
  messages: [{ role: 'system' as const, content: 'context' }],
  purpose: 'chat' as const,
  trace: { turnId: 't1', stage: 'original_generation' as const, conversationId: 'c1' },
  stickerNames: ['笑哭'], stickerSearchEnabled: false, imageEnabled: false, knowledgeEnabled: true, scheduleEnabled: false, locationIds: [] as string[],
}

function toolCall(name: string, args: unknown, id = `call_${Math.random().toString(36).slice(2, 8)}`): ChatToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }
}

function completionResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ choices: [{ message: body, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } })
}

function queueFetch(...responses: Response[]) {
  const mock = vi.fn()
  for (const response of responses) mock.mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', mock)
  return mock
}

function lastRequestBody(mock: ReturnType<typeof vi.fn>, index = 0): Record<string, unknown> {
  return JSON.parse(String(mock.mock.calls[index]?.[1]?.body))
}

describe('parsePrivateToolCalls', () => {
  it('parses valid calls and normalizes mood text', () => {
    const parsed = parsePrivateToolCalls([
      toolCall('send_text', { content: '晚上吃啥', thought: '饿了', mood: '开心 😀' }),
      toolCall('transfer_money', { amount: 52, note: '拿去', thought: '宠一下', mood: '得意' }),
    ])
    expect(parsed.bubbles).toEqual([
      { type: 'text', content: '晚上吃啥' },
      { type: 'transfer', amount: 52, note: '拿去' },
    ])
    expect(parsed.mood).toBe('得意')
    expect(parsed.thought).toBe('饿了；宠一下')
  })

  it('drops visible calls missing thought/mood and caps knowledge queries', () => {
    const parsed = parsePrivateToolCalls([
      toolCall('send_text', { content: '缺字段', thought: '', mood: '' }),
      toolCall('search_knowledge', { query: 'a' }),
      toolCall('search_knowledge', { query: 'b' }),
      toolCall('search_knowledge', { query: 'c' }),
    ])
    expect(parsed.bubbles).toEqual([])
    expect(parsed.knowledgeQueries).toEqual(['a', 'b'])
  })

  it('validates schedule fields strictly', () => {
    const valid = { date: '2026-08-12', startHour: 18, endHour: 20, locationId: 'loc1', activity: '吃饭', phoneAccess: 'available', summary: '晚饭', thought: 't', mood: 'm' }
    expect(parsePrivateToolCalls([toolCall('create_schedule', valid)]).bubbles[0]).toMatchObject({ type: 'scheduleChange', date: '2026-08-12', startHour: 18, endHour: 20 })
    expect(parsePrivateToolCalls([toolCall('create_schedule', { ...valid, startHour: 20 })]).bubbles).toEqual([])
    expect(parsePrivateToolCalls([toolCall('create_schedule', { ...valid, date: '12/08/2026' })]).bubbles).toEqual([])
    expect(parsePrivateToolCalls([toolCall('create_schedule', { ...valid, phoneAccess: 'maybe' })]).bubbles).toEqual([])
  })
})

describe('parseGroupToolCalls', () => {
  it('bounds-checks speakerIndex and parses plan proposals', () => {
    const parsed = parseGroupToolCalls([
      toolCall('send_text', { speakerIndex: 1, content: 'hi', thought: 't', mood: '平静' }),
      toolCall('send_text', { speakerIndex: 9, content: 'out', thought: 't', mood: 'm' }),
      toolCall('propose_plan', { title: '周末爬山', summary: '周六早八点集合', participantIndexes: [1, 2], location: '西山' }),
    ], 2, 2)
    expect(parsed.bubbles).toHaveLength(1)
    expect(parsed.planCandidates).toEqual([{ title: '周末爬山', summary: '周六早八点集合', participantIndexes: [1, 2], location: '西山' }])
  })
})

describe('generatePrivateAgentTurn', () => {
  beforeEach(() => resetFakeServer())
  afterEach(() => vi.unstubAllGlobals())

  it('sends tools with tool_choice required and parses native tool calls', async () => {
    const mock = queueFetch(completionResponse({
      content: '',
      tool_calls: [toolCall('send_text', { content: '好呀', thought: '愿意', mood: '开心' }, 'c1')],
    }))
    const turn = await generatePrivateAgentTurn(BASE_OPTS)
    expect(turn.native).toBe(true)
    expect(turn.parsed.bubbles).toEqual([{ type: 'text', content: '好呀' }])
    const body = lastRequestBody(mock)
    expect(body.tool_choice).toBe('required')
    expect(Array.isArray(body.tools)).toBe(true)
    expect((body.tools as { function: { name: string } }[]).map((t) => t.function.name)).toContain('search_knowledge')
  })

  it('replies with tool-role receipts and retries invalid calls', async () => {
    const mock = queueFetch(
      completionResponse({ content: '', tool_calls: [toolCall('send_text', { content: '缺thought' }, 'bad1')] }),
      completionResponse({ content: '', tool_calls: [toolCall('send_text', { content: '补上了', thought: 't', mood: '平静' }, 'ok1')] }),
    )
    const turn = await generatePrivateAgentTurn(BASE_OPTS)
    expect(turn.parsed.bubbles).toEqual([{ type: 'text', content: '补上了' }])
    const second = lastRequestBody(mock, 1)
    const messages = second.messages as { role: string; tool_call_id?: string; content: string }[]
    const receipt = messages.find((m) => m.role === 'tool' && m.tool_call_id === 'bad1')
    expect(receipt?.content).toContain('INVALID_ARGUMENTS')
  })

  it('forces a companion send_text for bare action cards', async () => {
    const mock = queueFetch(
      completionResponse({ content: '', tool_calls: [toolCall('transfer_money', { amount: 10, note: 'n', thought: 't', mood: 'm' }, 'pay1')] }),
      completionResponse({ content: '', tool_calls: [toolCall('send_text', { content: '请你喝奶茶', thought: 't', mood: '开心' }, 'txt1')] }),
    )
    const turn = await generatePrivateAgentTurn(BASE_OPTS)
    expect(turn.parsed.bubbles.map((b) => b.type)).toEqual(['text', 'transfer'])
    const second = lastRequestBody(mock, 1)
    expect((second.tool_choice as { function: { name: string } }).function.name).toBe('send_text')
  })

  it('falls back to utility-model plan conversion when the API returns prose', async () => {
    const mock = queueFetch(
      completionResponse({ content: '直接是一段自然回复' }),
      completionResponse({ content: '{"calls":[{"name":"send_text","arguments":{"content":"直接是一段自然回复","thought":"t","mood":"平静"}}]}' }),
    )
    const turn = await generatePrivateAgentTurn(BASE_OPTS)
    expect(turn.native).toBe(false)
    expect(turn.parsed.bubbles).toEqual([{ type: 'text', content: '直接是一段自然回复' }])
    const fallbackBody = lastRequestBody(mock, 1)
    expect(fallbackBody.model).toBe('util-model')
  })
})

describe('streaming tool_calls folding', () => {
  beforeEach(() => {
    resetFakeServer()
    useSettingsStore.setState({ generationByProvider: { deepseek: { streamEnabled: true } } })
  })
  afterEach(() => {
    useSettingsStore.setState({ generationByProvider: undefined })
    vi.unstubAllGlobals()
  })

  function sseResponse(events: Record<string, unknown>[]): Response {
    const text = events.map((event) => `data: ${JSON.stringify(event)}\n`).join('\n') + '\ndata: [DONE]\n'
    return new Response(text, { headers: { 'Content-Type': 'text/event-stream' } })
  }

  it('folds per-index tool_call fragments (id/name first fragment, argument pieces concatenated)', async () => {
    const mock = vi.fn().mockResolvedValue(sseResponse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_abc', type: 'function', function: { name: 'send_text', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"content":"晚上' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '好","thought":"t","mood":"开心"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]))
    vi.stubGlobal('fetch', mock)
    const result = await chatCompletion({ apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1', model: 'k3', provider: 'deepseek', messages: [{ role: 'user', content: 'hi' }], tools: [] })
    expect(result.toolCalls).toEqual([{ id: 'call_abc', type: 'function', function: { name: 'send_text', arguments: '{"content":"晚上好","thought":"t","mood":"开心"}' } }])
  })

  it('a streamed agent turn with tool calls is native (no utility fallback)', async () => {
    const mock = vi.fn().mockResolvedValue(sseResponse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_x', type: 'function', function: { name: 'send_text', arguments: '{"content":"好","thought":"t","mood":"平静"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]))
    vi.stubGlobal('fetch', mock)
    const turn = await generatePrivateAgentTurn(BASE_OPTS)
    expect(turn.native).toBe(true)
    expect(turn.parsed.bubbles).toEqual([{ type: 'text', content: '好' }])
    expect(mock).toHaveBeenCalledTimes(1)
  })
})

describe('tool_calls parsing tolerance', () => {
  beforeEach(() => resetFakeServer())
  afterEach(() => vi.unstubAllGlobals())

  it('accepts object-shaped arguments and synthesizes missing ids', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completionResponse({
      content: '',
      tool_calls: [{ type: 'function', function: { name: 'send_text', arguments: { content: '对象参数', thought: 't', mood: '平静' } } }],
    })))
    const result = await chatCompletion({ apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1', model: 'm', provider: 'deepseek', messages: [{ role: 'user', content: 'hi' }], tools: [] })
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0].id).toBeTruthy()
    expect(JSON.parse(result.toolCalls![0].function.arguments)).toMatchObject({ content: '对象参数' })
  })
})

describe('generateGroupAgentTurn', () => {
  beforeEach(() => resetFakeServer())
  afterEach(() => vi.unstubAllGlobals())

  it('parses group turns with speakers and plan proposals', async () => {
    queueFetch(completionResponse({
      content: '',
      tool_calls: [
        toolCall('send_text', { speakerIndex: 1, content: '走起', thought: 't', mood: '兴奋' }, 'g1'),
        toolCall('propose_plan', { title: '聚餐', summary: '周五晚', participantIndexes: [1, 2] }, 'g2'),
      ],
    }))
    const turn = await generateGroupAgentTurn({ ...BASE_OPTS, speakerNames: ['林夏', '周野'], memberNames: ['林夏', '周野'] })
    expect(turn.native).toBe(true)
    expect(turn.parsed.bubbles[0]).toMatchObject({ speakerIndex: 1, type: 'text', content: '走起' })
    expect(turn.parsed.planCandidates).toHaveLength(1)
  })
})
