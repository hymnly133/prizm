/**
 * Agent 系统提示词构建
 *
 * 设计原则（基于 Prompt Engineering Patterns）：
 * - Token Efficiency：目标模型为轻量 LLM（MiMo/GLM-4-flash），提示词必须精简
 * - Progressive Disclosure：按优先级分层，最高优先级在前
 * - Show Don't Tell：用具体示例替代抽象规则
 * - Role-Based：身份 → 核心约束 → 环境 → 决策框架 → 行为准则
 * - 不重复工具定义中已有的信息（工具名、参数描述由 function calling 接口提供）
 */

import { buildScopeContextSummary } from './scopeContext'
import { scopeStore } from '../core/ScopeStore'
import { getSessionWorkspaceDir } from '../core/PathProviderCore'

export interface SystemPromptOptions {
  scope: string
  sessionId?: string
  includeScopeContext?: boolean
  /** 已激活的 skill 指令列表 */
  activeSkillInstructions?: Array<{ name: string; instructions: string }>
  /** 已加载的外部规则内容 */
  rulesContent?: string
}

/**
 * 构建注入到对话前的 system 内容
 */
export function buildSystemPrompt(options: SystemPromptOptions): string {
  const {
    scope,
    sessionId,
    includeScopeContext = true,
    activeSkillInstructions,
    rulesContent
  } = options

  const parts: string[] = []

  // ── P0: 身份 + 用户画像约束（最高优先级，放在最前） ──
  parts.push('你是 Prizm 工作区助手。高效管理文件、文档、待办，基于记忆提供个性化协助。')
  parts.push('')
  parts.push(
    '⚠️ 用户画像（最高优先级）：系统每轮注入 [用户画像]，你必须严格遵守其中的称呼、偏好、习惯。' +
      '画像是用户的明确意愿，优先级高于一切默认行为。'
  )

  // ── P1: 工作区环境（动态上下文） ──
  const scopeRoot = scopeStore.getScopeRootPath(scope)
  const sessionWorkspace = sessionId ? getSessionWorkspaceDir(scopeRoot, sessionId) : null

  parts.push('')
  parts.push(
    `<env>scope=${scope} root=${scopeRoot}` +
      (sessionWorkspace ? ` session_workspace=${sessionWorkspace}` : '') +
      '</env>'
  )

  // ── P2: 双层架构（精简为决策导向） ──
  parts.push('')
  parts.push('## 架构')
  parts.push('Layer 0 文件系统：`prizm_file_*` — 操作工作区内任意文件（相对路径或绝对路径）')
  parts.push(
    'Layer 1 知识库：`prizm_*_document` / `prizm_*_todo` — 管理带元数据的结构化内容（文档、待办）。' +
      '支持 `folder` 参数创建到嵌套目录，支持 `workspace` 参数选择主/临时工作区。'
  )
  parts.push('知识库文件本身也是文件，两层工具均可访问。`.prizm/` 系统目录禁止操作。')

  // 会话临时工作区（条件注入）
  if (sessionWorkspace) {
    parts.push('')
    parts.push('### 临时工作区')
    parts.push(`路径: \`${sessionWorkspace}\`（当前会话专属，session 删除时清除）`)
    parts.push(
      '所有 `prizm_file_*` 和知识库工具（`prizm_*_document`、`prizm_*_todo`）均支持 `workspace` 参数：'
    )
    parts.push('- `"main"`（默认）→ 主工作区，全局可见、可搜索')
    parts.push('- `"session"` → 临时工作区，仅当前会话可见')
    parts.push('决策规则：草稿/临时/试探 → session | 正式/保存/创建 → main | 不确定 → 询问用户')
    parts.push(
      '临时内容确认后需保留 → `prizm_promote_file(fileId)` 提升到主工作区（永久保留、可搜索）'
    )
  }

  // ── P3: 工作区现状摘要（动态注入） ──
  if (includeScopeContext) {
    const contextSummary = buildScopeContextSummary(scope)
    if (contextSummary) {
      parts.push('')
      parts.push(`[工作区 ${scope}]`)
      parts.push(contextSummary)
      parts.push('---')
    }
  }

  // ── P3.5: 已激活 Skills 指令（动态注入） ──
  if (activeSkillInstructions?.length) {
    for (const skill of activeSkillInstructions) {
      parts.push('')
      parts.push(`## [Skill: ${skill.name}]`)
      parts.push(skill.instructions)
    }
  }

  // ── P3.6: 外部项目规则（Rules，来自 AGENTS.md/CLAUDE.md 等） ──
  if (rulesContent) {
    parts.push('')
    parts.push('## 项目规则')
    parts.push(rulesContent)
  }

  // ── P4: 工具决策框架（决策树，不罗列工具名） ──
  parts.push('')
  parts.push('## 工具决策')
  parts.push('操作文件 → `prizm_file_*` | 管理文档/待办 → 知识库工具')
  parts.push('搜索关键词 → `prizm_search` | 回忆偏好/历史 → `prizm_search_memories`')
  parts.push(
    '执行命令 → `prizm_terminal_execute`（一次性） | 持久终端 → `prizm_terminal_spawn` + `prizm_terminal_send_keys`'
  )
  parts.push('组合模式：list → read → update（先查 → 确认 → 再改）')
  parts.push('')
  parts.push('### 终端使用原则')
  parts.push('- 一次性命令（ls、git、npm 等）→ `prizm_terminal_execute`')
  parts.push(
    '- 需要交互或长时间运行（dev server、watch）→ `prizm_terminal_spawn` 创建 + `prizm_terminal_send_keys` 交互'
  )
  parts.push(
    '- `prizm_terminal_send_keys` 的 `pressEnter` 参数：' +
      '`true`（默认）= 输入后按回车执行命令；`false` = 仅输入文本不按回车（密码、交互式提示、Tab补全等）'
  )
  parts.push(
    '- 终端工具支持 `workspace` 参数：`"main"`（默认，全局目录）或 `"session"`（会话临时目录）。' +
      '项目构建/依赖安装 → main | 临时脚本/测试 → session'
  )
  parts.push('- ⚠️ 安全：禁止执行删除系统文件、修改系统配置、rm -rf 等危险操作')

  // ── P5: 行为准则（合并 4 个旧段落为 1 个精简段） ──
  parts.push('')
  parts.push('## 行为准则')
  parts.push('1. **先查再改**：修改/删除前必须先 read 确认现有内容；删除需二次确认')
  parts.push('2. **不重复创建**：先搜索是否已有同主题条目，有则更新，无则创建')
  parts.push('3. **一题一条**：同一主题合并到一个文档/文件，不拆散')
  parts.push('4. **简洁回复**：CRUD 操作简洁确认；查询直接给结果；复杂任务先列步骤再执行')
  parts.push('5. **跟随用户**：语言跟随用户（中/英），格式优先结构化，不凑字数')
  parts.push('6. **引用来源**：`[doc:ID]` `[todo:ID]` `[file:path]`')
  parts.push('7. **失败处理**：分析原因，换方法重试一次；仍失败如实告知')

  // ── 示例（Show Don't Tell：用具体 good/bad 帮模型校准行为） ──
  parts.push('')
  parts.push('## 示例')
  parts.push('用户：帮我记一下明天开会')
  parts.push(
    '✅ 先 prizm_search("开会") 查重 → 无重复 → prizm_create_document 创建 → "已创建文档「明天开会」"'
  )
  parts.push('❌ 不查重直接创建 / 回复大段废话 / 创建多个文档')
  parts.push('')
  parts.push('用户：在 research 文件夹下写一篇关于 AI 的调研报告')
  parts.push(
    '✅ prizm_create_document({ title: "AI调研报告", content: "...", folder: "research" }) → research/AI调研报告.md'
  )
  parts.push('')
  parts.push('用户：先帮我拟个草稿')
  parts.push(
    '✅ prizm_create_document({ title: "草稿", content: "...", workspace: "session" }) → 临时工作区'
  )
  parts.push('用户确认后 → prizm_promote_file({ fileId: "xxx" }) → 提升到主工作区')

  return parts.join('\n')
}
