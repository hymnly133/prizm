/**
 * Agent 系统提示词构建
 *
 * Prompt Cache 优化架构（参考 arXiv:2601.06007 "Don't Break the Cache"）：
 *
 * 消息数组按变化频率升序排列，最大化 API 前缀缓存命中：
 * ┌─ SESSION-STATIC（同一会话内完全相同）─── 缓存命中率最高
 * │  messages[0] system:
 * │    <identity>     身份 + 画像约束
 * │    <instructions> 工具路由 + 行为准则
 * │    <rules>        外部规则 + 用户规则
 * │    <env>          scope + session 路径（会话内不变）
 * │    <workflow_context> 工作流上下文（workflow 会话，会话内不变）
 * │    <skill>        已激活技能（会话内不变）
 * ├─ INCREMENTAL（每轮追加）───────────────
 * │  messages[1..k]   压缩摘要链
 * │  messages[k+1..m] 对话历史（user/assistant）
 * ├─ PER-TURN DYNAMIC（每轮变化）──────────
 * │  messages[m+1] system:
 * │    <workspace_context> 文档/待办/会话摘要
 * │    <active_locks>  当前锁
 * │    用户画像 + 上下文记忆（由 memoryInjection 注入）
 * └─ messages[m+2] user: 当前消息
 */

import { buildScopeContextSummary } from './scopeContext'
import { scopeStore } from '../core/ScopeStore'
import { getSessionWorkspaceDir } from '../core/PathProviderCore'
import { lockManager } from '../core/resourceLockManager'
import { getDefById, getDefByName } from '../core/workflowEngine/workflowDefStore'
import { buildWorkflowSystemPrompt } from './toolLLM/workflowPrompt'
import {
  isWorkflowManagementSession as isWorkflowManagementSessionFromShared,
  type BgSessionMeta
} from '@prizm/shared'

export interface SystemPromptOptions {
  scope: string
  sessionId?: string
  includeScopeContext?: boolean
  /** 渐进式发现：仅技能 name+description */
  skillMetadataForDiscovery?: Array<{ name: string; description: string }>
  /** 已激活的 skill 指令列表 */
  activeSkillInstructions?: Array<{ name: string; instructions: string }>
  /** 已加载的外部规则内容（来自 AGENTS.md / CLAUDE.md 等项目规则） */
  rulesContent?: string
  /** 用户自定义规则内容（用户级 + scope 级） */
  customRulesContent?: string
}

/**
 * 三层提示词拆分结果。
 * 分离目的：让 session-static 部分在同一会话的所有请求中完全相同，
 * 作为 messages[0] 形成稳定的可缓存前缀（通常 2000-3500 tokens）。
 */
export interface SystemPromptParts {
  /** 会话内完全不变：identity + instructions + rules + env + workflow_context + skill */
  sessionStatic: string
  /** 每轮变化：workspace_context + active_locks */
  perTurnDynamic: string
}

/**
 * 构建三层拆分的系统提示词。
 * sessionStatic 用作 messages[0]（稳定前缀），
 * perTurnDynamic 用作对话历史之后的末尾 system 消息。
 */
export async function buildSystemPromptParts(
  options: SystemPromptOptions
): Promise<SystemPromptParts> {
  const {
    scope,
    sessionId,
    includeScopeContext = true,
    skillMetadataForDiscovery,
    activeSkillInstructions,
    rulesContent,
    customRulesContent
  } = options

  // ════════════════════════════════════════════
  // SESSION-STATIC — 同一会话内所有请求完全相同
  // ════════════════════════════════════════════

  const staticParts: string[] = []

  // 提前解析 session，以便按工具会话类型（如 workflow-management）使用独特系统提示词
  const scopeRoot = scopeStore.getScopeRootPath(scope)
  const scopeData = scopeStore.getScopeData(scope)
  const session = sessionId ? scopeData.agentSessions.find((s) => s.id === sessionId) : null
  const isWorkflowManagementType = session ? isWorkflowManagementSessionFromShared(session) : false

  if (isWorkflowManagementType) {
    // 工作流管理会话：使用工作流设计专家 + create/update 工具描述，不使用通用工作区助手与 prizm_workflow 说明
    let existingYaml: string | undefined
    const workflowDefId =
      (session as { toolMeta?: { workflowDefId?: string }; bgMeta?: { workflowDefId?: string } })
        ?.toolMeta?.workflowDefId ??
      (session as { bgMeta?: { workflowDefId?: string } })?.bgMeta?.workflowDefId
    const workflowName =
      (session as { toolMeta?: { workflowName?: string }; bgMeta?: { workflowName?: string } })
        ?.toolMeta?.workflowName ??
      (session as { bgMeta?: { workflowName?: string } })?.bgMeta?.workflowName
    if (workflowDefId) {
      const record = getDefById(workflowDefId)
      if (record?.yamlContent) existingYaml = record.yamlContent
    } else if (workflowName) {
      const record = getDefByName(workflowName, scope)
      if (record?.yamlContent) existingYaml = record.yamlContent
    }
    staticParts.push(buildWorkflowSystemPrompt(existingYaml))
  } else {
    // 通用会话：身份 + 工具路由
    staticParts.push(
      '<identity>\n' +
        '你是 Prizm 工作区助手，通过工具高效管理文件、文档、待办，基于记忆提供个性化协助。优先行动，简洁回复。\n' +
        '用户画像由系统每轮自动注入，严格遵守其中的称呼和偏好。画像为空时使用礼貌通用称呼。不要为画像创建文档。\n' +
        '</identity>'
    )

    staticParts.push(
      '<instructions>\n' +
        '工具路由：\n' +
        '文档/知识/报告/总结 → prizm_document（知识库 prizm_knowledge）\n' +
        '指定路径/.py/.json/.csv → prizm_file\n' +
        '搜索 → prizm_search(keyword) | 记忆/知识 → prizm_knowledge(search)\n' +
        '一次性命令 → prizm_terminal_execute | 交互/长期 → prizm_terminal_spawn + send_keys\n' +
        '资源锁 → prizm_lock | 文档更新/删除会自动签出，删除后锁自动释放无需 checkin\n' +
        '日程/提醒/截止日期 → prizm_schedule | 定时/周期任务 → prizm_cron\n' +
        '多步管线/审批流 → prizm_workflow\n' +
        '耗时/并行子任务 → prizm_spawn_task（异步）/ prizm_task_status（查进度）\n' +
        '后台会话提交结果 → prizm_set_result（仅后台任务会话内使用）\n' +
        '组合模式：action:list → action:read → action:update\n' +
        '知识库与文件系统互通。.prizm/ 禁止操作。\n' +
        '\n' +
        '临时工作区：草稿/临时 → workspace="session" | 正式 → "main"（默认） | 不确定 → 问用户\n' +
        'promote 前必须确认文档确实在 session 工作区（通过 workspace_context 或 list 结果判断），已在 main 的不要 promote\n' +
        '\n' +
        '准则：先查再改（删除需确认）| 不重复创建（先查重）| 同主题合并 | 简洁回复 | 语言跟随用户 | 失败换方法重试\n' +
        'ID 来源：资源 ID 必须取自工具返回结果或 workspace_context，不要用序号代替 ID\n' +
        '\n' +
        '上下文优先：workspace_context 已含文档/待办摘要和 ID，优先利用；仅需补充详情时才调用 read/search\n' +
        '最小副作用：查询/汇总/分析类请求直接文本回复，不要创建文档或待办。不要为跟踪自身工作进度创建待办列表。仅当用户明确要求"写成文档""记录下来"时才创建\n' +
        '批量优先：需要多项信息时用一次 search 或 list 获取，避免逐条 read；多个独立操作尽量合并调用\n' +
        '</instructions>'
    )
  }

  if (rulesContent || customRulesContent) {
    const rulesParts: string[] = []
    if (rulesContent) rulesParts.push(rulesContent)
    if (customRulesContent) rulesParts.push(customRulesContent)
    staticParts.push('<rules>\n' + rulesParts.join('\n\n') + '\n</rules>')
  }

  // env — scope/root/sessionWorkspace 在会话创建后不变（scopeRoot / scopeData / session 已在上方解析）
  const sessionWorkspace = sessionId ? getSessionWorkspaceDir(scopeRoot, sessionId) : null

  const isWorkflowSession = session?.bgMeta?.source === 'workflow'
  const hasWorkflowManagementContext =
    !!isWorkflowManagementType &&
    !!session &&
    !!(
      (
        session as {
          toolMeta?: { workflowDefId?: string; workflowName?: string }
          bgMeta?: { workflowDefId?: string; workflowName?: string }
        }
      ).toolMeta?.workflowDefId ??
      session?.bgMeta?.workflowDefId ??
      (session as { toolMeta?: { workflowName?: string } }).toolMeta?.workflowName ??
      (session as { bgMeta?: { workflowName?: string } }).bgMeta?.workflowName
    )
  const workflowWorkspace = isWorkflowSession
    ? session!.bgMeta!.workspaceDir
    : hasWorkflowManagementContext && session
    ? (
        session as {
          toolMeta?: { persistentWorkspaceDir?: string }
          bgMeta?: { persistentWorkspaceDir?: string }
        }
      ).toolMeta?.persistentWorkspaceDir ?? session.bgMeta?.persistentWorkspaceDir
    : undefined

  const envParts = [`scope=${scope}`, `root=${scopeRoot}`]
  if (sessionWorkspace) envParts.push(`session_workspace=${sessionWorkspace}`)
  if (workflowWorkspace) envParts.push(`workflow_workspace=${workflowWorkspace}`)
  staticParts.push(`<env>${envParts.join(' ')}</env>`)

  if (isWorkflowSession && session.bgMeta) {
    const wfCtx = await buildWorkflowContext(session.bgMeta)
    if (wfCtx) staticParts.push(wfCtx)
  }
  if (hasWorkflowManagementContext && session) {
    const mgmtMeta =
      (
        session as {
          toolMeta?: { workflowName?: string; persistentWorkspaceDir?: string }
          bgMeta?: BgSessionMeta
        }
      ).toolMeta ?? session.bgMeta
    if (mgmtMeta) {
      const grantedPaths = session.grantedPaths
      const mgmtCtx = buildWorkflowManagementContext(mgmtMeta, grantedPaths)
      if (mgmtCtx) staticParts.push(mgmtCtx)
    }
  }

  // 渐进式发现：仅元数据，模型按需用 prizm_get_skill_instructions 拉取全文
  if (skillMetadataForDiscovery?.length) {
    const lines = skillMetadataForDiscovery.map(
      (s) => `- name: ${s.name}\n  description: ${s.description}`
    )
    staticParts.push(
      '<available_skills>\n' +
        '可用技能（仅摘要）；若需某技能的完整操作说明，请调用工具 prizm_get_skill_instructions(skill_name)。\n' +
        lines.join('\n') +
        '\n</available_skills>'
    )
  }
  // skill 完整指令（非渐进式时注入）
  if (activeSkillInstructions?.length) {
    for (const skill of activeSkillInstructions) {
      staticParts.push(`<skill name="${skill.name}">\n${skill.instructions}\n</skill>`)
    }
  }

  // ════════════════════════════════════════════
  // PER-TURN DYNAMIC — 每轮变化，放在消息末尾
  // ════════════════════════════════════════════

  const dynamicParts: string[] = []

  if (includeScopeContext) {
    const contextSummary = await buildScopeContextSummary(scope)
    if (contextSummary) {
      dynamicParts.push(
        `<workspace_context scope="${scope}">\n${contextSummary}\n</workspace_context>`
      )
    }
  }

  if (sessionId) {
    const locks = lockManager.listSessionLocks(scope, sessionId)
    if (locks.length > 0) {
      const lockLines = locks.map(
        (l) => `- ${l.resourceType}/${l.resourceId}${l.reason ? ` (${l.reason})` : ''}`
      )
      dynamicParts.push(
        '<active_locks>\n' +
          '当前会话已签出的资源：\n' +
          lockLines.join('\n') +
          '\n编辑完成后务必 checkin/release 释放锁。\n' +
          '</active_locks>'
      )
    }
  }

  return {
    sessionStatic: staticParts.join('\n\n'),
    perTurnDynamic: dynamicParts.join('\n\n')
  }
}

/**
 * 向后兼容：构建注入到对话前的 system 内容（单字符串）。
 * 新代码应使用 buildSystemPromptParts() 获取拆分结构。
 */
export async function buildSystemPrompt(options: SystemPromptOptions): Promise<string> {
  const { sessionStatic, perTurnDynamic } = await buildSystemPromptParts(options)
  if (!perTurnDynamic) return sessionStatic
  return sessionStatic + '\n\n' + perTurnDynamic
}

/**
 * 构建 workflow 会话的上下文段落，注入到系统提示词中。
 * 包含工作流身份信息、前序步骤结果摘要和工作区行为指南。
 * 使用动态 import 以兼容 ESM（package type: "module" 下 require 不可用）。
 */
async function buildWorkflowContext(bgMeta: BgSessionMeta): Promise<string | null> {
  if (bgMeta.source !== 'workflow' || !bgMeta.sourceId) return null

  let run: import('@prizm/shared').WorkflowRun | null = null
  try {
    const { getRunById } = await import('../core/workflowEngine/resumeStore.js')
    run = getRunById(bgMeta.sourceId)
  } catch {
    // resumeStore 未初始化或模块不可用，跳过
  }

  const lines: string[] = ['<workflow_context>']

  if (run) {
    lines.push(`工作流: ${run.workflowName} | 运行: ${run.id}`)

    const completedSteps = Object.entries(run.stepResults).filter(
      ([, r]) => r.status === 'completed' || r.status === 'skipped'
    )
    const stepId = bgMeta.label?.replace(/^workflow:/, '')
    if (stepId) {
      lines.push(`当前步骤: ${stepId} (已完成 ${completedSteps.length} 步)`)
    }

    // 前序步骤结果摘要
    const withOutput = completedSteps.filter(([, r]) => r.output)
    if (withOutput.length > 0) {
      lines.push('')
      lines.push('前序步骤结果:')
      for (const [sid, result] of withOutput) {
        const preview = truncateOutput(result.output!, 300)
        lines.push(`· ${sid}[${result.status}]: ${preview}`)
      }
    }

    if (run.args && Object.keys(run.args).length > 0) {
      lines.push('')
      lines.push('工作流参数:')
      for (const [k, v] of Object.entries(run.args)) {
        const valStr = typeof v === 'string' ? v : JSON.stringify(v)
        lines.push(`· ${k} = ${truncateOutput(valStr, 200)}`)
      }
    }
  } else {
    lines.push(`工作流运行 ID: ${bgMeta.sourceId}`)
  }

  // 工作区行为指南
  if (bgMeta.workspaceDir) {
    const hasPersistent =
      !!bgMeta.persistentWorkspaceDir && bgMeta.persistentWorkspaceDir !== bgMeta.workspaceDir
    lines.push('')
    lines.push('工作区规则:')
    if (hasPersistent) {
      lines.push('· 相对路径和 workspace:"run" 默认指向运行工作区（步骤间数据传递、临时文件）')
      lines.push(
        '· workspace:"workflow" 指向工作流工作区（跨 run 共享：明确要求、注意事项、经验总结等）'
      )
    } else {
      lines.push('· 文件操作默认在运行工作区执行（workspace 参数留空或 "run"）')
    }
    lines.push('· 需要读写主工作区时显式传 workspace:"main"')
    lines.push('· 使用 prizm_promote_file 可将运行工作区文件提升到主工作区')
    lines.push('· 其他数据位置跟随用户要求')
  }

  lines.push('</workflow_context>')
  return lines.join('\n')
}

/** 工作流管理会话上下文所需字段（来自 toolMeta 或 bgMeta） */
interface WorkflowManagementMeta {
  workflowName?: string
  workflowDefId?: string
  persistentWorkspaceDir?: string
}

/**
 * 构建工作流管理会话的上下文段落（kind=tool 或旧 background+workflow-management，关联某工作流定义）。
 * 包含身份说明、工作区路径与文档约束；若已授权 run/步骤工作区路径则追加说明。
 */
function buildWorkflowManagementContext(
  meta: WorkflowManagementMeta,
  grantedPaths?: string[] | null
): string | null {
  if (!(meta.workflowDefId || meta.workflowName)) return null

  const lines: string[] = ['<workflow-management-context>']
  lines.push(
    `当前为工作流管理会话，仅负责该工作流的创建/修改/说明。工作流名称: ${
      meta.workflowName ?? '(未知)'
    }`
  )

  if (meta.persistentWorkspaceDir) {
    lines.push('')
    lines.push('工作区:')
    lines.push(`· workflow_workspace=${meta.persistentWorkspaceDir}`)
    lines.push(
      '· 创建文档或文件时，若需放在工作流工作区，请使用 workspace:"workflow" 或 prizm_file/prizm_document 的 workspace 参数指定 "workflow"'
    )
  }

  if (grantedPaths?.length) {
    lines.push('')
    lines.push(
      '· 当前已授权本次会话访问部分 run/步骤工作区路径，可通过 prizm_file、prizm_document 等工具使用上述授权路径（绝对路径）进行读写，便于查看某次运行的产出与步骤会话工作区。'
    )
  }

  lines.push('')
  lines.push('文档约束:')
  lines.push('· 除非用户明确提醒或要求，不要创建任何文档。')
  lines.push(
    '· 若用户明确要求文档，至多创建一份「工作流使用说明」类指导文档，须放在工作流工作区（workspace:"workflow"）；可标记为工作流描述文档。'
  )
  lines.push(
    '· 不得主动创建快速参考卡片、项目完成报告、优化建议、参数验证器、测试脚本、技术文档、运行示例、快速启动模板、使用指南等。'
  )
  lines.push('</workflow-management-context>')
  return lines.join('\n')
}

function truncateOutput(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '…'
}
