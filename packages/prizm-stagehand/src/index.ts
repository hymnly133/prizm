/**
 * @prizm/prizm-stagehand
 *
 * Stagehand 的 Prizm 集成层：通过 CDP URL（relay）连接已有浏览器，
 * 复用 Stagehand 的 act/observe/extract，模型配置由 Prizm 服务端提供。
 */

export type {
  PrizmStagehandAction,
  PrizmStagehandActOptions,
  PrizmStagehandActResult,
  PrizmStagehandGotoOptions,
  PrizmStagehandModelConfig,
  PrizmStagehandObserveOptions,
  PrizmStagehandSession,
  PrizmStagehandSessionOptions
} from './types'
export { createPrizmStagehandSession } from './session'
