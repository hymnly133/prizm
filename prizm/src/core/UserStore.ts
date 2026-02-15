/**
 * 用户级存储 - .prizm-data/users/{userId}/
 * 与 scopes/ 分离，用于 token 使用记录及后续用户数据
 */

import * as mdStore from './mdStore'
import type { TokenUsageRecord } from '../types'
import { getUserDir as getPathProviderUserDir } from './PathProviderCore'

export function getUserDir(userId: string): string {
  return getPathProviderUserDir(userId)
}

export function readUserTokenUsage(userId: string): TokenUsageRecord[] {
  const dir = getUserDir(userId)
  return mdStore.readTokenUsage(dir)
}

export function writeUserTokenUsage(userId: string, records: TokenUsageRecord[]): void {
  const dir = getUserDir(userId)
  mdStore.writeTokenUsage(dir, records)
}
