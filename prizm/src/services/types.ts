/**
 * Service Layer 公共类型
 */

import type { OperationActor } from '@prizm/shared'

export type { OperationActor }

/** 操作上下文 — 贯穿 Service 方法的统一参数 */
export interface OperationContext {
  scope: string
  actor: OperationActor
}
