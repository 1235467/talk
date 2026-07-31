import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { TopBar } from '../components/TopBar'
import { useSettingsStore } from '../store/useSettingsStore'
import {
  AI_TEST_SCENARIOS,
  generateAiTestCases,
  runAiTestSuite,
  type AiTestScenarioId,
  type CompletedAiTestCase,
  type GeneratedAiTestCase,
} from '../lib/aiTestCards'
import type { AppSettings } from '../types'

type Rating = 'up' | 'down' | null

interface CardState extends GeneratedAiTestCase {
  status: 'pending' | 'running' | 'done' | 'error'
  result?: CompletedAiTestCase
  error?: string
  rating: Rating
  comment: string
}

function downloadMarkdown(contactName: string, scenarioLabel: string, cards: CardState[]) {
  const lines = [
    '# AI 聊天人工评测汇总',
    '',
    `- 联系人：${contactName}`,
    `- 测试场景：${scenarioLabel}`,
    `- 导出时间：${new Date().toLocaleString()}`,
    '',
  ]
  cards.forEach((card, index) => {
    const result = card.result
    lines.push(
      `## ${index + 1}. ${card.description}`,
      '',
      '### 模拟用户消息',
      '',
      card.userMessage,
      '',
      '### AI 回复',
      '',
      result?.reply ?? `（运行失败：${card.error || '未知错误'}）`,
      '',
      '### 实际使用的上下文',
      '',
      `- 世界书条目：${result?.context.worldbookEntries.join('、') || '无'}`,
      `- 记忆摘要：${result?.context.memorySummary || '无'}`,
      '',
      '### 人工评价',
      '',
      `- 评分：${card.rating === 'up' ? '👍' : '👎'}`,
      `- 评论：${card.comment.trim() || '无'}`,
      '',
    )
  })
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `ai-test-${new Date().toISOString().replace(/[:.]/g, '-')}.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function AiTestCardsPage() {
  const contacts = useLiveQuery(() => db.contacts.filter((contact) => !contact.id.startsWith('ai-test-contact-')).sortBy('createdAt'), [])
  const stickers = useLiveQuery(() => db.stickers.toArray(), []) ?? []
  const settings = useSettingsStore()
  const [contactId, setContactId] = useState('')
  const [scenarioId, setScenarioId] = useState<AiTestScenarioId>('daily')
  const [count, setCount] = useState(5)
  const [cards, setCards] = useState<CardState[]>([])
  const [generating, setGenerating] = useState(false)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const selectedContact = contacts?.find((contact) => contact.id === contactId) ?? contacts?.[0]
  const selectedScenario = AI_TEST_SCENARIOS.find((scenario) => scenario.id === scenarioId) ?? AI_TEST_SCENARIOS[0]
  const allRated = cards.length > 0 && cards.every((card) => card.status === 'done' && card.rating !== null)
  const doneCount = cards.filter((card) => card.status === 'done').length

  const contextCounts = useMemo(() => cards.reduce((total, card) => total + (card.result?.context.worldbookEntries.length ?? 0), 0), [cards])

  async function handleGenerate() {
    if (!selectedContact) return
    if (!settings.apiKey) {
      setMessage('请先在设置中填写 AI API Key。')
      return
    }
    setGenerating(true)
    setMessage('正在让 AI 生成测试用例…')
    try {
      const generated = await generateAiTestCases(selectedContact, scenarioId, count, settings as AppSettings)
      setCards(generated.map((item) => ({ ...item, status: 'pending', rating: null, comment: '' })))
      setMessage(`已生成 ${generated.length} 条用例。确认内容后可开始批量运行。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setGenerating(false)
    }
  }

  async function handleRun() {
    if (!selectedContact || cards.length < 5) return
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setMessage('测试数据只存在于临时会话中，完成或取消后会自动清理。')
    setCards((current) => current.map((card) => ({ ...card, status: 'pending', result: undefined, error: undefined, rating: null, comment: '' })))
    try {
      await runAiTestSuite({
        contact: selectedContact,
        cases: cards,
        settings: settings as AppSettings,
        stickers,
        signal: controller.signal,
        onProgress: (index, result) => {
          setCards((current) => current.map((card, cardIndex) => cardIndex === index
            ? { ...card, status: result ? 'done' : 'running', result: result ?? card.result }
            : card))
        },
      })
      setMessage('批量测试完成。请逐张卡片人工评分并填写评论。')
    } catch (error) {
      const text = error instanceof DOMException && error.name === 'AbortError'
        ? '测试已取消，临时数据已清理。'
        : error instanceof Error ? error.message : String(error)
      setCards((current) => current.map((card) => card.status === 'running' ? { ...card, status: 'error', error: text } : card))
      setMessage(text)
    } finally {
      abortRef.current = null
      setRunning(false)
    }
  }

  function patchCard(index: number, patch: Partial<CardState>) {
    setCards((current) => current.map((card, cardIndex) => cardIndex === index ? { ...card, ...patch } : card))
  }

  return (
    <div className="relative flex h-[var(--app-height)] flex-col overflow-hidden bg-[#f4f4f6]">
      <TopBar title="AI 自动测试卡片" showBack />
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        <section className="mt-3 rounded-xl bg-white p-4">
          <p className="text-xs leading-relaxed text-gray-500">机器只生成用例并运行真实聊天引擎，不自动判断好坏。所有测试联系人、会话和消息都会在本轮结束后清理。</p>
          <label className="mt-4 block text-xs text-gray-500">联系人</label>
          <select
            value={selectedContact?.id ?? ''}
            onChange={(event) => { setContactId(event.target.value); setCards([]) }}
            disabled={running || generating}
            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900"
          >
            {(contacts ?? []).map((contact) => <option key={contact.id} value={contact.id}>{contact.remark || contact.name}</option>)}
          </select>

          <label className="mt-3 block text-xs text-gray-500">测试场景</label>
          <select
            value={scenarioId}
            onChange={(event) => { setScenarioId(event.target.value as AiTestScenarioId); setCards([]) }}
            disabled={running || generating}
            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900"
          >
            {AI_TEST_SCENARIOS.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.label}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-gray-400">{selectedScenario.description}</p>

          <label className="mt-3 block text-xs text-gray-500">用例数量（至少 5 条）</label>
          <input
            type="number"
            min={5}
            max={20}
            value={count}
            onChange={(event) => setCount(Math.max(5, Math.min(20, Number(event.target.value) || 5)))}
            disabled={running || generating}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
          />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void handleGenerate()} disabled={!selectedContact || generating || running} className="rounded-lg bg-gray-900 py-2.5 text-sm text-white disabled:opacity-40">
              {generating ? '生成中…' : '1. 生成用例'}
            </button>
            {running ? (
              <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-lg bg-red-50 py-2.5 text-sm text-red-600">取消并清理</button>
            ) : (
              <button type="button" onClick={() => void handleRun()} disabled={cards.length < 5 || generating} className="rounded-lg bg-[var(--ui-special)] py-2.5 text-sm text-[var(--ui-special-text)] disabled:opacity-40">2. 批量运行</button>
            )}
          </div>
          {message && <p className="mt-3 text-xs leading-relaxed text-gray-500">{message}</p>}
        </section>

        {cards.length > 0 && (
          <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
            <span>完成 {doneCount}/{cards.length}</span>
            <span>命中世界书 {contextCounts} 次</span>
          </div>
        )}

        <div className="mt-2 space-y-3">
          {cards.map((card, index) => (
            <article key={card.id} className="rounded-xl bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-gray-400">用例 {index + 1}</p>
                  <h2 className="mt-1 text-sm font-medium text-gray-900">{card.description}</h2>
                </div>
                <span className={`shrink-0 rounded px-2 py-1 text-[10px] ${card.status === 'done' ? 'bg-green-50 text-green-700' : card.status === 'error' ? 'bg-red-50 text-red-600' : card.status === 'running' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                  {card.status === 'done' ? '已完成' : card.status === 'error' ? '失败' : card.status === 'running' ? '运行中' : '待运行'}
                </span>
              </div>
              <div className="mt-3 rounded-lg bg-gray-50 p-3">
                <p className="text-[11px] text-gray-400">模拟用户消息</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{card.userMessage}</p>
              </div>
              {card.result && (
                <>
                  <div className="mt-3 rounded-lg border border-gray-100 p-3">
                    <p className="text-[11px] text-gray-400">AI 真实回复</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-900">{card.result.reply}</p>
                  </div>
                  <details className="mt-3 rounded-lg bg-gray-50 p-3">
                    <summary className="cursor-pointer text-xs text-gray-600">查看本轮实际上下文摘要</summary>
                    <div className="mt-2 space-y-2 text-xs leading-relaxed text-gray-500">
                      <p><span className="text-gray-400">世界书：</span>{card.result.context.worldbookEntries.join('、') || '未命中'}</p>
                      <p><span className="text-gray-400">结构化记忆：</span>{card.result.context.memorySummary || '未注入'}</p>
                      {card.result.context.sections.map((section) => <p key={section.label}><span className="text-gray-400">{section.label}：</span>{section.summary}</p>)}
                    </div>
                  </details>
                  <div className="mt-4 border-t border-gray-100 pt-3">
                    <p className="text-xs text-gray-500">人工评分</p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => patchCard(index, { rating: 'up' })} className={`rounded-lg px-4 py-2 text-lg ${card.rating === 'up' ? 'bg-green-100 ring-1 ring-green-400' : 'bg-gray-100'}`} aria-label="好评">👍</button>
                      <button type="button" onClick={() => patchCard(index, { rating: 'down' })} className={`rounded-lg px-4 py-2 text-lg ${card.rating === 'down' ? 'bg-red-100 ring-1 ring-red-400' : 'bg-gray-100'}`} aria-label="差评">👎</button>
                    </div>
                    <textarea value={card.comment} onChange={(event) => patchCard(index, { comment: event.target.value })} placeholder="写下具体问题或做得好的地方（可选）" rows={3} className="mt-2 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                  </div>
                </>
              )}
              {card.error && <p className="mt-3 text-xs text-red-600">{card.error}</p>}
            </article>
          ))}
        </div>

        {cards.length > 0 && (
          <button
            type="button"
            disabled={!allRated}
            onClick={() => selectedContact && downloadMarkdown(selectedContact.remark || selectedContact.name, selectedScenario.label, cards)}
            className="mt-4 w-full rounded-xl bg-gray-900 py-3 text-sm text-white disabled:opacity-40"
          >
            导出 Markdown 汇总
          </button>
        )}
        {cards.length > 0 && !allRated && !running && <p className="mt-2 text-center text-[11px] text-gray-400">完成全部测试并为每张卡片选择 👍 或 👎 后即可导出。</p>}
      </div>
    </div>
  )
}

