/**
 * 用户级存储 - .prizm-data/users/{userId}/
 * Token 使用记录已迁移到 SQLite (tokenUsageDb.ts)
 */

import { getUserDir as getPathProviderUserDir } from './PathProviderCore'

export function getUserDir(userId: string): string {
  return getPathProviderUserDir(userId)
}
