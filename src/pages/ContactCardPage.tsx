import { useState } from 'react'
import { useLocalQuery } from '../lib/useLocalQuery'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { db } from '../db/unmigrated'
import { api } from '../lib/api/resources'
import { getOrUndef } from '../lib/api/client'
import { invalidate, invalidateAll } from '../lib/api/keys'
import { isAiTestId } from '../lib/aiTestIsolation'
import { TopBar } from '../components/TopBar'
import { UiIcon } from '../components/UiIcon'
import { Avatar } from '../components/Avatar'
import { AvatarPicker } from '../components/AvatarPicker'
import { ActionSheet } from '../components/ActionSheet'
import { SchedulePlanner } from '../components/SchedulePlanner'
import { displayName } from '../lib/contact'
import { activeUpcomingPlans, activeUpcomingPlansText, resetMemory } from '../lib/memory'
import { describeCurrentSchedule, describeUpcomingScheduleText, isPhoneAvailable } from '../lib/schedule'
import { normalizeMood } from '../lib/mood'
import { describeCurrentTime } from '../lib/time'
import { RELATIONSHIP_OPTIONS, formatSpeechSamplesForScene, buildRawChatPromptParts } from '../lib/prompt'
import { useModuleEnabled, isModuleEnabled } from '../features'
import { personalityIntimacyStage, warmthLabel, relationshipLine } from '../lib/relationship'
import { buildUserProfileText } from '../lib/chatEngine'
import { useSettingsStore } from '../store/useSettingsStore'
import type { Contact, ContactMemoryScope, ContactRelationLabel } from '../types'
import { CONTACT_RELATION_LABELS, PERSONALITY_TRAIT_OPTIONS } from '../types'
import { activeIntentPrompt, activeIntents, clearIntentQueue } from '../lib/intent'
import { removePairedContactRelation, setPairedContactRelation, uniqueRelationPairs } from '../lib/contactRelations'
import { chatCompletionText as chatCompletion } from '../lib/deepseek'
import { buildOccupationPrompt, parseOccupation, employmentPatch, OCCUPATION_OPTIONS } from '../lib/career'
import { formatCurrency } from '../lib/wallet'
import { setWalletBalance } from '../lib/finance'
import { switchContactWorldview } from '../lib/scopedSaves'
import { FACTORY_PRESET_NAME, resolveContactPromptModules } from '../lib/promptPresets'
import { contactSpeechVoice, isSpeechProviderReady, speechProviderName, speechVoiceOptions } from '../lib/speechProviders'
import { synthesizeSpeech } from '../lib/speechSynthesis'
import { ArrowUpFromLine, ClipboardList, Phone, PhoneOff } from 'lucide-react'

function LatestAiTurnJson({ contactId }: { contactId: string }) {
  const { data: latestTurn } = useQuery({
    queryKey: ['aiTurns', 'latest-by-contact', contactId],
    queryFn: async () => {
      const conv = (await api.conversations.list({ contactId }))[0]
      if (!conv) return null
      const turns = (await api.aiTurns.list({ conversationId: conv.id })).sort((a, b) => b.createdAt - a.createdAt)
      return turns[0] ?? null
    },
  })

  if (!latestTurn?.raw) return null
  const actionCommittee = latestTurn.parsed && typeof latestTurn.parsed === 'object'
    ? (latestTurn.parsed as Record<string, unknown>).actionCommittee
    : undefined
  return (
    <section className="mt-3 bg-white px-4 py-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-400"><ClipboardList size={14} />最新AI原始JSON</h3>
      <pre className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2.5 font-mono text-[10px] leading-relaxed text-gray-600">
        {latestTurn.raw}
      </pre>
      {actionCommittee !== undefined && <>
        <h4 className="mb-2 mt-3 text-xs font-medium text-gray-400">行动委员会</h4>
        <pre className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2.5 font-mono text-[10px] leading-relaxed text-gray-600">{JSON.stringify(actionCommittee, null, 2)}</pre>
      </>}
    </section>
  )
}

const MEMORY_SCOPE_LABELS: Record<ContactMemoryScope, string> = {
  private: '个人结构化记忆',
  group: '群聊记忆',
  interpersonal: '与其他人的记忆',
}

export function ContactCardPage() {
  const { contactId } = useParams()
  const navigate = useNavigate()
  const settings = useSettingsStore()
  const immersiveMode = settings.experienceMode === 'immersive'
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingRemark, setEditingRemark] = useState(false)
  const [remarkDraft, setRemarkDraft] = useState('')
  const [clearMemoryConfirm, setClearMemoryConfirm] = useState(false)
  const [pickingAvatar, setPickingAvatar] = useState(false)
  const [pickingRelationshipType, setPickingRelationshipType] = useState(false)
  const [pickingPersonalityTrait, setPickingPersonalityTrait] = useState(false)
  const relEnabled = useModuleEnabled('relationship')
  const personalityEnabled = useModuleEnabled('personalityTraits')
  const adminEnabled = useSettingsStore((s) => s.adminModeEnabled)
  const careerEnabled = useModuleEnabled('career')
  const lifeSimulationEnabled = useModuleEnabled('lifeSimulation')
  const [assigningCareer, setAssigningCareer] = useState(false)
  const [editingRelations, setEditingRelations] = useState(false)
  const [testingSpeechVoice, setTestingSpeechVoice] = useState(false)
  const [speechVoiceStatus, setSpeechVoiceStatus] = useState('')
  const [relationDrafts, setRelationDrafts] = useState<Array<{ targetContactId: string; label: string }>>([])

  const { data: contactData, isPending: contactPending } = useQuery({
    queryKey: ['contacts', contactId],
    queryFn: () => getOrUndef(api.contacts.get(contactId!)),
    enabled: !!contactId,
  })
  const contact = contactPending ? undefined : (contactData ?? null)
  const { data: currentLocation } = useQuery({
    queryKey: ['locations', contact?.currentLocationId],
    queryFn: () => getOrUndef(api.locations.get(contact!.currentLocationId!)),
    enabled: !!contact?.currentLocationId,
  })
  const { data: allContactsRaw = [] } = useQuery({ queryKey: ['contacts'], queryFn: () => api.contacts.list() })
  const allContacts = allContactsRaw.filter((item) => !isAiTestId(item.id))
  const { data: worldviews = [] } = useQuery({ queryKey: ['worldbookCollections'], queryFn: () => api.worldbookCollections.list() })
  const { data: promptPresets = [] } = useQuery({ queryKey: ['presets'], queryFn: () => api.presets.list() })
  const { data: conversation } = useQuery({
    queryKey: ['conversations', 'by-contact', contactId],
    queryFn: async () => (await api.conversations.list({ contactId: contactId! }))[0],
    enabled: !!contactId,
  })

  async function patchContact(patch: Partial<Contact>) {
    await api.contacts.patch(contactId!, patch)
    invalidate('contacts')
  }

  async function changeWorldview(nextWorldviewId: string) {
    if (!contact || nextWorldviewId === contact.worldviewId) return
    const affected = (await api.groups.list()).filter((group) => group.memberContactIds.includes(contact.id) && (group.worldviewId || settings.defaultWorldviewId) !== nextWorldviewId)
    const nextName = worldviews.find((world) => world.id === nextWorldviewId)?.name || '新世界'
    if (affected.length && !window.confirm(`切换到“${nextName}”后，${displayName(contact)}会被移出 ${affected.length} 个不同世界的群聊；群里只剩一人时会自动解散。继续吗？`)) return
    if (!window.confirm(`切换到“${nextName}”会先自动保存当前剧情线，然后开启一条不继承聊天记录和角色记忆的新剧情线。确定继续吗？`)) return
    await switchContactWorldview(contact, nextWorldviewId, nextName)
    for (const group of affected) {
      const remaining = group.memberContactIds.filter((id) => id !== contact.id)
      if (remaining.length <= 1) {
        const conv = (await api.conversations.list({ groupId: group.id }))[0]
        if (conv) {
          const convMessages = await api.messages.list({ conversationId: conv.id })
          if (convMessages.length) await api.messages.bulkDelete(convMessages.map((message) => message.id))
          const convAssets = await api.mediaAssets.list({ conversationId: conv.id })
          if (convAssets.length) await api.mediaAssets.bulkDelete(convAssets.map((asset) => asset.id))
          await api.conversations.delete(conv.id)
        }
        await api.groups.delete(group.id)
      } else await api.groups.patch(group.id, { memberContactIds: remaining })
    }
    invalidate('groups', 'conversations', 'messages', 'mediaAssets')
  }
  const contactWallet = useLocalQuery(() => contactId ? db.walletAccounts.get(contactId) : undefined, [contactId])
  const { data: momentCount = 0 } = useQuery({
    queryKey: ['moments', 'by-contact', contactId],
    queryFn: async () => (await api.moments.list({ contactId: contactId! })).length,
    enabled: !!contactId,
  })
  const { data: lifeEvents = [] } = useQuery({
    queryKey: ['lifeEvents', contactId],
    queryFn: () => api.lifeEvents.list({ contactId: contactId! }),
    enabled: !!contactId,
  })
  const { data: experiences = [] } = useQuery({
    queryKey: ['contactExperiences', 'by-contact', contactId],
    queryFn: () => api.contactExperiences.list({ contactIds_contains: contactId! }),
    enabled: !!contactId,
  })
  const { data: lifeState } = useQuery({
    queryKey: ['contactLifeStates', contactId],
    queryFn: () => getOrUndef(api.contactLifeStates.get(contactId!)),
    enabled: !!contactId,
  })
  const { data: socialTimeline = [] } = useQuery({
    queryKey: ['socialEvents', 'timeline', contactId],
    queryFn: async () => (await api.socialEvents.list({ limit: 80 }))
      .filter((event) => event.relatedContactIds.includes(contactId!) || event.actorId === contactId || event.targetId === contactId)
      .slice(0, 6),
    enabled: !!contactId,
  })
  const { data: structuredMemories = [] } = useQuery({
    queryKey: ['contactMemories', contactId],
    queryFn: async () => (await api.contactMemories.list({ contactId: contactId! })).sort((a, b) => b.updatedAt - a.updatedAt),
    enabled: !!contactId,
  })
  const { data: relationLinks = [] } = useQuery({
    queryKey: ['contactRelations', 'by-contact', contactId],
    queryFn: async () => {
      if (!contactId) return []
      const links = (await api.contactRelations.list())
        .filter((link) => link.fromContactId === contactId || link.toContactId === contactId)
      const contacts = await api.contacts.list()
      const contactById = new Map(contacts.map((c) => [c.id, c]))
      return uniqueRelationPairs(links)
        .map((link) => {
          const otherId = link.fromContactId === contactId ? link.toContactId : link.fromContactId
          const other = contactById.get(otherId)
          return other ? { id: link.id, targetContactId: otherId, name: displayName(other), label: link.label } : null
        })
        .filter((item): item is { id: string; targetContactId: string; name: string; label: ContactRelationLabel } => !!item)
    },
    enabled: !!contactId,
  })
  const structuredMemoryGroups = structuredMemories.reduce(
    (acc, memory) => {
      const scope = memory.scope ?? 'private'
      acc[scope].push(memory)
      return acc
    },
    { private: [], group: [], interpersonal: [] } as Record<ContactMemoryScope, typeof structuredMemories>,
  )
  async function assignCareer() {
    if (!contact || !settings.apiKey) return
    const value = window.prompt(`输入职业（例如：${OCCUPATION_OPTIONS.slice(0,6).join('、')}）`, contact.occupation ?? '')?.trim()
    if (!value) return
    setAssigningCareer(true)
    try {
      const careerPrompt = buildOccupationPrompt(value, contact.systemPrompt, settings)
      if (!careerPrompt.trim()) throw new Error('职业提示词模块已屏蔽')
      const raw = await chatCompletion({ apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.utilityModel, messages: [{ role: 'system', content: careerPrompt }, { role: 'user', content: '生成职业资料' }], jsonMode: true, purpose: 'persona' })
      const parsed = parseOccupation(raw)
      if (!parsed) throw new Error('职业资料生成失败')
      await patchContact({ ...employmentPatch(value, parsed.monthlySalary), ...(parsed.schedule ? { schedule: parsed.schedule } : {}) })
    } finally { setAssigningCareer(false) }
  }
  const { data: stickers = [] } = useQuery({ queryKey: ['stickers'], queryFn: () => api.stickers.list() })
  const { data: contactPromptModules } = useQuery({
    queryKey: ['contactPromptModules', contact?.id ?? '', contact?.presetName ?? ''],
    enabled: adminEnabled && !!contact,
    queryFn: () => resolveContactPromptModules(contact!, settings),
  })
  if (contact === undefined) return null
  if (contact === null || !contactId) {
    return (
      <div className="flex h-[var(--app-height)] flex-col overflow-hidden bg-[#f4f4f6]">
        <TopBar title="联系人" showBack />
        <p className="px-4 py-10 text-center text-sm text-gray-400">该联系人已被删除</p>
      </div>
    )
  }

  async function handleChat() {
    let conv = conversation
    if (!conv) {
      const now = Date.now()
      conv = { id: uuid(), contactId: contactId!, pinned: false, createdAt: now, updatedAt: now }
      await api.conversations.put(conv)
      invalidate('conversations')
    }
    void navigate(`/chat/${conv.id}`)
  }

  const activeSpeechProvider = settings.speechProvider
  const activeSpeechVoice = contactSpeechVoice(contact, activeSpeechProvider)
  const activeSpeechOptions = speechVoiceOptions(settings)

  async function saveSpeechVoice(voiceId: string) {
    if (!contact || activeSpeechProvider === 'none') return
    const previous = contact.speechVoices?.[activeSpeechProvider]
    await patchContact({
      speechVoices: {
        ...contact.speechVoices,
        [activeSpeechProvider]: {
          voiceId,
          styleInstruction: previous?.styleInstruction,
          source: 'user',
          assignedAt: Date.now(),
        },
      },
    })
    setSpeechVoiceStatus('已保存，这位联系人之后会使用该音色')
  }

  async function saveSpeechStyle(styleInstruction: string) {
    if (!contact || activeSpeechProvider === 'none' || !activeSpeechVoice) return
    await patchContact({
      speechVoices: {
        ...contact.speechVoices,
        [activeSpeechProvider]: { ...activeSpeechVoice, styleInstruction: styleInstruction.trim(), source: 'user', assignedAt: Date.now() },
      },
    })
    setSpeechVoiceStatus('声音演绎方式已保存')
  }

  async function testSpeechVoice() {
    if (!contact || !activeSpeechVoice) return
    setTestingSpeechVoice(true)
    setSpeechVoiceStatus('正在生成试听…')
    try {
      const result = await synthesizeSpeech(`你好，我是${displayName(contact)}。`, settings, activeSpeechVoice)
      const url = URL.createObjectURL(result.blob)
      const audio = new Audio(url)
      audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true })
      await audio.play()
      setSpeechVoiceStatus('试听生成成功')
    } catch (error) {
      setSpeechVoiceStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setTestingSpeechVoice(false)
    }
  }

  async function handleDelete() {
    await api.batch.deleteContact(contactId!)
    invalidateAll()
    void navigate('/contacts', { replace: true })
  }

  function openRelationEditor() {
    setRelationDrafts(relationLinks.map((link) => ({ targetContactId: link.targetContactId, label: link.label })))
    setEditingRelations(true)
  }

  async function saveRelationEditor() {
    if (!contactId) return
    const drafts = relationDrafts
      .map((draft) => ({ targetContactId: draft.targetContactId, label: draft.label.trim() }))
      .filter((draft, index, all) => draft.targetContactId && draft.label && all.findIndex((item) => item.targetContactId === draft.targetContactId) === index)
    const oldLinks = (await api.contactRelations.list()).filter((link) => link.fromContactId === contactId || link.toContactId === contactId)
    const oldTargetIds = new Set(oldLinks.map((link) => link.fromContactId === contactId ? link.toContactId : link.fromContactId))
    for (const targetId of oldTargetIds) await removePairedContactRelation(contactId, targetId)
    for (const draft of drafts) await setPairedContactRelation(contactId, draft.targetContactId, draft.label as ContactRelationLabel)
    setEditingRelations(false)
  }

  async function saveRemark() {
    await patchContact({ remark: remarkDraft.trim() })
    setEditingRemark(false)
  }

  const contactNow = Date.now()
  const activePlans = activeUpcomingPlans(contact.upcomingPlans ?? [], new Date(contactNow))
  const visibleActiveIntents = activeIntents(contact, contactNow, 10)
  const usedIntents = (contact.intentQueue ?? [])
    .filter((intent) => intent.status === 'used')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5)
  const hasMemory = contact.memoryFacts || contact.memoryStyle || activePlans.length > 0 || structuredMemories.length > 0 || relationLinks.length > 0

  // Admin-mode-only: shows exactly what would be sent as the system prompt
  // right now, for debugging persona/relationship issues. Mirrors
  // chatEngine.ts's runAiTurn data-gathering, but must NOT replicate its
  // pendingEvents-clearing side effect — this is a read-only preview, not
  // an actual turn, so pendingEvents here is read straight off the live
  // contact instead of going through the "read once then clear" flow.
  const now = new Date(contactNow)
  const pendingEvents = contact.pendingEvents ?? []
  const previewActiveIntents = isModuleEnabled('intent') ? activeIntents(contact, now.getTime()) : []
  // ---- admin-mode prompt preview (two-step pipeline) ----
  const mainModelPromptParts = adminEnabled
    ? buildRawChatPromptParts({
        name: contact.name,
        persona: contact.systemPrompt,
        personaConstraints: contact.personaConstraints,
        personaProfile: contact.personaProfile,
        stylePrompt: settings.globalSystemPrompt,
        promptModules: contactPromptModules ?? settings.promptModules,
        personalityTrait: personalityEnabled ? contact.personalityTrait : undefined,
        personalityWarmth: relEnabled ? (contact.warmth ?? 0) : undefined,
        worldviewText: isModuleEnabled('worldview') ? '【运行时按当前对话检索世界书条目；此预览不固定命中结果】' : undefined,
        latestUserText: '【预览】这里会放入用户本轮最新消息',
        recentContext: '',
        relationshipContext: `【你和对方的关系】${relationshipLine(
            relEnabled ? (contact.relationshipBase || '朋友') : '朋友',
            relEnabled ? (contact.relationshipDynamic || '') : '',
            relEnabled ? (contact.warmth ?? 0) : 0,
          )}`,
        memoryContext: [
          `【你对TA的了解】${contact.memoryFacts || '（刚开始聊）'}`,
          `【相处习惯】${contact.memoryStyle || '（还没有形成习惯）'}`,
        ].join('\n\n'),
        situationContext:
          `【当前情境】现在: ${describeCurrentTime(now)}。对方: ${buildUserProfileText(settings)}。${contact.mood?.text ? `你的心情: ${contact.mood.text}。` : ''}【日程】${describeCurrentSchedule(contact, now) ? `\n当前: ${describeCurrentSchedule(contact, now)}` : '\n当前: 暂无安排'}${describeUpcomingScheduleText(contact, now) ? `\n接下来:\n${describeUpcomingScheduleText(contact, now)}` : '\n接下来: 暂无安排'}${activeUpcomingPlansText(contact, now) ? `\n约定: ${activeUpcomingPlansText(contact, now)}` : ''}${pendingEvents.length > 0 ? `\n最近: ${pendingEvents.join('；')}` : ''}`,
        activeIntentText: activeIntentPrompt(previewActiveIntents),
        stickerNames: stickers.map((s) => s.name),
        mbti: contact.mbti || undefined,
        speechSamplesText: formatSpeechSamplesForScene(contact.speechSamples, 'private', 3) || undefined,
        sharedHistory: contact.sharedHistory,
      })
    : null

  return (
    <div className="relative flex h-[var(--app-height)] flex-col overflow-hidden bg-[#f4f4f6]">
      <TopBar title="联系人名片" showBack />
      <div className="flex-1 overflow-y-auto">

      <section className="mt-3 flex flex-col items-center gap-1 bg-white px-4 py-8">
        <button onClick={() => setPickingAvatar(true)}>
          <Avatar avatar={contact.avatar} color={contact.avatarColor} size={80} />
        </button>
        <h2 className="ui-font-display mt-1 text-lg font-medium text-gray-900">{displayName(contact)}</h2>
        {contact.remark && <p className="text-xs text-gray-400">本名 {contact.name}</p>}
        {contact.avatarPhotographer && (
          <p className="text-[11px] text-gray-300">
            头像照片来自 Pexels ·{' '}
            {contact.avatarPhotographerUrl ? (
              <a href={contact.avatarPhotographerUrl} target="_blank" rel="noreferrer" className="underline">
                {contact.avatarPhotographer}
              </a>
            ) : (
              contact.avatarPhotographer
            )}
          </p>
        )}
      </section>

      {!immersiveMode && <section className="mt-3 bg-white px-4 py-4"><h3 className="mb-2 text-xs font-medium text-gray-400">所属世界</h3><select value={contact.worldviewId || settings.defaultWorldviewId || ''} onChange={(event) => void changeWorldview(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">{worldviews.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}</select><p className="mt-2 text-[11px] leading-relaxed text-gray-400">修改后会移出不同世界的群聊；群里只剩一人时自动解散。</p></section>}

      {!immersiveMode && <section className="mt-3 bg-white px-4 py-4"><h3 className="mb-2 text-xs font-medium text-gray-400">提示词预设</h3><select value={contact.presetName ?? FACTORY_PRESET_NAME} onChange={(event) => void patchContact({ presetName: event.target.value === FACTORY_PRESET_NAME ? undefined : event.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">{promptPresets.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}{preset.isFactory ? '（出厂）' : ''}</option>)}</select><p className="mt-2 text-[11px] leading-relaxed text-gray-400">按名引用服务器预设；在"全局提示词模块"里改预设内容时，所有引用它的联系人一起生效。</p></section>}

      <section className="mt-3 bg-white px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="text-xs font-medium text-gray-400">联系人语音</h3><p className="mt-1 text-[11px] leading-relaxed text-gray-400">音色只属于这位联系人，不会套用到其他人。</p></div>
          <span className="shrink-0 text-xs text-gray-500">{speechProviderName(activeSpeechProvider)}</span>
        </div>
        {activeSpeechProvider === 'none' || !isSpeechProviderReady(settings) ? (
          <button type="button" onClick={() => navigate('/settings/speech-generation')} className="mt-3 w-full rounded-lg border border-dashed border-gray-300 px-3 py-3 text-sm text-gray-600">先配置语音生成服务</button>
        ) : (
          <div className="mt-3 space-y-3">
            {!activeSpeechVoice && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">暂时没有对号入座。请选择一个音色，否则聊天里生成语音时会提醒回来设置。</p>}
            <label className="block text-xs text-gray-500">音色
              <select value={activeSpeechVoice?.voiceId ?? ''} onChange={(event) => void saveSpeechVoice(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800">
                <option value="" disabled>请选择适合这位联系人的音色</option>
                {activeSpeechOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </label>
            {activeSpeechProvider === 'mimo' && activeSpeechVoice && <label className="block text-xs text-gray-500">声音演绎方式
              <textarea defaultValue={activeSpeechVoice.styleInstruction ?? ''} onBlur={(event) => void saveSpeechStyle(event.target.value)} placeholder="例如：低沉克制、语速稍慢，熟悉后更温柔" rows={2} className="mt-1 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none" />
            </label>}
            {activeSpeechVoice && <button type="button" disabled={testingSpeechVoice} onClick={() => void testSpeechVoice()} className="w-full rounded-lg bg-gray-900 py-2.5 text-sm text-white disabled:opacity-50">{testingSpeechVoice ? '生成试听中…' : '试听这位联系人的声音'}</button>}
            {speechVoiceStatus && <p className="text-xs leading-5 text-gray-500">{speechVoiceStatus}</p>}
          </div>
        )}
      </section>

      {lifeSimulationEnabled && (
        <section className="mt-3 bg-white px-4 py-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-400">
            <UiIcon name="🌙" size={14} />
            生活回顾
          </h3>
          {lifeState && <p className="mb-2 text-xs text-gray-500">此刻：{lifeState.location} · {lifeState.activity} · 精力 {lifeState.energy}</p>}
          {lifeEvents.filter((event) => event.visibility !== 'private').length === 0 ? (
            <p className="text-sm text-gray-400">最近没有适合分享的生活动态</p>
          ) : (
            <div className="space-y-2">
              {lifeEvents.filter((event) => event.visibility !== 'private').slice(0, 10).map((event) => (
                <div key={event.id} className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-sm text-gray-700">{event.summary}</p>
                  <p className="mt-0.5 text-[10px] text-gray-400">{new Date(event.occurredAt).toLocaleString()} · {event.type === 'summary' ? '阶段回顾' : '生活事件'}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {!immersiveMode && experiences.length > 0 && <section className="mt-3 bg-[var(--ui-surface)] px-4 py-4 shadow-[var(--ui-shadow)]">
        <h3 className="mb-2 text-xs font-medium text-[var(--ui-text-3)]">经历</h3>
        <div className="space-y-2">{[...experiences].sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt)).slice(0, 12).map((experience) => <div key={experience.id} className="rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-2)] px-3 py-2">
          <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-[var(--ui-text)]">{experience.title}</p><span className="shrink-0 text-[10px] text-[var(--ui-text-3)]">{experience.kind === 'past' ? '过去' : experience.memoryTier === 'long' ? '长期记忆' : '短期记忆'}</span></div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--ui-text-2)]">{experience.summary}</p>
          <p className="mt-1 text-[10px] text-[var(--ui-text-3)]">{experience.periodLabel || (experience.startedAt ? new Date(experience.startedAt).toLocaleString() : '')}{experience.location ? ` · ${experience.location}` : ''}</p>
        </div>)}</div>
      </section>}

      <div className="mt-3 bg-white">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-gray-100 px-4 py-3 text-xs text-gray-500"><p>性别：{contact.gender || contact.creatorProfile?.gender || '未填写'}</p><p>真名：{contact.realName || contact.name}</p><p>网名：{contact.nickname || contact.name}</p><p>生日：{contact.birthday || '未填写'}</p></div>
        <button
          onClick={() => {
            setRemarkDraft(contact.remark ?? '')
            setEditingRemark(true)
          }}
          className="flex w-full items-center justify-between border-b border-gray-100 px-4 py-3.5 text-left active:bg-gray-50"
        >
          <span className="text-[15px] text-gray-900">备注</span>
          <span className="text-sm text-gray-400">{contact.remark || '未设置'}</span>
        </button>
        <button
          onClick={() => setPickingRelationshipType(true)}
          className="flex w-full items-center justify-between border-b border-gray-100 px-4 py-3.5 text-left active:bg-gray-50"
        >
          <span className="text-[15px] text-gray-900">关系定位</span>
          <span className="text-sm text-gray-400">{contact.relationshipBase || '未设置'}</span>
        </button>
        {!immersiveMode && personalityEnabled && (
          <button
            onClick={() => setPickingPersonalityTrait(true)}
            className="flex w-full items-center justify-between px-4 py-3.5 text-left active:bg-gray-50"
          >
            <span className="text-[15px] text-gray-900">性格特质</span>
            <span className="text-right text-sm text-gray-400">{contact.personalityTrait || '无'}{contact.personalityTrait && contact.personalityTrait !== '无' && relEnabled ? ` · ${personalityIntimacyStage(contact.warmth ?? 0)}` : ''}</span>
          </button>
        )}
        <div className="flex w-full items-center justify-between px-4 py-3.5">
          <span className="text-[15px] text-gray-900">心情</span>
          <span className="text-sm text-gray-400">
            {contact.mood?.text && contactNow < contact.mood.expiresAt ? normalizeMood(contact.mood.text) : '暂无'}
          </span>
        </div>
        <div className="flex w-full items-center justify-between px-4 py-3.5">
          <span className="text-[15px] text-gray-900">状态</span>
          <span className="flex items-center gap-1.5 text-sm text-gray-400">
            {isPhoneAvailable(contact, new Date(contactNow)) ? <Phone size={14} /> : <PhoneOff size={14} />}{describeCurrentSchedule(contact, new Date(contactNow)).replace(/^现在在/, '') || '空闲'}
          </span>
        </div>
        {currentLocation && <div className="flex w-full items-center justify-between px-4 py-3.5"><span className="text-[15px] text-gray-900">当前位置</span><span className="text-sm text-gray-400">{currentLocation.name}</span></div>}
        {!immersiveMode && relEnabled && (
          <div className="flex w-full items-center justify-between px-4 py-3.5">
            <span className="text-[15px] text-gray-900">好感度</span>
            <span className="text-sm text-gray-400">
              {contact.warmth !== undefined
                ? `${contact.warmth}（${warmthLabel(contact.warmth)}）${contact.relationshipDynamic ? ` · ${contact.relationshipDynamic}` : ''}`
                : '未评估（下次聊天时自动评估）'}
            </span>
          </div>
        )}
        {careerEnabled && <button onClick={immersiveMode ? undefined : assignCareer} disabled={assigningCareer} className="flex w-full items-center justify-between px-4 py-3.5 text-left active:bg-gray-50 disabled:opacity-50"><span className="text-[15px] text-gray-900">职业</span><span className="text-sm text-gray-400">{immersiveMode ? contact.occupation || '暂时不了解' : assigningCareer?'生成中…':contact.occupation?`${contact.occupation} · 月薪 ${formatCurrency(contact.monthlySalary??0,settings)}`:'赋予职业'}</span></button>}
        {!immersiveMode && careerEnabled && <button onClick={adminEnabled ? async()=>{const raw=prompt('设定该AI的钱包余额',String(contactWallet?.balance??0));if(raw!==null&&Number.isFinite(Number(raw))&&Number(raw)>=0)await setWalletBalance(contact.id,Number(raw))}:undefined} className="flex w-full items-center justify-between px-4 py-3.5 text-left"><span className="text-[15px] text-gray-900">钱包</span><span className="text-sm text-gray-400">{formatCurrency(contactWallet?.balance??0,settings)}{adminEnabled?' · 点击设定':''}</span></button>}
      </div>

      {!immersiveMode && <section className="mt-3 bg-white px-4 py-4">
        <h3 className="mb-2 text-xs font-medium text-gray-400">最近社交动态</h3>
        {socialTimeline.length === 0 ? <p className="text-sm text-gray-400">暂时还没有公开互动。</p> : <div className="space-y-2">{socialTimeline.map((event) => <button key={event.id} type="button" onClick={() => event.groupId ? navigate(`/group/${event.groupId}`) : event.momentId ? navigate(`/moments?focus=${event.momentId}`) : event.conversationId ? navigate(`/chat/${event.conversationId}`) : undefined} className="block w-full border-l-2 border-[var(--ui-success)] pl-2 text-left"><p className="text-sm text-gray-700">{event.summary}</p><p className="mt-0.5 text-[10px] text-gray-400">{new Date(event.createdAt).toLocaleString()}</p></button>)}</div>}
      </section>}

      {!immersiveMode && <section className="mt-3 bg-white px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <div><h3 className="text-xs font-medium text-gray-400">AI之间的关系</h3><p className="mt-1 text-[11px] text-gray-400">关系会影响朋友圈点赞、评论和群聊互动，可随时自定义。</p></div>
          <button type="button" onClick={openRelationEditor} className="text-xs text-[var(--ui-special-ink)]">编辑关系</button>
        </div>
        {relationLinks.length === 0 ? <p className="text-sm text-gray-400">还没有设置与其他联系人的关系</p> : <div className="space-y-1.5">{relationLinks.map((link) => <div key={link.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm"><span>{link.name}</span><span className="text-xs text-gray-500">{link.label}</span></div>)}</div>}
      </section>}

      <section className="mt-3 bg-white px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-medium text-gray-400">AI记忆（随聊天自动积累）</h3>
          {hasMemory && (
            <button onClick={() => setClearMemoryConfirm(true)} className="text-xs text-gray-400 underline">
              清空记忆
            </button>
          )}
        </div>
        {hasMemory ? (
          <div className="space-y-2 text-sm leading-relaxed text-gray-600">
            <p>
              <span className="text-xs text-gray-400">了解到的信息 </span>
              {contact.memoryFacts || '暂无'}
            </p>
            <p>
              <span className="text-xs text-gray-400">相处状态 </span>
              {contact.memoryStyle || '暂无'}
            </p>
            {activePlans.length > 0 && (
              <div>
                <span className="text-xs text-gray-400">和你的约定 </span>
                <ul className="mt-1 space-y-0.5">
                  {activePlans.map((p) => (
                    <li key={p.id}>{p.date ? `[${p.date}] ${p.text}` : p.text}</li>
                  ))}
                </ul>
              </div>
            )}
            {relationLinks.length > 0 && (
              <div>
                <span className="text-xs text-gray-400">已知朋友关系 </span>
                <ul className="mt-1 space-y-0.5">
                  {relationLinks.map((link) => (
                    <li key={link.id}>{link.name} 是TA的{link.label}</li>
                  ))}
                </ul>
              </div>
            )}
            {(['private', 'group', 'interpersonal'] as ContactMemoryScope[]).map((scope) => {
              const memories = structuredMemoryGroups[scope].slice(0, 8)
              if (memories.length === 0) return null
              return (
                <div key={scope}>
                  <span className="text-xs text-gray-400">{MEMORY_SCOPE_LABELS[scope]} </span>
                  <ul className="mt-1 space-y-1">
                    {memories.map((memory) => (
                      <li key={memory.id} className="rounded-lg bg-gray-50 px-2.5 py-1.5">
                        <p>{memory.content}</p>
                        {memory.tags.length > 0 && (
                          <p className="mt-0.5 text-[11px] text-gray-400">
                            {memory.tags.slice(0, 4).map((tag) => `#${tag}`).join(' ')}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400">还没有形成记忆 多聊几句之后会自己记住一些关于你的事</p>
        )}
      </section>

      <SchedulePlanner contact={contact} settings={settings} memories={structuredMemories} />

      {adminEnabled && (
        <section className="mt-3 bg-white px-4 py-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-medium text-gray-400">AI 内部意图</h3>
            {(contact.intentQueue ?? []).length > 0 && (
              <button onClick={() => clearIntentQueue(contactId!)} className="text-xs text-gray-400 underline">
                清空内部意图
              </button>
            )}
          </div>

          <div className="space-y-3 text-sm text-gray-600">
            <div>
              <p className="mb-1 text-xs text-gray-400">Active</p>
              {visibleActiveIntents.length === 0 ? (
                <p className="text-gray-400">暂无</p>
              ) : (
                <ul className="space-y-1">
                  {visibleActiveIntents.map((intent) => (
                    <li key={intent.id} className="rounded-lg bg-gray-50 px-2.5 py-2">
                      <p>{intent.text}</p>
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {intent.kind} / {intent.confidence} / {new Date(intent.createdAt).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-1 text-xs text-gray-400">Used 最近 5 条</p>
              {usedIntents.length === 0 ? (
                <p className="text-gray-400">暂无</p>
              ) : (
                <ul className="space-y-1">
                  {usedIntents.map((intent) => (
                    <li key={intent.id} className="rounded-lg bg-gray-50 px-2.5 py-2">
                      <p>{intent.text}</p>
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {intent.kind} / {intent.confidence} / {new Date(intent.createdAt).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {adminEnabled && (
        <LatestAiTurnJson contactId={contactId!} />
      )}

      {adminEnabled && (
        <section className="mt-3 bg-white px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-xs font-medium text-gray-400">提示词预览（管理员模式）</h3><p className="mt-1 text-[10px] text-gray-400">来源：{contact.presetName || '出厂默认'}（按名引用服务器预设）</p></div><button type="button" onClick={() => navigate(`/contact/${contactId}/admin`)} className="shrink-0 rounded-lg bg-gray-900 px-3 py-2 text-xs text-white">编辑全部资料</button></div>

          <div className="space-y-4">
            {/* Step 1: main model */}
            <div className="rounded-lg border-2 border-gray-800">
              <div className="border-b border-gray-200 bg-gray-100 px-3 py-1.5">
                <span className="flex items-center gap-1.5 text-xs font-bold text-gray-800"><ArrowUpFromLine size={14} />{`发给主模型（${settings.model}）`}</span>
                <span className="ml-2 text-[10px] text-gray-400">生成自然语言回复 + 括号想法</span>
              </div>
              <div className="p-3">
                <div className="space-y-3">
                  <div className="rounded-lg border border-gray-200 bg-white">
                    <div className="border-b border-gray-100 px-3 py-2">
                      <p className="text-xs font-bold text-gray-900">逻辑</p>
                      <p className="mt-0.5 text-[10px] text-gray-400">身份、记忆、地点、日程、心情、关系等硬前提，优先级最高</p>
                    </div>
                    <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-gray-700">
                      {mainModelPromptParts?.logic}
                    </pre>
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-gray-50">
                    <div className="border-b border-gray-100 px-3 py-2">
                      <p className="text-xs font-bold text-gray-700">感觉</p>
                      <p className="mt-0.5 text-[10px] text-gray-400">在逻辑正确后再优化文笔、节奏、情绪和聊天感</p>
                    </div>
                    <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-gray-600">
                      {mainModelPromptParts?.feeling}
                    </pre>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </section>
      )}

      <div className="mt-3 flex flex-col gap-2 bg-white px-4 py-4">
        <button onClick={handleChat} className="w-full rounded-lg bg-gray-900 py-2.5 text-sm text-white">
          发消息
        </button>
        <button onClick={() => navigate(`/moments?contact=${contactId}`)} className="w-full rounded-lg bg-gray-100 py-2.5 text-sm text-gray-700">
          TA的朋友圈（{momentCount}）
        </button>
        <button onClick={() => setMenuOpen(true)} className="w-full rounded-lg bg-gray-100 py-2.5 text-sm text-red-500">
          删除联系人
        </button>
      </div>
      </div>

      {menuOpen && (
        <ActionSheet
          onClose={() => setMenuOpen(false)}
          options={[{ label: '确认删除该联系人及聊天记录', onSelect: handleDelete, danger: true }]}
        />
      )}
      {editingRelations && (
        <div className="absolute inset-0 z-40 flex items-end bg-black/40" onClick={() => setEditingRelations(false)}>
          <div className="max-h-[86%] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><div><h3 className="text-base font-medium text-gray-900">编辑 AI 关系</h3><p className="mt-1 text-[11px] text-gray-400">自定义关系会同步写入双方，并立即影响朋友圈互动。</p></div><button type="button" onClick={() => setEditingRelations(false)} className="text-sm text-gray-500">关闭</button></div>
            <div className="space-y-2">
              {relationDrafts.map((draft, index) => (
                <div key={`${draft.targetContactId}-${index}`} className="flex items-center gap-2">
                  <select value={draft.targetContactId} onChange={(event) => setRelationDrafts((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, targetContactId: event.target.value } : row))} className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-2 text-xs">
                    <option value="">选择联系人</option>
                    {allContacts.filter((candidate) => candidate.id !== contactId).map((candidate) => <option key={candidate.id} value={candidate.id}>{displayName(candidate)}</option>)}
                  </select>
                  <input value={draft.label} onChange={(event) => setRelationDrafts((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, label: event.target.value } : row))} list={`relation-labels-${index}`} placeholder="自定义关系" className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-2 text-xs" />
                  <datalist id={`relation-labels-${index}`}>{CONTACT_RELATION_LABELS.map((label) => <option key={label} value={label} />)}</datalist>
                  <button type="button" onClick={() => setRelationDrafts((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} className="shrink-0 text-xs text-red-500">删除</button>
                </div>
              ))}
              <button type="button" onClick={() => { const candidate = allContacts.find((item) => item.id !== contactId && !relationDrafts.some((draft) => draft.targetContactId === item.id)); if (candidate) setRelationDrafts((rows) => [...rows, { targetContactId: candidate.id, label: CONTACT_RELATION_LABELS[0] }]) }} className="text-xs text-[var(--ui-special-ink)]">+ 添加关系</button>
            </div>
            <button type="button" onClick={() => void saveRelationEditor()} className="mt-4 w-full rounded-xl bg-gray-900 py-2.5 text-sm text-white">保存关系</button>
          </div>
        </div>
      )}

      {pickingRelationshipType && (
        <ActionSheet
          onClose={() => setPickingRelationshipType(false)}
          options={[...RELATIONSHIP_OPTIONS.map((label) => ({
            label,
            onSelect: () => { void patchContact({ relationshipBase: label }) },
          })), { label: '自定义…', onSelect: () => { const value = window.prompt('输入自定义关系定位', contact.relationshipBase || '')?.trim(); if (value) void patchContact({ relationshipBase: value }) } }]}
        />
      )}

      {pickingPersonalityTrait && (
        <ActionSheet
          onClose={() => setPickingPersonalityTrait(false)}
          options={[...PERSONALITY_TRAIT_OPTIONS.map((opt) => ({
            label: opt.value,
            onSelect: () => { void patchContact({ personalityTrait: opt.value }) },
          })), { label: '自定义…', onSelect: () => { const value = window.prompt('输入自定义性格特质', contact.personalityTrait || '')?.trim(); if (value) void patchContact({ personalityTrait: value }) } }]}
        />
      )}

      {clearMemoryConfirm && (
        <ActionSheet
          onClose={() => setClearMemoryConfirm(false)}
          options={[
            {
              label: '确认清空对方对你的记忆',
              onSelect: () => resetMemory(contactId!),
              danger: true,
            },
          ]}
        />
      )}

      {pickingAvatar && (
        <AvatarPicker
          onSelect={(avatar, photographer) =>
            void patchContact({
              avatar,
              avatarPhotographer: photographer?.name ?? null,
              avatarPhotographerUrl: photographer?.url ?? null,
            } as Partial<Contact>)
          }
          onClose={() => setPickingAvatar(false)}
          settings={settings}
          subject={contact}
        />
      )}

      {editingRemark && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-8">
          <div className="w-full rounded-2xl bg-white p-4">
            <h2 className="mb-3 text-center text-[15px] font-medium text-gray-900">设置备注</h2>
            <input
              value={remarkDraft}
              onChange={(e) => setRemarkDraft(e.target.value)}
              placeholder="给TA起个只有你看得到的称呼"
              maxLength={20}
              className="mb-4 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setEditingRemark(false)}
                className="flex-1 rounded-lg bg-gray-100 py-2 text-sm text-gray-600"
              >
                取消
              </button>
              <button onClick={saveRemark} className="flex-1 rounded-lg bg-gray-900 py-2 text-sm text-white">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
