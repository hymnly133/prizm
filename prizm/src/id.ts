/**
 * 唯一 ID 生成 - 使用 crypto.randomUUID 避免碰撞
 */

import { randomUUID } from 'node:crypto'

/** 生成全局唯一的 ID，适用于 TodoItem、Note 等实体 */
export function genUniqueId(): string {
  return randomUUID()
}
