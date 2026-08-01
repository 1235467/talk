/** @ui standard */
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { TopBar } from '../components/TopBar'
import { useSettingsStore } from '../store/useSettingsStore'
import { cleanupResidualAiTestData } from '../lib/aiTestCards'
import {
  AI_TEST_KINDS,
  createAiTestSuite,
  markInterruptedAiTests,
  startAiTestSuite,
  stopAiTestSuite,
  updateAiTestReview,
} from '../lib/aiTestManager'
import type { AiTestKind, AiTestSuiteRecord, AppSettings, Contact } from '../types'

const PRIVATE_SCENARIOS = ['日常关系与语气', '涉及金钱的连续对话', '日程冲突与改约', '长对话人设一致性', '记忆与世界书召回']
const STATUS_LABEL: Record<AiTestSuiteRecord['status'], string> = {
  draft: '待运行', running: '后台运行中', completed: '已完成', interrupted: '已中断', cancelled: '已停止', failed: '运行失败',
}

function exportSuite(suite: AiTestSuiteRecord) {
  const lines = [
    `# ${suite.title}`,
    '',
    `- 类型：${AI_TEST_KINDS.find((item) => item.id === suite.kind)?.label}`,
    `- 方式：${suite.executionMode === 'sequential' ? '连续顺序测试' : '独立功能测试'}`,
    `- 状态：${STATUS_LABEL[suite.status]}`,
    '',
  ]
  for (const card of suite.cards) {
    lines.push(
      `## ${card.order + 1}. ${card.description}`,
      '',
      `用户输入：${card.userMessage}`,
      '',
      'AI 回复：',
      '',
      card.reply || `（${card.error || '尚未运行'}）`,
      '',
      `评分：${card.rating === 'up' ? '👍' : card.rating === 'down' ? '👎' : '未评分'}`,
      `评论：${card.comment || '无'}`,
      `世界书：${card.context?.worldbookEntries.join('、') || '无'}`,
      `记忆摘要：${card.context?.memorySummary || '无'}`,
      '',
    )
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `ai-test-${suite.id}.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function AiTestCardsPage() {
  const contacts = useLiveQuery(() => db.contacts.filter((item) => !item.id.startsWith('ai-test-')).sortBy('createdAt'), []) ?? []
  const groups = useLiveQuery(() => db.groups.filter((item) => !item.id.startsWith('ai-test-')).sortBy('createdAt'), []) ?? []
  const suites = useLiveQuery(() => db.aiTestSuites.orderBy('createdAt').reverse().toArray(), []) ?? []
  const settings = useSettingsStore()
  const [kind, setKind] = useState<AiTestKind>('conversation')
  const [contactId, setContactId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [scenario, setScenario] = useState(PRIVATE_SCENARIOS[0])
  const [count, setCount] = useState(20)
  const [creating, setCreating] = useState(false)
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const definition = AI_TEST_KINDS.find((item) => item.id === kind)!
  const selectedContact = contacts.find((item) => item.id === contactId) ?? contacts[0]
  const selectedGroup = groups.find((item) => item.id === groupId) ?? groups[0]
  const selectedSuite = suites.find((item) => item.id === selectedSuiteId) ?? suites[0]

  useEffect(() => { void markInterruptedAiTests() }, [])

  async function handleCreate() {
    if (!settings.apiKey) return setNotice('请先在设置里填写 AI API Key。')
    setCreating(true)
    setNotice('AI 正在生成测试用例…')
    try {
      let members: Contact[] | undefined
      if (kind === 'group' && selectedGroup) members = (await db.contacts.bulkGet(selectedGroup.memberContactIds)).filter((item): item is Contact => !!item && !item.id.startsWith('ai-test-'))
      const suite = await createAiTestSuite({
        kind,
        count,
        scenarioLabel: kind === 'conversation' ? scenario : definition.label,
        contact: kind === 'group' ? undefined : selectedContact,
        group: kind === 'group' ? selectedGroup : undefined,
        groupMembers: members,
        settings: settings as AppSettings,
      })
      setSelectedSuiteId(suite.id)
      setNotice(`已生成 ${suite.cards.length} 条用例。可先编辑，再交给后台运行。`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setCreating(false)
    }
  }

  async function editCase(suite: AiTestSuiteRecord, cardId: string, userMessage: string) {
    await db.aiTestSuites.update(suite.id, {
      cards: suite.cards.map((card) => card.id === cardId ? { ...card, userMessage } : card),
      updatedAt: Date.now(),
    })
  }

  async function handleCleanup() {
    if (suites.some((suite) => suite.status === 'running')) {
      setNotice('请先停止正在运行的后台测试，再清理测试副本。')
      return
    }
    const result = await cleanupResidualAiTestData()
    setNotice(result.total ? `已清理 ${result.total} 条测试副本数据；已保存的测试报告未删除。` : '没有发现测试副本数据。')
  }

  const completedCount = selectedSuite?.cards.filter((card) => card.status === 'completed').length ?? 0
  const sequential = definition.mode === 'sequential'
  const maxCount = sequential ? 50 : 20
  const selectionValid = kind === 'group' ? Boolean(selectedGroup) : Boolean(selectedContact)
  const allRated = selectedSuite?.cards.every((card) => card.status === 'completed' && card.rating) ?? false

  return (
    <div className="relative flex h-[var(--app-height)] flex-col overflow-hidden bg-[#f4f4f6]">
      <TopBar title="AI 自动测试" showBack />
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        <section className="mt-3 rounded-xl bg-white p-4">
          <h2 className="text-sm font-medium text-gray-900">创建测试</h2>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">AI 只生成用例和整理真实输出，最终好坏完全由管理员评分。</p>

          <label className="mt-4 block text-xs text-gray-500">测试类型</label>
          <select value={kind} onChange={(event) => { const next = event.target.value as AiTestKind; setKind(next); setCount(next === 'conversation' || next === 'group' ? 20 : 5) }} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900">
            {AI_TEST_KINDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>

          {sequential ? (
            <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm font-medium text-gray-900">连续对话轨道</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">所有消息按顺序进入同一个副本会话，上一轮回复会成为下一轮上下文。适合观察长线逻辑，不拆成独立用例。</p>
              {kind === 'conversation' && <select value={scenario} onChange={(event) => setScenario(event.target.value)} className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm">{PRIVATE_SCENARIOS.map((item) => <option key={item}>{item}</option>)}</select>}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3">
              <p className="text-sm font-medium text-gray-900">独立功能用例</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">每条用例使用一个独立联系人副本，不继承其他用例历史，重点展示模型返回的结构化 JSON。</p>
            </div>
          )}

          {kind === 'group' ? (
            <><label className="mt-3 block text-xs text-gray-500">目标群聊</label><select value={selectedGroup?.id ?? ''} onChange={(event) => setGroupId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm">{groups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></>
          ) : (
            <><label className="mt-3 block text-xs text-gray-500">目标联系人</label><select value={selectedContact?.id ?? ''} onChange={(event) => setContactId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm">{contacts.map((item) => <option key={item.id} value={item.id}>{item.remark || item.name}</option>)}</select></>
          )}

          <label className="mt-3 block text-xs text-gray-500">用例数量（5–{maxCount}）</label>
          <input type="number" min={5} max={maxCount} value={count} onChange={(event) => setCount(Math.max(5, Math.min(maxCount, Number(event.target.value) || 5)))} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
          <button type="button" onClick={() => void handleCreate()} disabled={creating || !selectionValid} className="mt-4 w-full rounded-lg bg-gray-900 py-3 text-sm text-white disabled:opacity-40">{creating ? '正在生成…' : 'AI 生成用例'}</button>
        </section>

        {notice && <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs leading-relaxed text-gray-500">{notice}</p>}

        <section className="mt-3 rounded-xl bg-white p-4">
          <div className="flex items-center justify-between"><h2 className="text-sm font-medium text-gray-900">测试记录</h2><button type="button" onClick={() => void handleCleanup()} className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">清理所有测试副本</button></div>
          {suites.length > 0 ? <select value={selectedSuite?.id ?? ''} onChange={(event) => setSelectedSuiteId(event.target.value)} className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm">{suites.map((suite) => <option key={suite.id} value={suite.id}>{suite.title} · {STATUS_LABEL[suite.status]}</option>)}</select> : <p className="mt-3 text-xs text-gray-400">还没有保存的测试记录。</p>}
        </section>

        {selectedSuite && <section className="mt-3">
          <div className="rounded-xl bg-white p-4">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-medium text-gray-900">{selectedSuite.title}</h2><p className="mt-1 text-xs text-gray-500">{selectedSuite.executionMode === 'sequential' ? '连续顺序测试' : '独立功能测试'} · {completedCount}/{selectedSuite.cards.length}</p></div><span className="rounded bg-gray-100 px-2 py-1 text-[10px] text-gray-600">{STATUS_LABEL[selectedSuite.status]}</span></div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {selectedSuite.status === 'running' ? <button type="button" onClick={() => void stopAiTestSuite(selectedSuite)} className="rounded-lg bg-red-50 py-2.5 text-sm text-red-600">停止后台测试</button> : <button type="button" onClick={() => startAiTestSuite(selectedSuite.id)} disabled={selectedSuite.status === 'completed'} className="rounded-lg bg-gray-900 py-2.5 text-sm text-white disabled:opacity-40">{selectedSuite.status === 'draft' ? '开始后台测试' : '继续后台测试'}</button>}
              <button type="button" onClick={() => exportSuite(selectedSuite)} className="rounded-lg bg-gray-100 py-2.5 text-sm text-gray-700">导出 Markdown</button>
            </div>
            {selectedSuite.error && <p className="mt-2 text-xs text-red-600">{selectedSuite.error}</p>}
          </div>

          <div className={`mt-3 ${selectedSuite.executionMode === 'sequential' ? 'border-l-2 border-gray-200 pl-3' : 'grid gap-3'}`}>
            {selectedSuite.cards.map((card, index) => <article key={card.id} className="mb-3 rounded-xl bg-white p-4">
              <div className="flex items-center justify-between"><p className="text-xs font-medium text-gray-400">{selectedSuite.executionMode === 'sequential' ? `第 ${index + 1} 轮` : `独立用例 ${index + 1}`}</p><span className="text-[10px] text-gray-400">{card.status === 'completed' ? '已完成' : card.status === 'running' ? '运行中' : card.status === 'failed' ? '失败' : '待运行'}</span></div>
              <p className="mt-1 text-sm font-medium text-gray-900">{card.description}</p>
              <textarea value={card.userMessage} disabled={selectedSuite.status !== 'draft'} onChange={(event) => void editCase(selectedSuite, card.id, event.target.value)} rows={2} className="mt-3 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50" />
              {card.reply && <div className="mt-3 rounded-lg bg-gray-50 p-3"><p className="text-[11px] text-gray-400">真实回复</p><p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-900">{card.reply}</p></div>}
              {card.rawResponse && <details className="mt-2 rounded-lg border border-gray-100 p-3"><summary className="text-xs text-gray-500">查看原始 JSON / 上下文</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-gray-600">{card.rawResponse}</pre><p className="mt-2 text-xs text-gray-500">世界书：{card.context?.worldbookEntries.join('、') || '无'}<br />记忆：{card.context?.memorySummary || '无'}</p></details>}
              {card.error && <p className="mt-2 text-xs text-red-600">{card.error}</p>}
              {card.status === 'completed' && <div className="mt-3 border-t border-gray-100 pt-3"><div className="flex gap-2"><button type="button" onClick={() => void updateAiTestReview(selectedSuite.id, card.id, { rating: 'up', comment: card.comment })} className={`rounded-lg px-4 py-2 ${card.rating === 'up' ? 'bg-green-100' : 'bg-gray-100'}`}>👍</button><button type="button" onClick={() => void updateAiTestReview(selectedSuite.id, card.id, { rating: 'down', comment: card.comment })} className={`rounded-lg px-4 py-2 ${card.rating === 'down' ? 'bg-red-100' : 'bg-gray-100'}`}>👎</button></div><textarea value={card.comment ?? ''} onChange={(event) => void updateAiTestReview(selectedSuite.id, card.id, { rating: card.rating, comment: event.target.value })} rows={2} placeholder="人工评论" className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" /></div>}
            </article>)}
          </div>
          {selectedSuite.status === 'completed' && !allRated && <p className="text-center text-xs text-gray-400">请由管理员逐条评分；系统不会自动判断好坏。</p>}
        </section>}
      </div>
    </div>
  )
}
