import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TopBar } from '../components/TopBar'
import { ToggleSwitch } from '../components/ToggleSwitch'
import { api, type ServerPromptPreset } from '../lib/api/resources'
import { invalidate } from '../lib/api/keys'
import { ApiError } from '../lib/api/client'
import { PROMPT_MODULE_DEFINITIONS, unknownPromptPlaceholders } from '../lib/promptModules'
import { clonePromptModules } from '../lib/promptPresets'
import { displayName } from '../lib/contact'
import { useSettingsStore } from '../store/useSettingsStore'
import type { PromptModuleId, PromptModuleSettings } from '../types'

function validateModules(modules: PromptModuleSettings): string {
  for (const definition of PROMPT_MODULE_DEFINITIONS) {
    for (const template of definition.templates) {
      const unknown = unknownPromptPlaceholders(definition.id, template.id, modules[definition.id]?.templates?.[template.id] ?? '')
      if (unknown.length) return `${definition.name}／${template.name}含未知占位符：${unknown.map((key) => `{{${key}}}`).join('、')}`
    }
  }
  return ''
}

export function GlobalPromptModulesPage() {
  const settings = useSettingsStore()
  const { data: presets = [] } = useQuery({ queryKey: ['presets'], queryFn: () => api.presets.list() })
  const { data: contacts = [] } = useQuery({ queryKey: ['contacts'], queryFn: () => api.contacts.list() })
  const [selectedName, setSelectedName] = useState('')
  const selected = presets.find((preset) => preset.name === selectedName) ?? presets.find((preset) => preset.isFactory) ?? presets[0]
  const [draft, setDraft] = useState<PromptModuleSettings | null>(null)
  const [editing, setEditing] = useState<{ moduleId: PromptModuleId; templateId: string } | null>(null)
  const [validationError, setValidationError] = useState('')
  const [status, setStatus] = useState('')
  const [applyingPreset, setApplyingPreset] = useState<ServerPromptPreset | null>(null)
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([])

  useEffect(() => {
    if (selected && !draft) setDraft(clonePromptModules(selected.modules as PromptModuleSettings))
  }, [selected, draft])

  function loadPreset(preset: ServerPromptPreset) {
    setSelectedName(preset.name)
    setDraft(clonePromptModules(preset.modules as PromptModuleSettings))
    setEditing(null)
    setValidationError('')
    setStatus('')
  }

  async function saveInPlace() {
    if (!selected || !draft) return
    const error = validateModules(draft)
    if (error) { setValidationError(error); return }
    setValidationError('')
    try {
      await api.presets.update(selected.name, draft)
      invalidate('presets', 'contactPromptModules')
      setStatus(`已原地保存“${selected.name}”，引用它的联系人下一轮聊天生效`)
    } catch (error) {
      setStatus(error instanceof ApiError ? error.message : '保存失败')
    }
  }

  async function saveAsNew() {
    if (!draft) return
    const error = validateModules(draft)
    if (error) { setValidationError(error); return }
    const name = window.prompt('新预设的名字（不能和现有预设重名）')?.trim()
    if (!name) return
    setValidationError('')
    try {
      await api.presets.create(name, draft)
      invalidate('presets')
      setSelectedName(name)
      setStatus(`已另存为“${name}”`)
    } catch (error) {
      setStatus(error instanceof ApiError ? error.message : '保存失败')
    }
  }

  async function deletePreset(preset: ServerPromptPreset) {
    if (preset.isFactory) return
    const referencedBy = contacts.filter((contact) => contact.presetName === preset.name)
    if (referencedBy.length && !window.confirm(`“${preset.name}”仍被 ${referencedBy.length} 个联系人引用，删除后它们回落到出厂默认。确定删除？`)) return
    if (!referencedBy.length && !window.confirm(`删除预设“${preset.name}”？`)) return
    for (const contact of referencedBy) await api.contacts.patch(contact.id, { presetName: null as never })
    await api.presets.delete(preset.name)
    invalidate('presets', 'contacts')
    if (selectedName === preset.name) { setSelectedName(''); setDraft(null) }
  }

  function makeDefault(preset: ServerPromptPreset) {
    settings.setSettings({ defaultPresetName: preset.isFactory ? undefined : preset.name })
    setStatus(preset.isFactory ? '新联系人将使用出厂默认预设' : `新联系人将使用“${preset.name}”`)
  }

  async function applyToContacts() {
    if (!applyingPreset || selectedContactIds.length === 0) return
    for (const contactId of selectedContactIds) {
      await api.contacts.patch(contactId, { presetName: applyingPreset.isFactory ? null as never : applyingPreset.name })
    }
    invalidate('contacts')
    setApplyingPreset(null)
    setSelectedContactIds([])
  }

  const isDefault = selected && ((selected.isFactory && !settings.defaultPresetName) || selected.name === settings.defaultPresetName)

  return <div className="relative flex h-[var(--app-height)] flex-col overflow-hidden bg-[#f4f4f6]">
    <TopBar title="全局提示词模块" showBack />
    <div className="flex-1 overflow-y-auto pb-8">
      <section className="mt-3 bg-white px-4 py-4">
        <h2 className="mb-3 text-xs font-medium text-gray-400">提示词预设</h2>
        <div className="space-y-2">{presets.map((preset) => <div key={preset.name} className={`rounded-xl border px-3 py-3 ${selected?.name === preset.name ? 'border-gray-900' : 'border-gray-200'}`}>
          <button type="button" onClick={() => loadPreset(preset)} className="w-full text-left">
            <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{preset.name}</span>{preset.isFactory && <span className="text-[10px] text-gray-400">出厂只读</span>}{((preset.isFactory && !settings.defaultPresetName) || preset.name === settings.defaultPresetName) && <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[10px] text-white">新联系人默认</span>}</div>
          </button>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <button type="button" onClick={() => makeDefault(preset)} className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-gray-600">设为新联系人默认</button>
            <button type="button" onClick={() => { setApplyingPreset(preset); setSelectedContactIds([]) }} className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-gray-600">应用到联系人</button>
            {!preset.isFactory && <button type="button" onClick={() => void deletePreset(preset)} className="ml-auto rounded-lg px-2.5 py-1.5 text-red-500">删除</button>}
          </div>
        </div>)}</div>
      </section>

      {selected && draft && <section className="mt-3 bg-white px-4 py-4">
        <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="text-sm font-medium text-gray-900">正在编辑：{selected.name}</h2><p className="mt-1 text-[11px] text-gray-400">{selected.isFactory ? '出厂预设只读，改动请“另存为”一个自己的预设。' : '原地保存后，所有按名引用这个预设的联系人下一轮聊天生效。'}</p></div>{isDefault && <span className="shrink-0 rounded-full bg-gray-900 px-2 py-0.5 text-[10px] text-white">默认</span>}</div>
        <div className="mb-3 flex gap-2">
          {!selected.isFactory && <button type="button" onClick={() => void saveInPlace()} className="flex-1 rounded-xl bg-gray-900 py-2.5 text-sm font-medium text-white">原地保存</button>}
          <button type="button" onClick={() => void saveAsNew()} className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm text-gray-700">另存为新预设</button>
        </div>
        {validationError && <p className="mb-2 text-xs text-red-500">{validationError}</p>}
        {status && <p className="mb-2 text-xs text-green-600">{status}</p>}
        <div className="space-y-3">{PROMPT_MODULE_DEFINITIONS.map((definition) => {
          const config = draft[definition.id]
          if (!config) return null
          return <div key={definition.id} className="rounded-xl border border-gray-200 p-3">
            <div className="flex items-center gap-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-gray-900">{definition.name}</p><p className="text-[10px] text-gray-400">{definition.description}</p></div><ToggleSwitch checked={config.enabled} onChange={(enabled) => setDraft((current) => current ? { ...current, [definition.id]: { ...current[definition.id], enabled } } : current)} ariaLabel={`切换${definition.name}`} /></div>
            <div className="mt-2 space-y-2">{definition.templates.map((template) => {
              const open = editing?.moduleId === definition.id && editing.templateId === template.id
              return <div key={template.id} className="rounded-lg bg-gray-50 px-3 py-2">
                <button type="button" onClick={() => setEditing(open ? null : { moduleId: definition.id, templateId: template.id })} className="flex w-full items-center justify-between text-left"><span className="text-xs font-medium text-gray-700">{template.name}</span><span className="text-xs text-gray-400">{open ? '收起' : '编辑'}</span></button>
                {open && <><textarea value={config.templates[template.id] ?? ''} onChange={(event) => setDraft((current) => current ? { ...current, [definition.id]: { ...current[definition.id], templates: { ...current[definition.id].templates, [template.id]: event.target.value } } } : current)} rows={10} className="mt-2 w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed" /><p className="mt-1 text-[10px] text-gray-400">可用动态占位符：{template.placeholders.length ? template.placeholders.map((key) => `{{${key}}}`).join('、') : '无'}</p></>}
              </div>
            })}</div>
          </div>
        })}</div>
      </section>}
    </div>

    {applyingPreset && <div className="absolute inset-0 z-50 flex items-end bg-black/40" onClick={() => setApplyingPreset(null)}><div className="max-h-[80%] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" onClick={(event) => event.stopPropagation()}><h3 className="text-base font-medium text-gray-900">应用“{applyingPreset.name}”</h3><p className="mt-1 text-xs text-gray-400">选中的联系人改为按名引用这个预设。</p><div className="mt-3 space-y-1">{contacts.map((contact) => <label key={contact.id} className="flex items-center gap-3 rounded-lg px-2 py-2 active:bg-gray-50"><input type="checkbox" checked={selectedContactIds.includes(contact.id)} onChange={(event) => setSelectedContactIds((ids) => event.target.checked ? [...ids, contact.id] : ids.filter((id) => id !== contact.id))} /><span className="min-w-0 flex-1 truncate text-sm text-gray-800">{displayName(contact)}</span><span className="truncate text-[10px] text-gray-400">{contact.presetName || '出厂默认'}</span></label>)}</div><div className="mt-4 flex gap-2"><button type="button" onClick={() => setApplyingPreset(null)} className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm text-gray-600">取消</button><button type="button" onClick={() => void applyToContacts()} disabled={!selectedContactIds.length} className="flex-1 rounded-xl bg-gray-900 py-2.5 text-sm text-white disabled:opacity-40">确认应用</button></div></div></div>}
  </div>
}
