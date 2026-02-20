/**
 * Workflow Parser — YAML/JSON 解析 + 校验
 *
 * 将 YAML 或 JSON 字符串解析为 WorkflowDef，并校验结构合法性。
 */

import yaml from 'js-yaml'
import type {
  WorkflowDef,
  WorkflowStepDef,
  WorkflowStepType,
  WorkflowDefConfig,
  WorkflowWorkspaceMode,
  WorkflowStepSessionConfig,
  WorkflowStepRetryConfig
} from '@prizm/shared'

const VALID_STEP_TYPES: WorkflowStepType[] = ['agent', 'approve', 'transform']

const STEP_REF_PATTERN = /\$([a-zA-Z_][a-zA-Z0-9_]*)\.(\w+(?:\.\w+)*)/g

export class WorkflowParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowParseError'
  }
}

/**
 * 从 YAML 或 JSON 字符串解析为 WorkflowDef。
 * 自动判断格式（以 `{` 开头视为 JSON，否则视为 YAML）。
 */
export function parseWorkflowDef(content: string): WorkflowDef {
  const trimmed = content.trim()
  let raw: unknown

  try {
    if (trimmed.startsWith('{')) {
      raw = JSON.parse(trimmed)
    } else {
      raw = yaml.load(trimmed)
    }
  } catch (err) {
    throw new WorkflowParseError(
      `解析工作流定义失败: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!raw || typeof raw !== 'object') {
    throw new WorkflowParseError('工作流定义必须是一个对象')
  }

  const obj = raw as Record<string, unknown>
  return validateWorkflowDef(obj)
}

function validateWorkflowDef(obj: Record<string, unknown>): WorkflowDef {
  if (!obj.name || typeof obj.name !== 'string') {
    throw new WorkflowParseError('工作流定义缺少 name 字段')
  }

  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    throw new WorkflowParseError('工作流定义缺少 steps 数组或 steps 为空')
  }

  const stepIds = new Set<string>()
  const steps: WorkflowStepDef[] = []

  for (let i = 0; i < obj.steps.length; i++) {
    const step = validateStep(obj.steps[i] as Record<string, unknown>, i, stepIds)
    stepIds.add(step.id)
    steps.push(step)
  }

  const def: WorkflowDef = {
    name: obj.name as string,
    steps
  }

  if (typeof obj.description === 'string') def.description = obj.description
  if (obj.args && typeof obj.args === 'object') {
    def.args = obj.args as WorkflowDef['args']
  }
  if (obj.outputs && typeof obj.outputs === 'object') {
    def.outputs = validateOutputs(obj.outputs as Record<string, unknown>)
  }
  if (Array.isArray(obj.triggers)) {
    def.triggers = obj.triggers.map(validateTrigger)
  }
  if (obj.config && typeof obj.config === 'object') {
    def.config = validateConfig(obj.config as Record<string, unknown>)
  }

  return def
}

function generateStepId(index: number, previousIds: Set<string>): string {
  let candidate = `step_${index + 1}`
  while (previousIds.has(candidate)) {
    candidate = `step_${index + 1}_${Math.random().toString(36).slice(2, 6)}`
  }
  return candidate
}

function validateStep(
  raw: Record<string, unknown>,
  index: number,
  previousIds: Set<string>
): WorkflowStepDef {
  if (!raw || typeof raw !== 'object') {
    throw new WorkflowParseError(`步骤 #${index} 不是有效对象`)
  }

  const stepId = (typeof raw.id === 'string' && raw.id)
    ? raw.id
    : generateStepId(index, previousIds)

  if (previousIds.has(stepId)) {
    throw new WorkflowParseError(`步骤 ID "${stepId}" 重复，每个步骤的 id 必须唯一`)
  }

  const type = raw.type as WorkflowStepType
  if (!type || !VALID_STEP_TYPES.includes(type)) {
    throw new WorkflowParseError(
      `步骤 "${stepId}" 的 type "${raw.type ?? '(空)'}" 无效。仅支持: ${VALID_STEP_TYPES.join(' / ')}。agent=LLM执行, approve=人工审批, transform=数据变换`
    )
  }

  if (type === 'agent' && !raw.prompt) {
    throw new WorkflowParseError(`agent 步骤 "${stepId}" 缺少 prompt 字段，需要提供 LLM 执行指令`)
  }

  if (type === 'approve' && !raw.approvePrompt && !raw.prompt) {
    throw new WorkflowParseError(`approve 步骤 "${stepId}" 缺少 approvePrompt 或 prompt 字段，需要提供审批提示文案`)
  }

  if (type === 'transform' && !raw.transform) {
    throw new WorkflowParseError(`transform 步骤 "${stepId}" 缺少 transform 字段，需要提供 jq-like 变换表达式`)
  }

  raw.id = stepId
  validateStepReferences(raw, previousIds)

  const step: WorkflowStepDef = {
    id: stepId,
    type
  }

  if (typeof raw.description === 'string') step.description = raw.description
  if (typeof raw.prompt === 'string') step.prompt = raw.prompt
  if (typeof raw.approvePrompt === 'string') step.approvePrompt = raw.approvePrompt
  if (typeof raw.transform === 'string') step.transform = raw.transform
  if (typeof raw.input === 'string') step.input = raw.input
  if (typeof raw.condition === 'string') step.condition = raw.condition
  if (typeof raw.model === 'string') step.model = raw.model
  if (typeof raw.timeoutMs === 'number') step.timeoutMs = raw.timeoutMs
  if (raw.sessionConfig && typeof raw.sessionConfig === 'object') {
    step.sessionConfig = validateSessionConfig(raw.sessionConfig as Record<string, unknown>)
  }
  if (raw.retryConfig && typeof raw.retryConfig === 'object') {
    step.retryConfig = validateRetryConfig(raw.retryConfig as Record<string, unknown>)
  }
  if (Array.isArray(raw.linkedActions)) step.linkedActions = raw.linkedActions

  return step
}

/**
 * 校验步骤中 $stepId 引用的合法性：
 * 被引用的 stepId 必须存在于前序步骤中（或为 'prev'）。
 */
function validateStepReferences(
  raw: Record<string, unknown>,
  previousIds: Set<string>
): void {
  const fieldsToCheck = ['input', 'condition']
  for (const field of fieldsToCheck) {
    const value = raw[field]
    if (typeof value !== 'string') continue

    let match: RegExpExecArray | null
    STEP_REF_PATTERN.lastIndex = 0
    while ((match = STEP_REF_PATTERN.exec(value)) !== null) {
      const refId = match[1]
      if (refId === 'prev') continue
      if (!previousIds.has(refId)) {
        throw new WorkflowParseError(
          `步骤 "${raw.id}" 的 ${field} 引用了不存在的步骤 "$${refId}"，可用的前序步骤: ${[...previousIds].join(', ') || '(无)'}`
        )
      }
    }
  }
}

function validateOutputs(raw: Record<string, unknown>): WorkflowDef['outputs'] {
  const result: Record<string, { type?: string; description?: string }> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') {
      throw new WorkflowParseError(`outputs.${key} 必须是一个对象（包含 type/description）`)
    }
    const v = value as Record<string, unknown>
    result[key] = {
      ...(typeof v.type === 'string' ? { type: v.type } : {}),
      ...(typeof v.description === 'string' ? { description: v.description } : {})
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function validateTrigger(raw: unknown): WorkflowDef['triggers'] extends (infer T)[] | undefined ? T : never {
  if (!raw || typeof raw !== 'object') {
    throw new WorkflowParseError('trigger 定义必须是对象')
  }
  const t = raw as Record<string, unknown>
  const validTypes = ['cron', 'schedule_remind', 'todo_completed', 'document_saved']
  if (!t.type || !validTypes.includes(t.type as string)) {
    throw new WorkflowParseError(`trigger type 无效，期望: ${validTypes.join('/')}`)
  }
  return {
    type: t.type as 'cron' | 'schedule_remind' | 'todo_completed' | 'document_saved',
    filter: t.filter as Record<string, string> | undefined
  }
}

const VALID_WORKSPACE_MODES: WorkflowWorkspaceMode[] = ['dual', 'shared', 'isolated']

function validateConfig(raw: Record<string, unknown>): WorkflowDefConfig {
  const config: WorkflowDefConfig = {}
  if (typeof raw.maxTotalTimeoutMs === 'number') config.maxTotalTimeoutMs = raw.maxTotalTimeoutMs
  if (raw.errorStrategy === 'fail_fast' || raw.errorStrategy === 'continue') {
    config.errorStrategy = raw.errorStrategy
  }
  if (typeof raw.reuseWorkspace === 'boolean') config.reuseWorkspace = raw.reuseWorkspace
  if (typeof raw.cleanBefore === 'boolean') config.cleanBefore = raw.cleanBefore
  if (typeof raw.workspaceMode === 'string' && VALID_WORKSPACE_MODES.includes(raw.workspaceMode as WorkflowWorkspaceMode)) {
    config.workspaceMode = raw.workspaceMode as WorkflowWorkspaceMode
  }
  if (typeof raw.notifyOnComplete === 'boolean') config.notifyOnComplete = raw.notifyOnComplete
  if (typeof raw.notifyOnFail === 'boolean') config.notifyOnFail = raw.notifyOnFail
  if (Array.isArray(raw.tags)) config.tags = raw.tags.filter((t): t is string => typeof t === 'string')
  if (typeof raw.version === 'string') config.version = raw.version
  return config
}

function validateSessionConfig(raw: Record<string, unknown>): WorkflowStepSessionConfig {
  const sc: WorkflowStepSessionConfig = {}
  if (typeof raw.thinking === 'boolean') sc.thinking = raw.thinking
  if (Array.isArray(raw.skills)) sc.skills = raw.skills.filter((s): s is string => typeof s === 'string')
  if (typeof raw.systemPrompt === 'string') sc.systemPrompt = raw.systemPrompt
  if (Array.isArray(raw.allowedTools)) sc.allowedTools = raw.allowedTools.filter((t): t is string => typeof t === 'string')
  if (typeof raw.model === 'string') sc.model = raw.model
  if (typeof raw.maxTurns === 'number') sc.maxTurns = raw.maxTurns
  if (typeof raw.expectedOutputFormat === 'string') sc.expectedOutputFormat = raw.expectedOutputFormat
  if (raw.outputSchema && typeof raw.outputSchema === 'object') {
    sc.outputSchema = raw.outputSchema as Record<string, unknown>
  }
  if (typeof raw.maxSchemaRetries === 'number') sc.maxSchemaRetries = raw.maxSchemaRetries
  if (raw.toolGroups && typeof raw.toolGroups === 'object') {
    sc.toolGroups = raw.toolGroups as Record<string, boolean>
  }
  return sc
}

function validateRetryConfig(raw: Record<string, unknown>): WorkflowStepRetryConfig {
  const rc: WorkflowStepRetryConfig = {}
  if (typeof raw.maxRetries === 'number') rc.maxRetries = raw.maxRetries
  if (typeof raw.retryDelayMs === 'number') rc.retryDelayMs = raw.retryDelayMs
  if (Array.isArray(raw.retryOn)) {
    rc.retryOn = raw.retryOn.filter(
      (v): v is 'failed' | 'timeout' => v === 'failed' || v === 'timeout'
    )
  }
  return rc
}

/** 将 WorkflowDef 序列化为 YAML 字符串 */
export function serializeWorkflowDef(def: WorkflowDef): string {
  return yaml.dump(def, { lineWidth: 120, noRefs: true })
}
