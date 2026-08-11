import { useEffect, useState } from 'react'
import { useLocalQuery } from '../lib/useLocalQuery'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { db } from '../db/unmigrated'
import { api } from '../lib/api/resources'
import { getOrUndef } from '../lib/api/client'
import { invalidate } from '../lib/api/keys'
import { suggestContactAdminEdit, type ContactAdminSuggestion } from '../lib/contactAdminAssistant'
import { useSettingsStore } from '../store/useSettingsStore'
import type { Contact, ContactExperience, ContactLifeState, ContactMemory, ContactRelationLink, SocialEvent, WalletAccount, WalletTransaction } from '../types'
import { regenerateContactVisualIdentity } from '../lib/imageAssets'
import { FACTORY_PRESET_NAME } from '../lib/promptPresets'

const EMPTY_MEMORIES: ContactMemory[] = []
const EMPTY_RELATIONS: ContactRelationLink[] = []
const EMPTY_EXPERIENCES: ContactExperience[] = []
const EMPTY_SOCIAL_EVENTS: SocialEvent[] = []
const EMPTY_TRANSACTIONS: WalletTransaction[] = []
const pretty = (value: unknown) => JSON.stringify(value ?? null, null, 2)

function parseArray<T>(label: string, text: string): T[] {
  const parsed: unknown = JSON.parse(text)
  if (!Array.isArray(parsed)) throw new Error(`${label}必须是 JSON 数组`)
  return parsed as T[]
}

function parseObject<T>(label: string, text: string): T | null {
  const parsed: unknown = JSON.parse(text)
  if (parsed === null) return null
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label}必须是 JSON 对象或 null`)
  return parsed as T
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) {
  return <label className="block"><span className="mb-1 block text-xs text-gray-500">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" /></label>
}

function Area({ label, value, onChange, rows = 5, mono = false, note }: { label: string; value: string; onChange: (value: string) => void; rows?: number; mono?: boolean; note?: string }) {
  return <label className="block"><span className="mb-1 block text-xs text-gray-500">{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} className={`w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-xs leading-relaxed ${mono ? 'font-mono' : ''}`} />{note && <span className="mt-1 block text-[10px] leading-relaxed text-gray-400">{note}</span>}</label>
}

export function ContactAdminPage() {
  const { contactId } = useParams()
  const settings = useSettingsStore()
  const { data: contact } = useQuery({
    queryKey: ['contacts', contactId],
    queryFn: () => getOrUndef(api.contacts.get(contactId!)),
    enabled: !!contactId,
  })
  const { data: memories = EMPTY_MEMORIES } = useQuery({
    queryKey: ['contactMemories', contactId],
    queryFn: () => api.contactMemories.list({ contactId: contactId! }),
    enabled: !!contactId,
  })
  const { data: relations = EMPTY_RELATIONS } = useQuery({
    queryKey: ['contactRelations', 'by-contact', contactId],
    queryFn: async () => (await api.contactRelations.list()).filter((row) => row.fromContactId === contactId || row.toContactId === contactId),
    enabled: !!contactId,
  })
  const { data: experiences = EMPTY_EXPERIENCES } = useQuery({
    queryKey: ['contactExperiences', 'by-contact', contactId],
    queryFn: () => api.contactExperiences.list({ contactIds_contains: contactId! }),
    enabled: !!contactId,
  })
  const { data: socialEvents = EMPTY_SOCIAL_EVENTS } = useQuery({
    queryKey: ['socialEvents', 'by-contact', contactId],
    queryFn: async () => (await api.socialEvents.list()).filter((row) => row.actorId === contactId || row.targetId === contactId || row.relatedContactIds.includes(contactId!)),
    enabled: !!contactId,
  })
  const { data: lifeState } = useQuery({
    queryKey: ['contactLifeStates', contactId],
    queryFn: () => getOrUndef(api.contactLifeStates.get(contactId!)),
    enabled: !!contactId,
  })
  const { data: presets } = useQuery({ queryKey: ['presets'], queryFn: () => api.presets.list() })
  const wallet = useLocalQuery(() => contactId ? db.walletAccounts.get(contactId) : undefined, [contactId])
  const transactions = useLocalQuery(() => contactId ? db.walletTransactions.filter((row: any) => row.fromOwnerId === contactId || row.toOwnerId === contactId).toArray() : EMPTY_TRANSACTIONS, [contactId]) ?? EMPTY_TRANSACTIONS

  const [draft, setDraft] = useState<Contact | null>(null)
  const [profileJson, setProfileJson] = useState('null')
  const [moodJson, setMoodJson] = useState('null')
  const [intentJson, setIntentJson] = useState('[]')
  const [scheduleJson, setScheduleJson] = useState('[]')
  const [scheduleOverrideJson, setScheduleOverrideJson] = useState('[]')
  const [traitJson, setTraitJson] = useState('[]')
  const [memoryJson, setMemoryJson] = useState('[]')
  const [relationJson, setRelationJson] = useState('[]')
  const [experienceJson, setExperienceJson] = useState('[]')
  const [socialJson, setSocialJson] = useState('[]')
  const [lifeJson, setLifeJson] = useState('null')
  const [walletJson, setWalletJson] = useState('null')
  const [transactionJson, setTransactionJson] = useState('[]')
  const [status, setStatus] = useState('')
  const [aiInstruction, setAiInstruction] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [suggestion, setSuggestion] = useState<ContactAdminSuggestion | null>(null)
  const [initializedId, setInitializedId] = useState('')

  useEffect(() => {
    if (!contact || initializedId === contact.id) return
    setDraft(structuredClone(contact))
    setProfileJson(pretty(contact.personaProfile))
    setMoodJson(pretty(contact.mood))
    setIntentJson(pretty(contact.intentQueue ?? []))
    setScheduleJson(pretty(contact.schedule ?? []))
    setScheduleOverrideJson(pretty(contact.scheduleOverrides ?? []))
    setTraitJson(pretty(contact.customPersonalityTraits ?? []))
    setInitializedId(contact.id)
  }, [contact, initializedId, settings])
  useEffect(() => { if (contact && initializedId === contact.id) setMemoryJson(pretty(memories)) }, [contact, initializedId, memories])
  useEffect(() => { if (contact && initializedId === contact.id) setRelationJson(pretty(relations)) }, [contact, initializedId, relations])
  useEffect(() => { if (contact && initializedId === contact.id) setExperienceJson(pretty(experiences)) }, [contact, initializedId, experiences])
  useEffect(() => { if (contact && initializedId === contact.id) setSocialJson(pretty(socialEvents)) }, [contact, initializedId, socialEvents])
  useEffect(() => { if (contact && initializedId === contact.id) setLifeJson(pretty(lifeState)) }, [contact, initializedId, lifeState])
  useEffect(() => { if (contact && initializedId === contact.id) setWalletJson(pretty(wallet)) }, [contact, initializedId, wallet])
  useEffect(() => { if (contact && initializedId === contact.id) setTransactionJson(pretty(transactions)) }, [contact, initializedId, transactions])

  const patchDraft = (patch: Partial<Contact>) => setDraft((current) => current ? { ...current, ...patch } : current)


  async function saveAll() {
    if (!contactId || !contact || !draft) return
    setStatus('')
    try {
      if (!draft.name.trim()) throw new Error('联系人名称不能为空')
      if (draft.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(draft.birthday)) throw new Error('生日必须使用 YYYY-MM-DD')
      const nextMemories = parseArray<ContactMemory>('AI记忆', memoryJson).map((row) => ({ ...row, contactId }))
      const personaProfile = parseObject<Contact['personaProfile']>('结构化人设', profileJson)
      const mood = parseObject<NonNullable<Contact['mood']>>('当前心情', moodJson)
      const intentQueue = parseArray<NonNullable<Contact['intentQueue']>[number]>('AI内部意图', intentJson)
      const schedule = parseArray<NonNullable<Contact['schedule']>[number]>('固定日程', scheduleJson)
      const scheduleOverrides = parseArray<NonNullable<Contact['scheduleOverrides']>[number]>('特殊日程', scheduleOverrideJson)
      const customPersonalityTraits = parseArray<NonNullable<Contact['customPersonalityTraits']>[number]>('自定义性格特质', traitJson)
      const nextRelations = parseArray<ContactRelationLink>('AI关系', relationJson)
      const nextExperiences = parseArray<ContactExperience>('经历', experienceJson)
      const nextSocial = parseArray<SocialEvent>('社交动态', socialJson)
      const nextLife = parseObject<ContactLifeState>('生活状态', lifeJson)
      const nextWallet = parseObject<WalletAccount>('钱包', walletJson)
      const nextTransactions = parseArray<WalletTransaction>('交易记录', transactionJson)
      const oldExperienceIds = new Set(experiences.map((row) => row.id))
      const nextExperienceIds = new Set(nextExperiences.map((row) => row.id))

      await api.contacts.put({ ...draft, id: contact.id, createdAt: contact.createdAt, personaProfile: personaProfile ?? undefined, mood: mood ?? undefined, intentQueue, schedule, scheduleOverrides, customPersonalityTraits })
      invalidate('contacts')
      const oldMemories = await api.contactMemories.list({ contactId })
      if (oldMemories.length) await api.contactMemories.bulkDelete(oldMemories.map((row) => row.id))
      if (nextMemories.length) await api.contactMemories.bulkPut(nextMemories)
      invalidate('contactMemories')
      const oldRelations = (await api.contactRelations.list()).filter((row) => row.fromContactId === contactId || row.toContactId === contactId)
      if (oldRelations.length) await api.contactRelations.bulkDelete(oldRelations.map((row) => row.id))
      if (nextRelations.length) await api.contactRelations.bulkPut(nextRelations)
      invalidate('contactRelations')
      for (const old of experiences) if (oldExperienceIds.has(old.id) && !nextExperienceIds.has(old.id)) {
        if (old.contactIds.length > 1) await api.contactExperiences.patch(old.id, { contactIds: old.contactIds.filter((id) => id !== contactId) })
        else await api.contactExperiences.delete(old.id)
      }
      if (nextExperiences.length) await api.contactExperiences.bulkPut(nextExperiences)
      invalidate('contactExperiences')
      const oldSocial = (await api.socialEvents.list()).filter((row) => row.actorId === contactId || row.targetId === contactId || row.relatedContactIds.includes(contactId))
      if (oldSocial.length) await api.socialEvents.bulkDelete(oldSocial.map((row) => row.id))
      if (nextSocial.length) await api.socialEvents.bulkPut(nextSocial)
      invalidate('socialEvents')
      if (nextLife) await api.contactLifeStates.put({ ...nextLife, contactId })
      else if (lifeState) await api.contactLifeStates.delete(contactId)
      invalidate('contactLifeStates')
      if (nextWallet) await db.walletAccounts.put({ ...nextWallet, ownerId: contactId })
      else await db.walletAccounts.delete(contactId)
      await db.walletTransactions.filter((row: any) => row.fromOwnerId === contactId || row.toOwnerId === contactId).delete()
      if (nextTransactions.length) await db.walletTransactions.bulkPut(nextTransactions)
      setStatus('已保存，下一轮聊天会使用新资料。')
      setDraft((current) => current)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function askAi() {
    if (!contact || !draft || !aiInstruction.trim()) return
    if (!settings.apiKey) { setStatus('请先配置 API Key'); return }
    setAiBusy(true); setStatus(''); setSuggestion(null)
    try {
      const result = await suggestContactAdminEdit({ settings, contact: draft, experiences: parseArray<ContactExperience>('经历', experienceJson), instruction: aiInstruction.trim() })
      setSuggestion(result)
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
    finally { setAiBusy(false) }
  }

  function applySuggestion() {
    if (!suggestion || !draft) return
    const unsafe = suggestion.contactPatch ?? {}
    const { id: _id, createdAt: _createdAt, ...safePatch } = unsafe
    void _id; void _createdAt
    setDraft({ ...draft, ...safePatch, id: draft.id, createdAt: draft.createdAt })
    if ('personaProfile' in safePatch) setProfileJson(pretty(safePatch.personaProfile))
    if ('mood' in safePatch) setMoodJson(pretty(safePatch.mood))
    if ('intentQueue' in safePatch) setIntentJson(pretty(safePatch.intentQueue ?? []))
    if ('schedule' in safePatch) setScheduleJson(pretty(safePatch.schedule ?? []))
    if ('scheduleOverrides' in safePatch) setScheduleOverrideJson(pretty(safePatch.scheduleOverrides ?? []))
    if ('customPersonalityTraits' in safePatch) setTraitJson(pretty(safePatch.customPersonalityTraits ?? []))
    if (suggestion.experiencePatches?.length) {
      const patches = new Map(suggestion.experiencePatches.map((row) => [row.id, row]))
      const rows = parseArray<ContactExperience>('经历', experienceJson).map((row) => ({ ...row, ...(patches.get(row.id) ?? {}), id: row.id }))
      setExperienceJson(pretty(rows))
    }
    setSuggestion(null)
    setStatus('AI 方案已载入编辑区，尚未保存到后台。')
  }

  if (!settings.adminModeEnabled) return <div className="flex h-[var(--app-height)] flex-col overflow-hidden bg-[#f4f4f6]"><TopBar title="管理员编辑" showBack /><p className="p-8 text-center text-sm text-gray-400">请先开启管理员模式</p></div>
  if (!contact || !draft) return null

  return <div className="flex h-[var(--app-height)] flex-col overflow-hidden bg-[#f4f4f6]">
    <TopBar title="编辑全部资料" showBack />
    <div className="flex-1 overflow-y-auto pb-28">
      <section className="mt-3 bg-white px-4 py-4"><h2 className="text-sm font-medium text-gray-900">AI 协助二次编辑</h2><p className="mt-1 text-[11px] text-gray-400">AI 只生成差异方案；载入后仍需你点击底部保存。</p><Area label="你希望怎么修改" value={aiInstruction} onChange={setAiInstruction} rows={3} /><button type="button" onClick={() => void askAi()} disabled={aiBusy || !aiInstruction.trim()} className="mt-2 w-full rounded-lg bg-[var(--ui-special)] py-2.5 text-sm text-white disabled:opacity-40">{aiBusy ? '正在整理修改方案…' : '生成修改方案'}</button>{suggestion && <div className="mt-3 rounded-xl border border-[var(--ui-special-border)] bg-[var(--ui-special-soft)] p-3"><p className="text-sm font-medium text-[var(--ui-special-ink)]">{suggestion.summary}</p><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[10px] text-gray-600">{pretty(suggestion)}</pre><div className="mt-2 flex gap-2"><button onClick={() => setSuggestion(null)} className="flex-1 rounded-lg bg-white py-2 text-xs text-gray-600">放弃</button><button onClick={applySuggestion} className="flex-1 rounded-lg bg-gray-900 py-2 text-xs text-white">载入编辑区</button></div></div>}</section>

      <section className="mt-3 space-y-3 bg-white px-4 py-4"><h2 className="text-sm font-medium text-gray-900">身份与人设</h2><div className="grid grid-cols-2 gap-3"><Field label="显示名称" value={draft.name} onChange={(value) => patchDraft({ name: value })} /><Field label="备注" value={draft.remark ?? ''} onChange={(value) => patchDraft({ remark: value })} /><Field label="真名" value={draft.realName ?? ''} onChange={(value) => patchDraft({ realName: value })} /><Field label="网名/昵称" value={draft.nickname ?? ''} onChange={(value) => patchDraft({ nickname: value })} /><Field label="性别" value={draft.gender ?? ''} onChange={(value) => patchDraft({ gender: value })} /><Field label="生日" value={draft.birthday ?? ''} onChange={(value) => patchDraft({ birthday: value })} /><Field label="MBTI" value={draft.mbti ?? ''} onChange={(value) => patchDraft({ mbti: value })} /><Field label="性格特质" value={draft.personalityTrait ?? ''} onChange={(value) => patchDraft({ personalityTrait: value })} /></div><Area label="核心人设" value={draft.systemPrompt} onChange={(value) => patchDraft({ systemPrompt: value })} rows={10} /><Area label="标准长相" value={draft.visualIdentity ?? ''} onChange={(value) => patchDraft({ visualIdentity: value })} rows={4} note="稳定外貌描述；不要包含临时服装、动作、背景或画风。" /><button type="button" disabled={aiBusy || !settings.apiKey} onClick={async()=>{if(draft.visualIdentity && !window.confirm('重新生成会覆盖当前标准长相，确定继续？'))return;setAiBusy(true);try{const value=await regenerateContactVisualIdentity(draft,settings);patchDraft({visualIdentity:value});setStatus('已生成新的标准长相，请保存全部修改。')}catch(error){setStatus(error instanceof Error?error.message:String(error))}finally{setAiBusy(false)}}} className="w-full rounded-lg bg-gray-100 py-2 text-xs text-gray-600 disabled:opacity-40">AI重新生成外貌描述</button><Area label="用户硬约束" value={draft.personaConstraints ?? ''} onChange={(value) => patchDraft({ personaConstraints: value })} /><Area label="与用户的共同过往" value={draft.sharedHistory ?? ''} onChange={(value) => patchDraft({ sharedHistory: value })} /><Area label="结构化人设 JSON" value={profileJson} onChange={setProfileJson} rows={9} mono /><Area label="说话样例（每行一条）" value={(draft.speechSamples ?? []).join('\n')} onChange={(value) => patchDraft({ speechSamples: value.split('\n').map((line) => line.trim()).filter(Boolean) })} /></section>

      <section className="mt-3 space-y-3 bg-white px-4 py-4"><h2 className="text-sm font-medium text-gray-900">关系、状态与生活</h2><div className="grid grid-cols-2 gap-3"><Field label="关系定位" value={draft.relationshipBase} onChange={(value) => patchDraft({ relationshipBase: value })} /><Field label="好感度 -100~100" type="number" value={draft.warmth ?? 0} onChange={(value) => patchDraft({ warmth: Math.max(-100, Math.min(100, Number(value))) })} /><Field label="职业" value={draft.occupation ?? ''} onChange={(value) => patchDraft({ occupation: value })} /><Field label="月薪" type="number" value={draft.monthlySalary ?? 0} onChange={(value) => patchDraft({ monthlySalary: Number(value) })} /><Field label="当前位置ID" value={draft.currentLocationId ?? ''} onChange={(value) => patchDraft({ currentLocationId: value })} /><Field label="当前活动" value={draft.currentActivity ?? ''} onChange={(value) => patchDraft({ currentActivity: value })} /></div><Area label="关系动态" value={draft.relationshipDynamic} onChange={(value) => patchDraft({ relationshipDynamic: value })} /><Area label="当前心情 JSON" value={moodJson} onChange={setMoodJson} rows={4} mono /><Area label="AI 内部意图 JSON" value={intentJson} onChange={setIntentJson} rows={8} mono /><Area label="固定日程 JSON" value={scheduleJson} onChange={setScheduleJson} rows={10} mono /><Area label="特殊日程 JSON" value={scheduleOverrideJson} onChange={setScheduleOverrideJson} rows={8} mono /><Area label="自定义性格特质 JSON" value={traitJson} onChange={setTraitJson} rows={8} mono /><Area label="世界书条目ID（每行一个）" value={(draft.worldbookEntryIds ?? []).join('\n')} onChange={(value) => patchDraft({ worldbookEntryIds: value.split('\n').map((line) => line.trim()).filter(Boolean) })} /></section>

      <section className="mt-3 bg-white px-4 py-4"><h2 className="text-sm font-medium text-gray-900">提示词预设</h2><p className="mt-1 text-[11px] text-gray-400">联系人按名字引用预设；改预设内容请去"全局提示词模块"页，所有引用同一预设的联系人会一起生效。</p><select value={draft.presetName ?? FACTORY_PRESET_NAME} onChange={(event) => patchDraft({ presetName: event.target.value === FACTORY_PRESET_NAME ? undefined : event.target.value })} className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">{(presets ?? []).map((preset) => <option key={preset.name} value={preset.name}>{preset.name}{preset.isFactory ? '（出厂）' : ''}</option>)}</select></section>



      <section className="mt-3 space-y-4 bg-white px-4 py-4"><h2 className="text-sm font-medium text-gray-900">真实后台数据</h2><p className="text-[11px] leading-relaxed text-amber-600">以下内容直接对应数据库。多人共享经历和双向关系的修改会影响其他参与角色；删除数组项也会同步删除或解除关联。</p><Area label="AI 结构化记忆" value={memoryJson} onChange={setMemoryJson} rows={12} mono /><Area label="AI 之间的关系" value={relationJson} onChange={setRelationJson} rows={12} mono /><Area label="经历（含共享经历）" value={experienceJson} onChange={setExperienceJson} rows={14} mono /><Area label="最近社交动态" value={socialJson} onChange={setSocialJson} rows={12} mono /><Area label="生活状态" value={lifeJson} onChange={setLifeJson} rows={9} mono /><Area label="联系人钱包" value={walletJson} onChange={setWalletJson} rows={6} mono /><Area label="联系人相关交易" value={transactionJson} onChange={setTransactionJson} rows={12} mono /></section>
    </div>
    <div className="absolute inset-x-0 bottom-0 border-t border-gray-200 bg-white px-4 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))]"><button type="button" onClick={() => void saveAll()} className="w-full rounded-xl bg-gray-900 py-3 text-sm font-medium text-white">保存全部修改</button>{status && <p className={`mt-2 text-center text-xs ${status.startsWith('已') || status.includes('载入') ? 'text-green-600' : 'text-red-500'}`}>{status}</p>}</div>
  </div>
}
