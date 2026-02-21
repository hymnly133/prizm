/**
 * 工作流参数 Schema 解析 — 与总览「参数 Schema」、运行弹窗共用同一套逻辑
 *
 * 优先使用 def.args；若无则从 steps 的 prompt/input/condition/transform/approvePrompt 中解析 $args.xxx
 */
import type { WorkflowDef } from '@prizm/shared'

export interface WorkflowArgSchemaItem {
  key: string
  /** 默认值（无则为 undefined）。有 default 即可选，不填时用 default；默认为空即为可选 */
  default: unknown
  description: string
  /** 是否可选：由 default 推导，有 default（含空）即为 true */
  optional: boolean
}

export function getWorkflowArgsSchema(def: WorkflowDef | null): WorkflowArgSchemaItem[] | null {
  if (!def) return null

  if (def.args && Object.keys(def.args).length > 0) {
    return Object.entries(def.args).map(([key, val]) => ({
      key,
      default: val?.default,
      description: val?.description ?? '',
      optional: val?.default !== undefined
    }))
  }

  if (!def.steps?.length) return null
  const refs = new Set<string>()
  const pattern = /\$args\.([a-zA-Z_][a-zA-Z0-9_.]*)/g
  for (const step of def.steps) {
    const texts = [
      step.prompt,
      step.input,
      step.condition,
      step.transform,
      step.approvePrompt
    ].filter(Boolean) as string[]
    for (const t of texts) {
      let match
      while ((match = pattern.exec(t)) !== null) refs.add(match[1])
      pattern.lastIndex = 0
    }
  }
  if (refs.size === 0) return null
  return Array.from(refs).map((key) => ({
    key,
    default: undefined,
    description: '',
    optional: false
  }))
}
