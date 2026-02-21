/**
 * promptPipeline — 类型定义
 *
 * 场景 × 阶段 × 片段，与 cache 友好结构对齐（SESSION-STATIC / PER-TURN DYNAMIC）。
 */

import type { AgentSession } from '@prizm/shared'

/** 提示词场景：用于查配方、选片段 */
export type PromptScenario =
  | 'interactive'
  | 'background_task'
  | 'background_workflow_step'
  | 'tool_workflow_management'

/** 阶段：sessionStatic = messages[0]（会话内不变），perTurnDynamic = 消息末尾（每轮变化） */
export type PromptStage = 'sessionStatic' | 'sessionPreamble' | 'perTurnDynamic'

/** 片段 ID：每个对应一个建造器 */
export type SegmentId =
  | 'identity'
  | 'identity_workflow'
  | 'instructions'
  | 'rules'
  | 'env'
  | 'workflow_context'
  | 'workflow_management_context'
  | 'available_skills'
  | 'skills'
  | 'workspace_context'
  | 'active_locks'
  | 'memory_profile'
  | 'memory_context'
  | 'prompt_injection'
  | 'workflow_edit_context'
  | 'workflow_writing_spec'
  | 'caller_preamble'

/** 构建上下文：建造器只读，由 chatCore/adapter 侧组装 */
export interface PromptBuildContext {
  scope: string
  sessionId: string
  session: AgentSession | null
  scopeRoot: string
  includeScopeContext: boolean
  rulesContent?: string
  customRulesContent?: string
  /** 渐进式发现：仅 name+description，模型按需用 prizm_get_skill_instructions 拉取完整说明 */
  skillMetadataForDiscovery?: Array<{ name: string; description: string }>
  activeSkillInstructions?: Array<{ name: string; instructions: string }>
  /** 记忆系统消息文本（画像 + 上下文记忆），注入 perTurn */
  memoryTexts?: string[]
  /** 本轮命令注入（slash 等），注入 perTurn */
  promptInjection?: string
  grantedPaths?: string[]
  /** 仅 tool_workflow_management：当前工作流 YAML，用于 perTurn 的 <current_definition>（cache：不放入 static） */
  workflowEditContext?: string
  /** 由 BG/ToolLLM 传入的整块 preamble，按配方拼到 static 末尾 */
  callerPreamble?: string
}

/** 场景配方：各阶段包含的片段顺序及是否接受 callerPreamble */
export interface PromptRecipe {
  sessionStatic: SegmentId[]
  acceptCallerPreamble: boolean
  perTurnDynamic: SegmentId[]
}

/** 构建输出：与现有 SystemPromptParts 对齐，便于 adapter 直接使用 */
export interface PromptOutput {
  sessionStatic: string
  perTurnDynamic: string
}

/** 片段建造器：返回空字符串表示本场景下不产出该片段 */
export type SegmentBuilder = (
  ctx: PromptBuildContext,
  scenario: PromptScenario
) => Promise<string> | string
