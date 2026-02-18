/**
 * Agent 系统提示词构建
 *
 * 设计原则（参考 VSCode Agent / Windsurf / Manus 等成熟 Agent 架构）：
 * - XML 标签分隔：用 <identity> <instructions> <workspace_context> 等标签帮助 LLM 区分指令与数据
 * - Prompt Cache 优化：按 "静态 → 半静态 → 动态" 排列，最大化 API 前缀缓存命中
 *   OpenAI/Zhipu 均基于前缀精确匹配缓存，静态内容必须在最前面
 * - Token Efficiency：目标模型为轻量 LLM（MiMo/GLM-4-flash），提示词必须精简
 * - Tool Guide as Skill：复杂工具指令由 LLM 按需通过 prizm_tool_guide 查询
 * - 不重复工具定义中已有的信息（工具名、参数描述由 function calling 接口提供）
 *
 * 排列顺序（按变化频率升序，缓存友好）：
 * ┌─ STATIC（所有请求完全相同）──────────── 缓存命中率最高
 * │  <identity>   身份 + 画像约束
 * │  <instructions> 工具路由 + 行为准则
 * ├─ SEMI-STATIC（同 scope 配置内稳定）────
 * │  <rules>      外部规则 + 用户规则
 * ├─ DYNAMIC（每个会话/每轮变化）──────────
 * │  <env>        scope + session 路径
 * │  <workspace_context> 文档/待办/会话摘要
 * │  <skill>      已激活技能
 * └─ （chat.ts 单独注入用户画像 system msg）
 */

import { buildScopeContextSummary } from './scopeContext'
import { scopeStore } from '../core/ScopeStore'
import { getSessionWorkspaceDir } from '../core/PathProviderCore'
import { lockManager } from '../core/resourceLockManager'

export interface SystemPromptOptions {
  scope: string
  sessionId?: string
  includeScopeContext?: boolean
  /** 已激活的 skill 指令列表 */
  activeSkillInstructions?: Array<{ name: string; instructions: string }>
  /** 已加载的外部规则内容（来自 AGENTS.md / CLAUDE.md 等项目规则） */
  rulesContent?: string
  /** 用户自定义规则内容（用户级 + scope 级） */
  customRulesContent?: string
}

/**
 * 构建注入到对话前的 system 内容
 */
export async function buildSystemPrompt(options: SystemPromptOptions): Promise<string> {
  const {
    scope,
    sessionId,
    includeScopeContext = true,
    activeSkillInstructions,
    rulesContent,
    customRulesContent
  } = options

  const parts: string[] = []

  // ════════════════════════════════════════════
  // STATIC ZONE — 所有请求完全相同，缓存命中率最高
  // ════════════════════════════════════════════

  // 身份（不含任何动态数据）
  parts.push(
    '<identity>\n' +
      '你是 Prizm 工作区助手，通过工具高效管理文件、文档、待办，基于记忆提供个性化协助。优先行动，简洁回复。\n' +
      '用户画像由系统每轮自动注入，严格遵守其中的称呼和偏好。画像为空时使用礼貌通用称呼。不要为画像创建文档。\n' +
      '</identity>'
  )

  // 指令（纯静态：工具路由 + 临时工作区概念 + 行为准则，不含路径）
  parts.push(
    '<instructions>\n' +
      '工具路由：\n' +
      '文档/知识/报告/总结 → prizm_document（知识库 prizm_knowledge）\n' +
      '指定路径/.py/.json/.csv → prizm_file\n' +
      '搜索 → prizm_search(keyword) | 记忆/知识 → prizm_knowledge(search)\n' +
      '一次性命令 → prizm_terminal_execute | 交互/长期 → prizm_terminal_spawn + send_keys\n' +
      '资源锁 → prizm_lock | 文档更新/删除会自动签出，删除后锁自动释放无需 checkin\n' +
      '组合模式：action:list → action:read → action:update\n' +
      '知识库与文件系统互通。.prizm/ 禁止操作。\n' +
      '\n' +
      '临时工作区：草稿/临时 → workspace="session" | 正式 → "main"（默认） | 不确定 → 问用户\n' +
      '确认保留 → prizm_promote_file\n' +
      '\n' +
      '准则：先查再改（删除需确认）| 不重复创建（先查重）| 同主题合并 | 简洁回复 | 语言跟随用户 | 失败换方法重试\n' +
      '</instructions>'
  )

  // ════════════════════════════════════════════
  // SEMI-STATIC ZONE — 同 scope 配置内稳定
  // ════════════════════════════════════════════

  if (rulesContent || customRulesContent) {
    const rulesParts: string[] = []
    if (rulesContent) rulesParts.push(rulesContent)
    if (customRulesContent) rulesParts.push(customRulesContent)
    parts.push('<rules>\n' + rulesParts.join('\n\n') + '\n</rules>')
  }

  // ════════════════════════════════════════════
  // DYNAMIC ZONE — 每个会话 / 每轮变化
  // ════════════════════════════════════════════

  // 环境（含会话级动态路径）
  const scopeRoot = scopeStore.getScopeRootPath(scope)
  const sessionWorkspace = sessionId ? getSessionWorkspaceDir(scopeRoot, sessionId) : null

  parts.push(
    `<env>scope=${scope} root=${scopeRoot}` +
      (sessionWorkspace ? ` session_workspace=${sessionWorkspace}` : '') +
      '</env>'
  )

  // 工作区数据（每轮可变）
  if (includeScopeContext) {
    const contextSummary = await buildScopeContextSummary(scope)
    if (contextSummary) {
      parts.push(`<workspace_context scope="${scope}">\n${contextSummary}\n</workspace_context>`)
    }
  }

  // 当前会话持有的资源锁（持久轻量提醒）
  if (sessionId) {
    const locks = lockManager.listSessionLocks(scope, sessionId)
    if (locks.length > 0) {
      const lockLines = locks.map(
        (l) => `- ${l.resourceType}/${l.resourceId}${l.reason ? ` (${l.reason})` : ''}`
      )
      parts.push(
        '<active_locks>\n' +
          '当前会话已签出的资源：\n' +
          lockLines.join('\n') +
          '\n编辑完成后务必 checkin/release 释放锁。\n' +
          '</active_locks>'
      )
    }
  }

  // Skills（每个会话可能不同）
  if (activeSkillInstructions?.length) {
    for (const skill of activeSkillInstructions) {
      parts.push(`<skill name="${skill.name}">\n${skill.instructions}\n</skill>`)
    }
  }

  return parts.join('\n\n')
}
