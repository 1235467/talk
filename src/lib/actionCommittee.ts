import { parseJsonLoose } from './aiProtocol'
import type { LocationNode } from '../types'

export interface ProposedSpecialTask {
  locationId: string
  startsAt: number
  endsAt: number
  activity: string
  summary: string
  phoneAccess: 'available' | 'unavailable'
}

interface ProposalVote {
  decision: 'create_special_task' | 'none'
  locationId?: string
  date?: string
  startTime?: string
  durationMinutes?: number
  activity?: string
  summary?: string
  phoneAccess?: 'available' | 'unavailable'
  confidence: number
  reason: string
}

interface CommitmentVote {
  commitment: 'none' | 'considering' | 'agreed'
  locationId?: string
  confidence: number
  reason: string
}

interface FeasibilityVote {
  allowed: boolean
  hardConflict: boolean
  locationId?: string
  confidence: number
  reason: string
}

export interface ActionCommitteeDebug {
  proposal: ProposalVote | null
  commitment: CommitmentVote | null
  feasibility: FeasibilityVote | null
  approved: boolean
  reason: string
  task?: ProposedSpecialTask
}

/**
 * Single-request mode lets the speaking model emit the task decision itself.
 * We still run the same deterministic guards locally, without another model
 * request. The synthetic votes make the decision visible in existing admin
 * diagnostics while clearly identifying its source.
 */
export function evaluateDirectSpecialTask(raw: string, locations: LocationNode[], now: number, triggeringUserText = ''): ActionCommitteeDebug {
  // A single-call response must never turn an open negotiation into a real
  // task by inventing the missing time. These phrases are deliberately
  // conservative: they express that the current user message still leaves
  // the timing unresolved, regardless of what the model put in its JSON.
  if (/(几点|什么时候|何时|你来定|你定时间|先洗头|先收拾|看情况)/.test(triggeringUserText)) {
    return { proposal: null, commitment: null, feasibility: null, approved: false, reason: '当前对话仍在协商时间，不能创建特殊任务' }
  }
  const root = parseJsonLoose<Record<string, unknown>>(raw)
  const value = root?.specialTask
  if (!value || typeof value !== 'object') {
    return { proposal: null, commitment: null, feasibility: null, approved: false, reason: '直出结果未包含特殊任务决策' }
  }
  const task = value as Record<string, unknown>
  if (task.decision !== 'create_special_task') {
    const proposal: ProposalVote = { decision: 'none', confidence: 1, reason: typeof task.reason === 'string' ? task.reason.slice(0, 240) : '本轮没有形成特殊任务' }
    return { proposal, commitment: null, feasibility: null, approved: false, reason: proposal.reason }
  }

  const proposal: ProposalVote = {
    decision: 'create_special_task',
    locationId: typeof task.locationId === 'string' ? task.locationId.trim() : undefined,
    date: typeof task.date === 'string' ? task.date.trim() : undefined,
    startTime: typeof task.startTime === 'string' ? task.startTime.trim() : undefined,
    durationMinutes: Number.isFinite(Number(task.durationMinutes)) ? Math.round(Number(task.durationMinutes)) : undefined,
    activity: typeof task.activity === 'string' ? task.activity.trim().slice(0, 80) : undefined,
    summary: typeof task.summary === 'string' ? task.summary.trim().slice(0, 120) : undefined,
    phoneAccess: task.phoneAccess === 'unavailable' ? 'unavailable' : 'available',
    confidence: 1,
    reason: typeof task.reason === 'string' ? task.reason.trim().slice(0, 240) : '主模型在同一次调用中确认角色已明确答应',
  }
  const commitment: CommitmentVote = { commitment: 'agreed', locationId: proposal.locationId, confidence: 1, reason: '来自主模型同次结构化决策' }
  const feasibility: FeasibilityVote = { allowed: true, hardConflict: false, locationId: proposal.locationId, confidence: 1, reason: '交由本地硬规则校验' }
  const leafLocations = locations.filter((location) => !locations.some((candidate) => candidate.parentId === location.id))
  const result = arbitrateActionCommittee({ proposal, commitment, feasibility, validLocationIds: new Set(leafLocations.map((location) => location.id)), now })
  return { proposal, commitment, feasibility, ...result }
}


function parseLocalTime(date: string | undefined, time: string | undefined) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return undefined
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const result = new Date(year, month - 1, day, hour, minute, 0, 0)
  return result.getFullYear() === year && result.getMonth() === month - 1 && result.getDate() === day ? result.getTime() : undefined
}

export function arbitrateActionCommittee(input: { proposal: ProposalVote | null; commitment: CommitmentVote | null; feasibility: FeasibilityVote | null; validLocationIds: Set<string>; now: number }): Pick<ActionCommitteeDebug, 'approved' | 'reason' | 'task'> {
  const { proposal, commitment, feasibility } = input
  if (!proposal || !commitment || !feasibility) return { approved: false, reason: '行动委员会有成员未返回有效判断' }
  if (proposal.decision !== 'create_special_task') return { approved: false, reason: proposal.reason || '行动提议者认为没有形成特殊任务' }
  if (proposal.confidence < .65) return { approved: false, reason: '行动提议置信度不足' }
  if (commitment.commitment !== 'agreed' || commitment.confidence < .6) return { approved: false, reason: commitment.reason || '角色没有明确同意执行' }
  if (!feasibility.allowed || feasibility.hardConflict) return { approved: false, reason: feasibility.reason || '行为与当前硬前提冲突' }
  if (!proposal.locationId || !input.validLocationIds.has(proposal.locationId)) return { approved: false, reason: '行动提议没有指向合法的具体地点' }
  if (commitment.locationId && commitment.locationId !== proposal.locationId) return { approved: false, reason: '行动提议与承诺检测的地点不一致' }
  // The proposal owns the concrete task parameters. Feasibility only decides
  // whether that task is possible; its optional location is diagnostic and
  // must not veto an otherwise valid task merely because it picked a nearby
  // area (for example mall-atrium instead of the explicitly named mall-shop).
  const startsAt = parseLocalTime(proposal.date, proposal.startTime)
  const durationMinutes = proposal.durationMinutes ?? 0
  if (!startsAt || durationMinutes < 5 || durationMinutes > 24 * 60) return { approved: false, reason: '没有得到合法的精确起止时间' }
  if (startsAt < input.now - 5 * 60_000 || startsAt > input.now + 14 * 86_400_000) return { approved: false, reason: '任务开始时间超出允许范围' }
  if (!proposal.activity || !proposal.summary) return { approved: false, reason: '任务缺少活动或摘要' }
  return { approved: true, reason: '三个专项判断一致，允许创建特殊任务', task: { locationId: proposal.locationId, startsAt, endsAt: startsAt + durationMinutes * 60_000, activity: proposal.activity, summary: proposal.summary, phoneAccess: proposal.phoneAccess ?? 'available' } }
}

