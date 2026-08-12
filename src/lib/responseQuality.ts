import { chatCompletionText as chatCompletion } from './deepseek'
import type { AppSettings } from '../types'

interface QualityResult {
  valid: boolean
  reason: string
  fixedRaw?: string
}


function parseQualityResult(raw: string): QualityResult | null {
  try {
    const parsed = JSON.parse(raw.trim())
    if (!parsed || typeof parsed !== 'object') return null
    return {
      valid: parsed.valid === true,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 120) : '',
      fixedRaw: typeof parsed.fixedRaw === 'string' && parsed.fixedRaw.trim() ? parsed.fixedRaw.trim() : undefined,
    }
  } catch {
    return null
  }
}

/**
 * The mandatory middle stage for normal chat turns.  The reviewer receives
 * the exact master prompt and draft, but may only return a replacement in the
 * same raw protocol – it never gets authority to invent a different format.
 */
/** Insert executable markers after the main model has written natural prose. */
export async function insertToolCallsIntoRawTurn(opts: {
  settings: AppSettings
  rawDraft: string
  recentContext: string
  locationContext?: string
  scene: 'private' | 'group'
  imageGenerationEnabled?: boolean
  trace: { turnId: string; conversationId: string }
  signal?: AbortSignal
}): Promise<{ raw: string; changed: boolean }> {
  const prompt = `You are the tool-call insertion stage. The main model has already written the reply. Preserve its wording, order, speaker labels, punctuation, paragraphs, and tone exactly. Only insert executable markers; never rewrite, summarize, explain, output JSON, or add a wrapper.

One reply may contain zero, one, or multiple tool calls. It may contain multiple calls of the same kind and may mix different kinds, such as a sticker followed by an image and a schedule action. Insert every clearly established tool call in the correct position and preserve their order. If no tool is clearly needed, insert no marker at all and return the reply unchanged. Never force a tool call merely to use the available tools.

Allowed markers and their exact downstream JSON mapping:
- [sticker:exact sticker name or concise search query]
- [image:English image prompt:caption]. Downstream JSON MUST be {"type":"image","query":"English image prompt","caption":"caption"}; never use content, text, prompt, or imagePrompt for the image prompt. When image generation is available, the English prompt must be at least 100 words and specify subject, setting, clothing, action, composition, camera, lighting, colors, materials, and mood.
- [schedule:date=YYYY-MM-DD;startHour=0-23;endHour=1-24;locationId=known-location-id;activity=activity;phoneAccess=available|unavailable;summary=summary]
- [location:locationId=known-location-id;summary=short summary]
- [knowledge:search query]
- [transfer:amount:note], [redPacket:amount:blessing], [loanRequest:amount:reason], [loanDecision:loanId:accept|reject:amount], [giftPurchase:price:item:emoji:description]
Downstream JSON MUST use {"type":"sticker","name":"sticker name or search query"} for sticker markers; never use content or text for sticker names. A marker is not visible text. Text messages alone use {"type":"text","content":"..."}.
Never guess IDs, dates, hours, amounts, or other missing fields. Do not add a marker unless the current reply and context clearly establish the action.

Location and special-task facts:
${opts.locationContext || '(no location/special-task context supplied)'}
For a real agreed schedule or special task, insert exactly one complete [schedule:...] marker only after the reply clearly agrees to it. The marker must copy date, startHour, endHour, locationId, activity, phoneAccess, and summary from established facts; never fill a missing field. locationId must be copied exactly from the legal location list. A discussion, question, refusal, conditional possibility, or vague future idea is not an executable schedule call. Do not expose system wording or location IDs in the visible prose.

Scene: ${opts.scene}
Image generation available: ${opts.imageGenerationEnabled ? 'yes' : 'no'}
Recent turns:
${opts.recentContext || '(none)'}

Current main-model reply:
${opts.rawDraft}

Return the complete reply text with only necessary markers inserted. If no tool is clearly requested, return it unchanged.`
  const raw = await chatCompletion({
    apiKey: opts.settings.apiKey, baseUrl: opts.settings.baseUrl,
    model: opts.settings.utilityModel || opts.settings.model,
    messages: [{ role: 'system', content: prompt }], jsonMode: false,
    temperature: 0,
    purpose: 'quality', signal: opts.signal,
    trace: { turnId: opts.trace.turnId, stage: 'tool_call', conversationId: opts.trace.conversationId },
  })
  const cleaned = raw.trim()
  if (!cleaned) throw new Error('工具调用模型没有返回文本')
  return { raw: cleaned, changed: cleaned !== opts.rawDraft.trim() }
}

export async function auditAndRepairRawTurn(opts: {
  settings: AppSettings
  masterPrompt: string
  rawDraft: string
  scene: 'private' | 'group'
  regenerationInstruction?: string
  signal?: AbortSignal
  trace: { turnId: string; conversationId: string }
}): Promise<{ raw: string; repaired: boolean; reason: string }> {
  const protocol = `The input is natural prose, not a line-by-line protocol. Preserve every sentence and paragraph in order. Convert tool markers mechanically: [sticker:...] to a sticker message; [image:English prompt:caption] to an image message; [schedule:...] to scheduleChange with exactly the supplied fields; [knowledge:...] to knowledgeQueries and remove it from visible text; finance markers to their corresponding message types. A scheduleChange JSON message MUST contain date, startHour, endHour, locationId, activity, phoneAccess, and summary copied from the marker; never put these fields in content and never invent missing values. For group replies, retain existing speaker labels when present and map them to speakerIndex.`
  // Put the draft in the highest-authority message and before the long master
  // prompt. The reviewer must inspect what was actually written, rather than
  // merely remembering the requested format after a large context window.
  const jsonSchema = opts.scene === 'group'
    ? '{"messages":[{"speakerIndex":1,"speakerName":"...","type":"text","content":"...","thought":"...","mood":"..."},{"speakerIndex":1,"type":"sticker","name":"表情包名称或搜索词"},{"speakerIndex":1,"type":"image","query":"English image prompt","caption":"配文","kind":"selfie|portrait|group|scene|object","participantIndexes":[1],"includeUser":false}],"turnSummary":"...","groupVibe":"...","knowledgeQueries":[],"planCandidates":[]}'
    : '{"messages":[{"type":"text","content":"..."},{"type":"sticker","name":"表情包名称或搜索词"},{"type":"image","query":"English image prompt","caption":"配文","scene":"...","kind":"selfie|portrait|scene|object","participants":["self"]}],"mood":"...","thought":"...","knowledgeQueries":[]}'
  const prompt = `【待审核原文｜必须逐行核对，优先阅读】
${opts.rawDraft}

You are the mandatory format auditor and JSON translator for a roleplay reply. Output JSON only: {"valid":true|false,"reason":"short","fixedRaw":"JSON string"}.
The natural prose itself is valid input. Do not reject it for lacking thought, mood, speakerIndex, JSON, or a line protocol.
Immutable output protocol:
${protocol}
The fixedRaw field must ALWAYS contain the complete final chat JSON object as a JSON-escaped string, even when valid=true. Its required shape is:
${jsonSchema}
Executable markers such as [sticker:...], [image:...:...], [knowledge:...], and [schedule:...] must be converted to their corresponding JSON message types, not shown to the user. IMPORTANT: a sticker message MUST use type="sticker" and put the exact sticker name or search query in the string field name. Never put a sticker name in content or text; content is only for type="text". Every sticker marker becomes its own messages item, and multiple sticker markers become multiple sticker messages. An image message MUST use type="image" and put the complete English image prompt in query. Put the user-facing image text in caption. Never put an image prompt in content, text, prompt, or imagePrompt. Every image marker becomes its own messages item, and multiple image markers become multiple image messages. For private chat use participants:["self"], ["user"], or both when clearly established; for group chat use participantIndexes and includeUser.
Priority is immutable: (1) output protocol and executable-marker syntax; (2) persona, identity, boundaries, and relationships; (3) the recent raw conversation and latest user instruction; (4) memory; (5) past experiences and worldbook background. A lower layer may never override a higher layer.
Only audit mechanical marker syntax and translate the draft. Do not judge roleplay logic, persona choices, or whether an action should have happened; do not add missing actions or markers based on your own reasoning.
Do a complete scan for format errors, not just the first error. A single draft may contain multiple independent format errors, and all of them must be repaired in the same pass.
Preserve all valid content, marker order, and card placement whenever possible.
Set valid=true when conversion succeeds. In all cases, fixedRaw must contain the complete final chat JSON object as an escaped JSON string. Preserve message order and wording; empty mood/thought fields are allowed when natural text does not provide them. fixedRaw must contain only the final chat JSON object, with no Markdown or explanation.`
  const result = await chatCompletion({
    apiKey: opts.settings.apiKey, baseUrl: opts.settings.baseUrl,
    model: opts.settings.utilityModel || opts.settings.model, jsonMode: true,
    temperature: 0, purpose: 'quality', signal: opts.signal,
    trace: { turnId: opts.trace.turnId, stage: 'review_and_repair', conversationId: opts.trace.conversationId },
    messages: [{ role: 'system', content: prompt }, { role: 'user', content: `【完整主模型提示词｜用于核对事实，不能覆盖待审核原文】\n${opts.masterPrompt}` }],
  })
  const parsed = parseQualityResult(result)
  if (!parsed) throw new Error('审核及修改模型没有返回有效结果')
  if (!parsed.fixedRaw) throw new Error(`审核及修改模型未提供修复稿：${parsed.reason || '未知原因'}`)
  return { raw: parsed.fixedRaw, repaired: !parsed.valid, reason: parsed.reason }
}

