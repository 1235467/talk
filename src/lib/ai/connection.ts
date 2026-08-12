import { outboundFetch } from '../api/client'
import { friendlyConnectionError, httpFailureMessage, parseJsonText, requireApiKey } from '../connectionError'
import { useSettingsStore } from '../../store/useSettingsStore'
import { AI_PROVIDERS, resolveModelsUrl, type AiProviderId } from './providers'
import { chatCompletion } from './client'
import { completionStatusMessage } from './wire'

export async function listModels(apiKey: string, baseUrl: string, provider: AiProviderId = useSettingsStore.getState().aiProvider): Promise<string[]> {
  try {
    const key = requireApiKey(apiKey, 'AI')
    const modelsUrl = resolveModelsUrl(baseUrl, provider)
    if (!modelsUrl) throw new Error(`${AI_PROVIDERS[provider].label} 未声明兼容的模型列表接口，请直接填写模型名称`)
    const res = await outboundFetch(modelsUrl, {
      headers: { Authorization: `Bearer ${key}` },
    })
    const text = await res.text()
    const json = parseJsonText(text, 'AI 接口') as { data?: unknown }
    if (!res.ok) throw new Error(httpFailureMessage('AI 接口', res.status, json))
    if (!Array.isArray(json?.data)) throw new Error('AI 接口返回的数据中没有模型列表，请检查 Base URL 是否兼容 OpenAI 接口')
    const list = json.data
      .flatMap((item) => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' ? [(item as { id: string }).id] : [])
      .sort()
    if (list.length === 0) throw new Error('AI 接口连接成功，但没有返回可用模型')
    return list
  } catch (error) {
    throw new Error(friendlyConnectionError(error, 'AI 接口'))
  }
}

export async function testConnection(
  apiKey: string,
  baseUrl: string,
  model: string,
  provider: AiProviderId = useSettingsStore.getState().aiProvider,
): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 20_000)
  try {
    if (!model.trim()) throw new Error('请先填写或选择模型')
    const result = await chatCompletion({
      apiKey,
      baseUrl,
      model,
      provider,
      messages: [{ role: 'user', content: '请只回复 OK，不要解释。' }],
      signal: controller.signal,
      purpose: 'other',
    })
    if (result.status === 'length' && !result.content.trim()) {
      return { ok: false, message: '接口已响应，但模型在短测试中没有返回正文；这可能是推理模型的输出额度不足，实际聊天仍可能可用' }
    }
    if (result.status !== 'ok' || !result.content.trim()) return { ok: false, message: completionStatusMessage(result) }
    return { ok: true, message: '连接成功，模型已正常返回回复' }
  } catch (err) {
    if (timedOut) return { ok: false, message: 'AI 接口连接超时（20 秒），请检查网络、接口地址或服务状态后重试' }
    return { ok: false, message: friendlyConnectionError(err, 'AI 接口') }
  } finally {
    clearTimeout(timeoutId)
  }
}
