/**
 * 会话类型 Header 文案 — 用于在聊天面板顶部显眼展示 BG 会话或工具会话类型。
 * 仅对 kind=background 或 kind=tool 返回非空，interactive 不展示。
 * 包含引用信息：工作流名、运行 ID、人类可读标签等，用于完善会话信息展示。
 */
import { WORKFLOW_MANAGEMENT_SOURCE } from '@prizm/shared'

type SessionLike = {
  kind?: 'interactive' | 'background' | 'tool'
  bgMeta?: {
    source?: string
    label?: string
    workflowDefId?: string
    workflowName?: string
    sourceId?: string
  }
  toolMeta?: {
    source?: string
    label?: string
    workflowDefId?: string
    workflowName?: string
  }
} | null

const BG_SOURCE_LABELS: Record<string, string> = {
  direct: '直接触发',
  task: '任务步骤',
  workflow: '工作流步骤',
  'workflow-management': '工作流管理'
}

/** 会话类型 Header 中的引用/附加信息（工作流、运行、标签） */
export interface SessionTypeHeaderRefs {
  /** 工作流定义 ID（用于跳转） */
  workflowDefId?: string
  /** 工作流名称（展示用） */
  workflowName?: string
  /** 关联运行 ID（BgSessionMeta.sourceId = TaskRun.id / WorkflowRun.id） */
  runId?: string
  /** 人类可读标签 */
  label?: string
}

export interface SessionTypeHeaderInfo {
  type: 'background' | 'tool'
  label: string
  subLabel: string
  /** 引用与附加信息，用于在 header 内展示「引用：工作流 XXX · 运行 YYY」等 */
  refs?: SessionTypeHeaderRefs
}

export function getSessionTypeHeader(session: SessionLike): SessionTypeHeaderInfo | null {
  if (!session || !session.kind) return null
  if (session.kind === 'interactive') return null

  const refs = buildRefs(session)

  if (session.kind === 'tool') {
    const source = session.toolMeta?.source
    const subLabel =
      source === WORKFLOW_MANAGEMENT_SOURCE || source === 'workflow_management'
        ? '工作流管理'
        : source || '工具'
    return { type: 'tool', label: '工具会话', subLabel, refs: refs || undefined }
  }

  if (session.kind === 'background') {
    const source = session.bgMeta?.source
    const subLabel =
      (source && BG_SOURCE_LABELS[source]) ||
      (source === 'workflow_management' ? '工作流管理' : source) ||
      '后台任务'
    return { type: 'background', label: '后台会话', subLabel, refs: refs || undefined }
  }

  return null
}

function buildRefs(session: SessionLike): SessionTypeHeaderRefs | null {
  if (!session) return null
  const tool = session.toolMeta
  const bg = session.bgMeta
  const workflowDefId = tool?.workflowDefId ?? bg?.workflowDefId
  const workflowName = tool?.workflowName ?? bg?.workflowName
  const label = tool?.label ?? bg?.label
  const runId = bg?.sourceId
  if (!workflowDefId && !workflowName && !label && !runId) return null
  return {
    workflowDefId: workflowDefId || undefined,
    workflowName: workflowName || undefined,
    runId: runId || undefined,
    label: label || undefined
  }
}
