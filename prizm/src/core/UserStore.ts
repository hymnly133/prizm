/**
 * 用户级存储 - .prizm-data/users/{userId}/
 * 与 scopes/ 分离，用于 token 使用记录及后续用户数据
 */

import path from 'path'
import { getConfig } from '../config'
import * as mdStore from './mdStore'
import type { TokenUsageRecord } from '../types'

const USERS_DIR = 'users'

function getDataDir(): string {
  return getConfig().dataDir
}

function getUsersDir(): string {
  return path.join(getDataDir(), USERS_DIR)
}

function safeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'anonymous'
}

export function getUserDir(userId: string): string {
  return path.join(getUsersDir(), safeUserId(userId))
}

export function readUserTokenUsage(userId: string): TokenUsageRecord[] {
  const dir = getUserDir(userId)
  return mdStore.readTokenUsage(dir)
}

export function writeUserTokenUsage(userId: string, records: TokenUsageRecord[]): void {
  const dir = getUserDir(userId)
  mdStore.writeTokenUsage(dir, records)
}
