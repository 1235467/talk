import type { ImageProvidersSettings } from '../types'

type Workflow = Record<string, unknown>
type Node = { class_type?: unknown; inputs?: Record<string, unknown> }

function node(workflow: Workflow, id: string | undefined): Node | undefined {
  if (!id) return undefined
  const value = workflow[id]
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Node : undefined
}

function connectedNodeId(value: unknown): string | undefined {
  return Array.isArray(value) && (typeof value[0] === 'string' || typeof value[0] === 'number') ? String(value[0]) : undefined
}

export function validateComfyWorkflow(value: unknown): Workflow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('工作流 JSON 必须是对象')
  const workflow = value as Workflow
  const rows = Object.entries(workflow)
  if (!rows.length) throw new Error('工作流中没有节点')
  if (rows.some(([, item]) => !item || typeof item !== 'object' || Array.isArray(item) || typeof (item as Node).class_type !== 'string')) {
    throw new Error('这不是 ComfyUI API Format 工作流，请在 ComfyUI 中选择“Save (API Format)”后再导入')
  }
  if (!rows.some(([, item]) => ['SaveImage', 'PreviewImage', 'VHS_VideoCombine'].includes(String((item as Node).class_type)))) {
    throw new Error('工作流中没有可识别的图片输出节点')
  }
  return workflow
}

export function detectComfyWorkflowBindings(workflow: Workflow) {
  const entries = Object.entries(workflow) as Array<[string, Node]>
  const sampler = entries.find(([, item]) => /KSampler/i.test(String(item.class_type)))
  const samplerInputs = sampler?.[1].inputs ?? {}
  const positivePromptNodeId = connectedNodeId(samplerInputs.positive)
  const negativePromptNodeId = connectedNodeId(samplerInputs.negative)
  const latentNodeId = connectedNodeId(samplerInputs.latent_image)
  return {
    positivePromptNodeId: positivePromptNodeId ?? entries.find(([, item]) => item.class_type === 'CLIPTextEncode')?.[0],
    negativePromptNodeId,
    samplerNodeId: sampler?.[0],
    latentNodeId,
  }
}

export function injectComfyWorkflow(
  config: ImageProvidersSettings['comfyui'],
  query: string,
  joinedPrompt: (prefix: string, prompt: string) => string,
): Workflow {
  const source = validateComfyWorkflow(config.workflow)
  const workflow = structuredClone(source)
  const bindings = { ...detectComfyWorkflowBindings(workflow), ...config.workflowBindings }
  const positive = node(workflow, bindings.positivePromptNodeId)
  if (!positive?.inputs || !('text' in positive.inputs)) throw new Error('无法定位正面提示词输入，请重新导入包含 CLIPTextEncode 的 API 工作流')
  positive.inputs.text = joinedPrompt(config.promptPrefix, query)
  const negative = node(workflow, bindings.negativePromptNodeId)
  if (negative?.inputs && 'text' in negative.inputs) negative.inputs.text = config.negativePrompt
  const sampler = node(workflow, bindings.samplerNodeId)
  if (sampler?.inputs) {
    if ('seed' in sampler.inputs) sampler.inputs.seed = Math.floor(Math.random() * 4_294_967_295)
    if ('noise_seed' in sampler.inputs) sampler.inputs.noise_seed = Math.floor(Math.random() * 4_294_967_295)
    if ('steps' in sampler.inputs) sampler.inputs.steps = config.steps
    if ('cfg' in sampler.inputs) sampler.inputs.cfg = config.cfg
    if ('sampler_name' in sampler.inputs) sampler.inputs.sampler_name = config.sampler
    if ('scheduler' in sampler.inputs) sampler.inputs.scheduler = config.scheduler
  }
  const latent = node(workflow, bindings.latentNodeId)
  if (latent?.inputs) {
    if ('width' in latent.inputs) latent.inputs.width = config.width
    if ('height' in latent.inputs) latent.inputs.height = config.height
  }
  return workflow
}
