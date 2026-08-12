import type { AppSettings, Contact, ContactExperience } from '../types'
import { chatCompletionText } from './deepseek'
import { parseJsonLoose } from './aiProtocol'

export interface ContactAdminSuggestion {
  summary: string
  contactPatch?: Partial<Contact>
  experiencePatches?: Array<Partial<ContactExperience> & { id: string }>
}

export async function suggestContactAdminEdit(input: {
  settings: AppSettings
  contact: Contact
  experiences: ContactExperience[]
  instruction: string
}): Promise<ContactAdminSuggestion> {
  const raw = await chatCompletionText({
    apiKey: input.settings.apiKey,
    baseUrl: input.settings.baseUrl,
    model: input.settings.utilityModel || input.settings.model,
    provider: input.settings.aiProvider,
    messages: [{ role: 'system', content: `你是联系人设定二次编辑助手。根据管理员的明确要求提出最小修改，不得擅自改变未被要求的身份、共同经历、关系、职业或世界观。只输出JSON：
{"summary":"修改说明","contactPatch":{},"experiencePatches":[{"id":"原经历ID","summary":"修改后内容"}]}
contactPatch只放需要改变的Contact字段；不得修改id、createdAt、记忆游标或后台时间戳。经历只能引用输入中已有ID，不能凭空新增事实。` }, { role: 'user', content: `管理员要求：${input.instruction}

当前联系人：
${JSON.stringify(input.contact)}

当前经历：
${JSON.stringify(input.experiences)}` }],
    jsonMode: true,
    purpose: 'persona',
  })
  const parsed = parseJsonLoose<ContactAdminSuggestion>(raw)
  if (!parsed || typeof parsed !== 'object' || typeof parsed.summary !== 'string') throw new Error('AI 没有返回可用的修改方案')
  return parsed
}
