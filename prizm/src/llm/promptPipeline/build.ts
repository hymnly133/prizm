/**
 * promptPipeline — 按场景构建提示词
 *
 * 根据配方顺序调用片段建造器，产出 sessionStatic 与 perTurnDynamic，
 * 与现有 cache 友好结构对齐（messages[0]=SESSION-STATIC，末尾=PER-TURN DYNAMIC）。
 */

import type { PromptBuildContext, PromptOutput, PromptScenario, SegmentId } from './types'
import { getRecipe } from './recipe'
import { SEGMENT_BUILDERS } from './segments'

/**
 * 运行单个片段建造器，返回非空字符串或空串。
 */
async function runSegment(
  segmentId: SegmentId,
  ctx: PromptBuildContext,
  scenario: PromptScenario
): Promise<string> {
  const builder = SEGMENT_BUILDERS[segmentId]
  if (!builder) return ''
  const result = builder(ctx, scenario)
  const text = typeof result === 'string' ? result : await result
  return text?.trim() ?? ''
}

/**
 * 按场景与配方构建提示词。
 * 同一会话内相同 context（不含 perTurn 数据）时，sessionStatic 不变，满足 cache。
 */
export async function buildPromptForScenario(
  scenario: PromptScenario,
  ctx: PromptBuildContext
): Promise<PromptOutput> {
  const recipe = getRecipe(scenario)

  const staticParts: string[] = []
  for (const segmentId of recipe.sessionStatic) {
    const block = await runSegment(segmentId, ctx, scenario)
    if (block) staticParts.push(block)
  }
  if (recipe.acceptCallerPreamble && ctx.callerPreamble?.trim()) {
    staticParts.push(ctx.callerPreamble.trim())
  }

  const dynamicParts: string[] = []
  for (const segmentId of recipe.perTurnDynamic) {
    const block = await runSegment(segmentId, ctx, scenario)
    if (block) dynamicParts.push(block)
  }

  return {
    sessionStatic: staticParts.join('\n\n'),
    perTurnDynamic: dynamicParts.join('\n\n')
  }
}
