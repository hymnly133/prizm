/**
 * promptPipeline — 系统提示词/注入框架
 *
 * 场景 × 阶段 × 片段：resolveScenario 解析场景，getRecipe 取配方，
 * buildPromptForScenario 按配方调用片段建造器，产出 sessionStatic 与 perTurnDynamic。
 * 与 cache 友好结构对齐：sessionStatic = messages[0]（会话内不变），perTurnDynamic = 消息末尾。
 *
 * 对外只导出 build、resolveScenario、context 构建及类型，供 chatCore/adapter 使用。
 */

export type {
  PromptScenario,
  PromptStage,
  SegmentId,
  PromptBuildContext,
  PromptRecipe,
  PromptOutput,
  SegmentBuilder
} from './types'

export { resolveScenario } from './scenario'
export { buildPromptContext, type PromptContextInput } from './context'
export { buildPromptForScenario } from './build'
export { getRecipe } from './recipe'
