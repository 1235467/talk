import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { FileSliders } from 'lucide-react'
import { ActionSheet } from '../components/ActionSheet'
import { ImageCropper } from '../components/ImageCropper'
import { useSettingsStore } from '../store/useSettingsStore'
import { listModels, testConnection } from '../lib/ai/connection'
import { api } from '../lib/api/resources'
import { getOrUndef } from '../lib/api/client'
import { uploadDataUrlIfNeeded } from '../lib/api/media'
import { invalidate, invalidateAll } from '../lib/api/keys'
import { assertTalkBackup, backupFileName, createBackup, mergeSettingsForRestore, restoreBackup } from '../lib/backup'
import { resumeMediaAssets } from '../lib/imageAssets'
import type { GenerationProfile } from '../types'
import { useQuery } from '@tanstack/react-query'
import { USER_WALLET_ID, setUserBalance } from '../lib/finance'
import { formatCurrency } from '../lib/wallet'
import { CHAT_PAGE_SIZE_OPTIONS, normalizeChatPageSize } from '../lib/chatPagination'
import { ModelPicker } from '../components/ModelPicker'
import { ToggleSwitch } from '../components/ToggleSwitch'
import { AI_PROVIDERS, AI_PROVIDER_OPTIONS, BASE_URL_EDITABLE, resolveChatCompletionsUrl, resolveModelsUrl, type AiProviderId } from '../lib/ai/providers'
import { cancelAllContactGenerationTasks, markPersistedContactGenerationTasksPaused } from '../lib/contactGenerationTasks'

export function SettingsPage() {
  const navigate = useNavigate()
  const {
    aiProvider,
    apiKey,
    apiKeys,
    baseUrl,
    baseUrls,
    model,
    utilityModel,
    serverUrl,
    serverToken,
    animationsEnabled,
    chatBackground,
    chatPageSize,
    currencyIconMode,
    customCurrencyEmoji,
    adminModeEnabled,
    experienceMode,
    topInsetAdjustmentPx,
    automaticAiDailyCap,
    generationByProvider,
    chatResponseTimeoutMs,
    setSettings,
  } = useSettingsStore()
  const [confirmingWipe, setConfirmingWipe] = useState(false)
  const [backupStatus, setBackupStatus] = useState('')
  const [restoringBackup, setRestoringBackup] = useState(false)
  const [backgroundCropSrc, setBackgroundCropSrc] = useState('')
  const { data: wallet } = useQuery({ queryKey: ['walletAccounts', USER_WALLET_ID], queryFn: () => getOrUndef(api.walletAccounts.get(USER_WALLET_ID)) })
  const { data: usageRecords = [] } = useQuery({ queryKey: ['aiUsageRecords'], queryFn: () => api.aiUsageRecords.list() })
  const usage = (() => {
    const now = Date.now(); const today = new Date(now).toDateString()
    const recent = usageRecords.filter((r) => now - r.createdAt <= 30 * 24 * 60 * 60 * 1000)
    return { today: usageRecords.filter((r) => new Date(r.createdAt).toDateString() === today), recent }
  })()
  const [adminBalance, setAdminBalance] = useState('')
  const [serverTestResult, setServerTestResult] = useState('')
  const backupInputRef = useRef<HTMLInputElement | null>(null)
  const backgroundInputRef = useRef<HTMLInputElement | null>(null)

  async function testServer() {
    setServerTestResult('测试中…')
    try {
      const base = serverUrl.trim().replace(/\/+$/, '')
      const response = await fetch(`${base}/health`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setServerTestResult('✓ 连接成功，正在同步服务器设置…')
      const { hydrateSettingsFromServer } = await import('../store/useSettingsStore')
      const applied = await hydrateSettingsFromServer()
      setServerTestResult(applied >= 0 ? `✓ 连接成功，已同步 ${applied} 项设置` : '✗ 连接成功但同步失败：检查访问令牌是否填对')
    } catch (error) {
      setServerTestResult(`✗ ${error instanceof Error ? error.message : '连接失败'}`)
    }
  }

  async function handleWipeContacts() {
    await cancelAllContactGenerationTasks()
    await api.batch.wipeData()
    invalidateAll()
    void navigate('/contacts')
  }

  async function handleExportBackup() {
    setBackupStatus('')
    const backup = await createBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = backupFileName()
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setBackupStatus('备份已导出（包含 API Key 等密钥，请妥善保管，不要发给别人）。')
  }

  async function handleImportBackup(file: File) {
    setBackupStatus('')
    setRestoringBackup(true)
    try {
      const parsed: unknown = JSON.parse(await file.text())
      assertTalkBackup(parsed)
      if (!window.confirm('导入备份会覆盖当前这台设备里的聊天、联系人、朋友圈、设置等本地数据。确定继续吗？')) {
        return
      }
      await cancelAllContactGenerationTasks()
      await restoreBackup(parsed)
      await markPersistedContactGenerationTasksPaused()
      const restoredSettings = mergeSettingsForRestore(parsed.settings, useSettingsStore.getState())
      setSettings(restoredSettings)
      useSettingsStore.setState(restoredSettings)
      await resumeMediaAssets()
      setBackupStatus('备份已恢复。建议返回消息页检查联系人和聊天记录。')
    } catch (err) {
      setBackupStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setRestoringBackup(false)
      if (backupInputRef.current) backupInputRef.current.value = ''
    }
  }

  async function handleBackgroundImage(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setBackgroundCropSrc(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const [apiKeyDraft, setApiKeyDraft] = useState(apiKey)
  const [providerDraft, setProviderDraft] = useState<AiProviderId>(aiProvider ?? 'deepseek')
  const [baseUrlDraft, setBaseUrlDraft] = useState(baseUrl)
  const [modelDraft, setModelDraft] = useState(model)
  const [utilityModelDraft, setUtilityModelDraft] = useState(utilityModel)
  const [visibleApiKeys, setVisibleApiKeys] = useState({ ai: false })
  const presetBackgrounds = ['#f4f4f6', '#f7f0e8', '#eef6f1', '#edf4ff', '#f5efff', '#fff3f0', '#f3f6e8', '#eef7f7']
  const currencyMode = currencyIconMode ?? 'coin'

  const [models, setModels] = useState<string[]>([])
  const [modelPicker, setModelPicker] = useState<'chat' | 'utility' | null>(null)
  const [pulling, setPulling] = useState(false)
  const [pullError, setPullError] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  let chatEndpointPreview = ''
  let modelsEndpointPreview: string | null = null
  let endpointPreviewError = ''
  try {
    chatEndpointPreview = resolveChatCompletionsUrl(baseUrlDraft, providerDraft)
    modelsEndpointPreview = resolveModelsUrl(baseUrlDraft, providerDraft)
  } catch (error) {
    endpointPreviewError = error instanceof Error ? error.message : String(error)
  }


  function persistConnection() {
    const trimmedUrl = baseUrlDraft.trim() || AI_PROVIDERS[providerDraft].defaultBaseUrl
    const trimmedKey = apiKeyDraft.trim()
    setSettings({
      aiProvider: providerDraft,
      apiKey: trimmedKey,
      apiKeys: { ...(apiKeys ?? {}), [providerDraft]: trimmedKey },
      baseUrl: trimmedUrl,
      baseUrls: { ...(baseUrls ?? {}), [providerDraft]: trimmedUrl },
      model: modelDraft.trim(),
      utilityModel: utilityModelDraft.trim(),
    })
  }

  const generationProfile = generationByProvider?.[providerDraft] ?? {}
  function patchGenerationProfile(patch: Partial<GenerationProfile>) {
    setSettings({ generationByProvider: { ...(generationByProvider ?? {}), [providerDraft]: { ...generationProfile, ...patch } } })
  }
  function parseOptionalNumber(raw: string): number | undefined {
    const value = Number(raw)
    return raw.trim() && Number.isFinite(value) && value > 0 ? value : undefined
  }

  async function handlePullModels() {
    setPulling(true)
    setPullError('')
    try {
      const list = await listModels(apiKeyDraft.trim(), baseUrlDraft.trim(), providerDraft)
      setModels(list)
      if (list.length > 0) {
        // Keep both saved choices valid when switching API providers. A
        // provider-specific stale id must not remain selected after refresh.
        if (!list.includes(modelDraft)) setModelDraft(list[0])
        if (!list.includes(utilityModelDraft)) setUtilityModelDraft(list[0])
      }
    } catch (err) {
      setPullError(err instanceof Error ? err.message : String(err))
    } finally {
      setPulling(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    const result = await testConnection(apiKeyDraft.trim(), baseUrlDraft.trim(), modelDraft.trim(), providerDraft)
    setTestResult(result)
    setTesting(false)
  }

  return (
    <div className="flex h-[var(--app-height)] flex-col overflow-hidden bg-[#f4f4f6]">
      <TopBar title="设置" showBack />
      <div className="flex-1 overflow-y-auto">

      <section className="mt-3 bg-white px-4 py-3">
        <h2 className="mb-2 text-xs font-medium text-gray-400">服务器</h2>
        <label className="mb-1 block text-xs text-gray-500">服务器地址</label>
        <input value={serverUrl} onChange={(e) => setSettings({ serverUrl: e.target.value.trim() })} placeholder="https://talk.example.com" className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm" />
        <label className="mb-1 block text-xs text-gray-500">访问令牌（服务器的 TALK_TOKEN）</label>
        <input type="password" value={serverToken} onChange={(e) => setSettings({ serverToken: e.target.value.trim() })} className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm" />
        <button type="button" onClick={() => void testServer()} className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white">测试连接</button>
        {serverTestResult && <p className={`mt-2 text-xs ${serverTestResult.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{serverTestResult}</p>}
      </section>

      <section className="mt-3 bg-white px-4 py-3">
        <h2 className="mb-2 text-xs font-medium text-gray-400">外观</h2>
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <div><p className="text-sm text-gray-800">顶部显示区域</p><p className="text-xs text-gray-400">自动避开系统安全区，并额外向下微调</p></div>
            <span className="text-xs text-gray-500">+{topInsetAdjustmentPx ?? 0}px</span>
          </div>
          <input aria-label="顶部显示区域微调" type="range" min="0" max="80" step="1" value={topInsetAdjustmentPx ?? 0} onChange={(e) => setSettings({ topInsetAdjustmentPx: Number(e.target.value) })} className="w-full accent-gray-900" />
          <button type="button" onClick={() => setSettings({ topInsetAdjustmentPx: 0 })} className="mt-1 text-xs text-gray-500">恢复默认</button>
        </div>
        <div className="mb-3 flex items-center justify-between border-t border-gray-100 pt-3">
          <div>
            <p className="text-sm text-gray-800">界面动效</p>
            <p className="mt-0.5 text-[11px] text-gray-400">切换、提示与消息出现的轻量动画</p>
          </div>
          <ToggleSwitch
            checked={animationsEnabled ?? true}
            onChange={(checked) => setSettings({ animationsEnabled: checked })}
            ariaLabel="切换界面动效"
            size="sm"
            activeTone="dark"
          />
        </div>

        <label className="mb-1 block text-xs text-gray-500">聊天背景色</label>
        <div className="mb-2 flex flex-wrap gap-2">
          {presetBackgrounds.map((color) => (
            <button
              key={color}
              onClick={() => setSettings({ chatBackground: color })}
              aria-label={`应用背景色 ${color}`}
              className={`h-8 w-8 rounded-full border ${
                chatBackground === color ? 'border-gray-900 ring-2 ring-gray-300' : 'border-gray-200'
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <div className="mb-2 flex gap-2">
          <input
            type="color"
            value={chatBackground && chatBackground.startsWith('#') ? chatBackground : '#ededed'}
            onChange={(e) => setSettings({ chatBackground: e.target.value })}
            className="h-10 w-14 rounded-lg border border-gray-200 p-1"
          />
          <button
            onClick={() => backgroundInputRef.current?.click()}
            className="flex-1 rounded-lg bg-gray-100 py-2 text-sm text-gray-700"
          >
            上传背景图
          </button>
          <button
            onClick={() => setSettings({ chatBackground: '' })}
            className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700"
          >
            默认
          </button>
        </div>
        <input
          ref={backgroundInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleBackgroundImage(file)
            if (backgroundInputRef.current) backgroundInputRef.current.value = ''
          }}
        />
        <p className="text-[11px] text-gray-400">背景只保存在本机，导出备份时会一起带走。</p>
      </section>
      <section className="mt-3 bg-white px-4 py-3">
        <h2 className="mb-2 text-xs font-medium text-gray-400">聊天</h2>
        <label className="mb-1 block text-sm text-gray-800" htmlFor="chat-page-size">每次加载消息条数</label>
        <p className="mb-2 text-[11px] leading-relaxed text-gray-400">打开聊天时先加载这么多条；滚动到顶部后，每次继续加载相同数量。默认 40 条。</p>
        <div className="flex items-center gap-2">
          <select
            id="chat-page-size"
            aria-label="每次加载消息条数"
            value={normalizeChatPageSize(chatPageSize)}
            onChange={(event) => setSettings({ chatPageSize: Number(event.target.value) })}
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            {CHAT_PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} 条</option>)}
          </select>
          <button type="button" onClick={() => setSettings({ chatPageSize: 40 })} className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600">恢复默认</button>
        </div>
      </section>
      {adminModeEnabled && <section className="mt-3 bg-white px-4 py-3"><h2 className="text-sm font-medium text-gray-900">设定我的余额</h2><p className="mt-1 text-xs text-gray-400">当前 {formatCurrency(wallet?.balance ?? 0, useSettingsStore.getState())}</p><div className="mt-2 flex gap-2"><input type="number" min="0" value={adminBalance} onChange={e=>setAdminBalance(e.target.value)} placeholder="目标余额" className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"/><button onClick={async()=>{const n=Number(adminBalance);if(Number.isFinite(n)&&n>=0&&confirm(`确认将余额设为 ${Math.round(n)}？`)){try{await setUserBalance(n);invalidate('walletAccounts');setAdminBalance('')}catch(e){alert(e instanceof Error?e.message:String(e))}}}} className="rounded-lg bg-gray-900 px-4 text-sm text-white">设定</button></div></section>}

      <section className="mt-3 bg-white px-4 py-3">
        <h2 className="mb-2 text-xs font-medium text-gray-400">货币图标</h2>
        <div className="grid grid-cols-4 gap-2">
          {[
            { mode: 'coin' as const, label: '🪙', text: '金币' },
            { mode: 'emoji' as const, label: customCurrencyEmoji || '💎', text: 'emoji' },
            { mode: 'yen' as const, label: '¥', text: '人民币' },
            { mode: 'dollar' as const, label: '$', text: '美元' },
          ].map((item) => (
            <button
              key={item.mode}
              onClick={() => setSettings({ currencyIconMode: item.mode })}
              className={`rounded-lg border px-2 py-2 text-center ${
                currencyMode === item.mode ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              <span className="block text-lg">{item.label}</span>
              <span className="text-[11px]">{item.text}</span>
            </button>
          ))}
        </div>
        {currencyMode === 'emoji' && (
          <input
            value={customCurrencyEmoji ?? ''}
            onChange={(e) => setSettings({ customCurrencyEmoji: e.target.value.slice(0, 4) })}
            placeholder="输入一个表情"
            className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        )}
      </section>

      <section className="mt-3 bg-white px-4 py-3"><h2 className="mb-2 text-xs font-medium text-gray-400">AI 调用预算</h2><p className="mb-2 text-xs text-gray-500">后台自动任务达到上限后会跳过；手动聊天和手动生成不会受限。</p>{usage && <><div className="mb-2 grid grid-cols-2 gap-2 text-xs text-gray-600"><p>今日调用 <b>{usage.today.filter((r) => r.success).length}</b></p><p>近30天 <b>{usage.recent.filter((r) => r.success).length}</b></p><p>今日估算 tokens <b>{usage.today.reduce((n, r) => n + r.inputTokens + r.outputTokens, 0)}</b></p><p>自动调用 <b>{usage.today.filter((r) => r.automatic && r.success).length}</b></p></div><div className="mb-3 flex flex-wrap gap-1">{(['chat','proactive','memory','moments','worldbook','lifeSimulation','persona','quality','other'] as const).map((purpose) => <span key={purpose} className="rounded bg-gray-100 px-1.5 py-1 text-[10px] text-gray-500">{purpose} {usage.today.filter((r) => r.purpose === purpose && r.success).length}</span>)}</div></>}<label className="mb-1 block text-xs text-gray-500">自动任务每日调用上限（0 为不限）</label><input type="number" min="0" value={automaticAiDailyCap} onChange={(e) => setSettings({ automaticAiDailyCap: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"/></section>

      <section className="mt-3 bg-white px-4 py-3">
        <h2 className="mb-2 text-xs font-medium text-gray-400">AI 供应商与 API 配置</h2>

        <label className="mb-1 block text-xs text-gray-500">供应商</label>
        <select
          value={providerDraft}
          onChange={(event) => {
            const next = event.target.value as AiProviderId
            setProviderDraft(next)
            setModels([])
            setPullError('')
            setTestResult(null)
            // Every provider has its own stored key and endpoint; switching
            // just loads that provider's slot. Nothing persists until 保存.
            // The active provider's slot falls back to the legacy single
            // apiKey mirror so pre-apiKeys installs never lose their key.
            setApiKeyDraft(apiKeys?.[next] ?? (next === aiProvider ? apiKey : ''))
            setBaseUrlDraft(baseUrls?.[next] ?? AI_PROVIDERS[next].defaultBaseUrl)
          }}
          className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
        >
          {AI_PROVIDER_OPTIONS.map((provider) => (
            <option key={provider.id} value={provider.id}>{provider.label} · {provider.stability === 'stable' ? '稳定支持' : provider.stability === 'experimental' ? '实验性' : '自行兼容'}</option>
          ))}
        </select>
        <p className={`mb-3 text-[11px] leading-relaxed ${providerDraft === 'deepseek' ? 'text-green-600' : 'text-amber-600'}`}>
          {providerDraft === 'deepseek'
            ? 'DeepSeek 已经过完整实测，属于稳定支持。'
            : providerDraft === 'custom'
              ? '自定义接口会按 OpenAI Chat Completions 协议尝试调用，不保证供应商行为。'
              : '该供应商依据官方兼容协议完成适配，目前未使用对应真实 Key 做长期验证，属于实验性支持。'}
        </p>

        <label className="mb-1 block text-xs text-gray-500">API Key</label>
        <div className="relative mb-3">
          <input
            value={apiKeyDraft}
            onChange={(e) => {
              setApiKeyDraft(e.target.value)
              setTestResult(null)
            }}

            type={visibleApiKeys.ai ? 'text' : 'password'}
            placeholder="sk-..."
            className="w-full rounded-lg border border-gray-200 py-2 pl-3 pr-16 text-sm"
          />
          <button
            type="button"
            onClick={() => setVisibleApiKeys((current) => ({ ...current, ai: !current.ai }))}
            aria-label={visibleApiKeys.ai ? '隐藏 API Key' : '显示 API Key'}
            aria-pressed={visibleApiKeys.ai}
            className="absolute inset-y-0 right-0 px-3 text-xs text-gray-500"
          >
            {visibleApiKeys.ai ? '隐藏' : '显示'}
          </button>
        </div>
        <div className={`mb-3 rounded-lg px-3 py-2 text-[11px] leading-relaxed ${endpointPreviewError ? 'bg-red-50 text-red-500' : 'bg-gray-50 text-gray-500'}`}>
          {endpointPreviewError ? endpointPreviewError : <>
            <p className="break-all">实际聊天地址：{chatEndpointPreview}</p>
            <p className="mt-1 break-all">模型列表地址：{modelsEndpointPreview ?? '该供应商未声明兼容的 Models 接口，请手动填写模型'}</p>
          </>}
        </div>

        <label className="mb-1 block text-xs text-gray-500">Base URL</label>
        <input
          value={baseUrlDraft}
          readOnly={!BASE_URL_EDITABLE.has(providerDraft)}
          aria-readonly={!BASE_URL_EDITABLE.has(providerDraft)}
          onChange={(e) => {
            if (!BASE_URL_EDITABLE.has(providerDraft)) return
            setBaseUrlDraft(e.target.value)
            setTestResult(null)
          }}

          className={`mb-3 w-full rounded-lg border px-3 py-2 text-sm ${
            BASE_URL_EDITABLE.has(providerDraft)
              ? 'border-gray-200 bg-white text-gray-800'
              : 'cursor-not-allowed border-gray-100 bg-gray-100 text-gray-400'
          }`}
        />
        <label className="mb-1 block text-xs text-gray-500">模型</label>
        <div className="mb-1 flex gap-2">
          {models.length > 0 ? (
            <button
              type="button"
              onClick={() => setModelPicker('chat')}
              className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{modelDraft}</span>
              <span className="shrink-0 text-xs text-gray-400" aria-hidden="true">▼</span>
            </button>
          ) : (
            <input
              value={modelDraft}
              onChange={(e) => {
                setModelDraft(e.target.value)
                setTestResult(null)
              }}
  
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          )}
        </div>
        {pullError && <p className="mb-2 text-xs text-red-500">{pullError}</p>}

        <label className="mb-1 block text-xs text-gray-500">多功能模型（商城生成、好感度评分、世界观草稿等辅助任务，独立于主聊天模型）</label>
        <div className="mb-1 flex gap-2">
          {models.length > 0 ? (
            <button
              type="button"
              onClick={() => setModelPicker('utility')}
              className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{utilityModelDraft}</span>
              <span className="shrink-0 text-xs text-gray-400" aria-hidden="true">▼</span>
            </button>
          ) : (
            <input
              value={utilityModelDraft}
              onChange={(e) => setUtilityModelDraft(e.target.value)}

              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          )}
        </div>

        <div className="mt-2 flex gap-2">
          <button
            onClick={handlePullModels}
            disabled={pulling || !apiKeyDraft || !modelsEndpointPreview}
            className="flex-1 rounded-lg bg-gray-100 py-2 text-sm text-gray-700 disabled:opacity-50"
          >
            {pulling ? '拉取中…' : '拉取模型'}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || !apiKeyDraft}
            className="flex-1 rounded-lg bg-gray-100 py-2 text-sm text-gray-700 disabled:opacity-50"
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button
            onClick={persistConnection}
            className="flex-1 rounded-lg bg-gray-900 py-2 text-sm text-white"
          >
            保存
          </button>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">修改供应商、密钥、接口或模型后需要点保存才会生效并同步到其他设备。</p>
        {testResult && (
          <p className={`mt-2 text-xs ${testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
            {testResult.ok ? '✓ ' : '✗ '}
            {testResult.message}
          </p>
        )}

        <div className="mt-4 border-t border-gray-100 pt-3">
          <h3 className="mb-2 text-xs font-medium text-gray-400">生成参数（按供应商分别保存，改动即时生效）</h3>

          <label className="mb-1 block text-xs text-gray-500">推理强度</label>
          <select
            value={generationProfile.reasoningEffort ?? 'auto'}
            onChange={(e) => patchGenerationProfile({ reasoningEffort: e.target.value as GenerationProfile['reasoningEffort'] })}
            className="mb-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="auto">自动（不发送该字段，由供应商默认决定）</option>
            <option value="off">禁用（显式关闭思考）</option>
            <option value="low">低（low）</option>
            <option value="medium">中（medium）</option>
            <option value="high">高（high）</option>
            <option value="xhigh">超高（xhigh，仅部分模型支持）</option>
            <option value="max">最高（max，仅部分模型支持）</option>
          </select>

          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-gray-800">流式请求</p>
              <p className="mt-0.5 text-[11px] text-gray-400">部分接口只支持流式（SSE）响应；推理模型长考时也能避免连接闲置超时</p>
            </div>
            <ToggleSwitch checked={generationProfile.streamEnabled === true} onChange={(checked) => patchGenerationProfile({ streamEnabled: checked })} ariaLabel="流式请求" />
          </div>

          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-gray-800">工具调用（Agent 模式）</p>
              <p className="mt-0.5 text-[11px] text-gray-400">用结构化工具调用驱动聊天动作；接口不支持或支持差时关闭，将回退到多模型级联管线</p>
            </div>
            <ToggleSwitch checked={generationProfile.agentMode !== false} onChange={(checked) => patchGenerationProfile({ agentMode: checked })} ariaLabel="工具调用（Agent 模式）" />
          </div>

          <label className="mb-1 block text-xs text-gray-500">最大输出 token（留空默认 8096）</label>
          <input
            type="number" min={1}
            value={generationProfile.maxOutputTokens ?? ''}
            placeholder="8096"
            onChange={(e) => patchGenerationProfile({ maxOutputTokens: parseOptionalNumber(e.target.value) })}
            className="mb-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />

          <div className="mb-3 grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-xs text-gray-500">温度</label>
              <input type="number" step="0.1" value={generationProfile.temperature ?? ''} placeholder="默认 1" onChange={(e) => patchGenerationProfile({ temperature: parseOptionalNumber(e.target.value) })} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">top_p</label>
              <input type="number" step="0.05" value={generationProfile.topP ?? ''} placeholder="不发送" onChange={(e) => patchGenerationProfile({ topP: parseOptionalNumber(e.target.value) })} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">top_k</label>
              <input type="number" value={generationProfile.topK ?? ''} placeholder="不发送" onChange={(e) => patchGenerationProfile({ topK: parseOptionalNumber(e.target.value) })} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
          </div>

          <label className="mb-1 block text-xs text-gray-500">回复超时（分钟，0 为不超时；推理模型建议 5 分钟以上）</label>
          <input
            type="number" min={0} step={1}
            value={Math.round((chatResponseTimeoutMs ?? 300000) / 60000)}
            onChange={(e) => {
              const minutes = Number(e.target.value)
              if (e.target.value.trim() && Number.isFinite(minutes) && minutes >= 0) setSettings({ chatResponseTimeoutMs: Math.round(minutes * 60000) })
            }}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </div>
      </section>

      <section className="mt-3 bg-white">
        <button type="button" onClick={() => navigate('/settings/global-prompts')} className="flex w-full items-center gap-3 px-4 py-4 text-left">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-[var(--ui-special-ink)]"><FileSliders size={20} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-900">全局提示词模块</p>
            <p className="mt-0.5 text-xs text-gray-400">管理固定提示词存档、新联系人默认值和联系人覆盖</p>
          </div>
          <span className="text-lg text-gray-300">›</span>
        </button>
      </section>


      <section className="mt-3 bg-white px-4 py-3">
        <h2 className="mb-2 text-xs font-medium text-gray-400">数据备份与恢复</h2>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={handleExportBackup} className="rounded-lg bg-gray-900 py-2.5 text-sm text-white">
            导出备份
          </button>
          <button
            onClick={() => backupInputRef.current?.click()}
            disabled={restoringBackup}
            className="rounded-lg bg-gray-100 py-2.5 text-sm text-gray-700 disabled:opacity-50"
          >
            {restoringBackup ? '恢复中…' : '导入恢复'}
          </button>
        </div>
        <input
          ref={backupInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleImportBackup(file)
          }}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
          备份包含联系人、人设、聊天记录、朋友圈、表情包、仓库、资料库、世界观存档和当前设置。设置里如果保存过 API Key，备份文件里也会带上，请不要发给别人。
        </p>
        {backupStatus && <p className="mt-2 text-xs text-gray-500">{backupStatus}</p>}
      </section>

      <section className="mt-3 bg-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-gray-900">管理员模式</h2>
            <p className="text-[11px] text-gray-400">{experienceMode === 'immersive' ? '沉浸模式下不可开启；切换到自由模式后可以使用' : '开启后可使用天眼查看运行进程、真实提示词、AI 回合、记忆/事件链，并执行安全调试操作'}</p>
          </div>
          <ToggleSwitch
            checked={experienceMode === 'immersive' ? false : adminModeEnabled}
            onChange={(checked) => { if (experienceMode !== 'immersive') setSettings({ adminModeEnabled: checked }) }}
            ariaLabel="切换管理员模式"
          />
        </div>
      </section>

      <section className="mt-3 bg-white px-4 py-3">
        <h2 className="mb-2 text-xs font-medium text-gray-400">危险操作</h2>
        <button
          onClick={() => setConfirmingWipe(true)}
          className="w-full rounded-lg bg-red-50 py-2.5 text-sm text-red-500"
        >
          清空所有数据（保留账号与设置）
        </button>
        <p className="mt-2 text-[11px] text-gray-400">
          删除服务器上所有联系人、聊天、朋友圈、存档与缓存文件 保留 API 设置、界面偏好与个人资料 不可恢复
        </p>
      </section>
      </div>

      {confirmingWipe && (
        <ActionSheet
          onClose={() => setConfirmingWipe(false)}
          options={[{ label: '确认清空所有数据（设置保留）', onSelect: handleWipeContacts, danger: true }]}
        />
      )}
      {backgroundCropSrc && (
        <ImageCropper
          src={backgroundCropSrc}
          aspectRatio={0.68}
          mode="frame"
          title="裁剪聊天背景"
          onCancel={() => setBackgroundCropSrc('')}
          onConfirm={(dataUrl) => {
            void uploadDataUrlIfNeeded(dataUrl).then((url) => setSettings({ chatBackground: url }))
            setBackgroundCropSrc('')
          }}
        />
      )}
      {modelPicker && (
        <ModelPicker
          title={modelPicker === 'chat' ? '选择聊天模型' : '选择多功能模型'}
          models={models}
          value={modelPicker === 'chat' ? modelDraft : utilityModelDraft}
          onClose={() => setModelPicker(null)}
          onSelect={(selectedModel) => {
            if (modelPicker === 'chat') {
              setModelDraft(selectedModel)
              setSettings({ model: selectedModel })
              setTestResult(null)
            } else {
              setUtilityModelDraft(selectedModel)
              setSettings({ utilityModel: selectedModel })
            }
          }}
        />
      )}
    </div>
  )
}
