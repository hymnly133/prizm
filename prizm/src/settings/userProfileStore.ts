/**
 * 按客户端（clientId）存储的用户画像：显示名称、希望的语气等。
 * 用于新手引导对话收集与 Agent 称呼/语气注入。
 */

import * as fs from 'fs'
import * as path from 'path'
import { getConfig } from '../config'
import { createLogger } from '../logger'

const log = createLogger('UserProfileStore')

export interface UserProfileEntry {
  /** 用户希望被称呼的名字（如「小明」） */
  displayName?: string
  /** 希望助手的语气（如「简洁专业」「友好随意」「中性克制」） */
  preferredTone?: string
}

const FILENAME = 'user_profiles.json'

function getFilePath(): string {
  const dataDir = getConfig().dataDir
  return path.join(dataDir, FILENAME)
}

let cache: Record<string, UserProfileEntry> | null = null

function load(): Record<string, UserProfileEntry> {
  if (cache) return cache
  const filePath = getFilePath()
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, UserProfileEntry>
    cache = typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    cache = {}
  }
  return cache
}

function save(data: Record<string, UserProfileEntry>): void {
  const filePath = getFilePath()
  const dataDir = path.dirname(filePath)
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    cache = data
  } catch (err) {
    log.warn('user profile save failed:', err)
    throw err
  }
}

/**
 * 获取指定客户端的用户画像（仅 displayName / preferredTone）
 */
export function getUserProfile(clientId: string): UserProfileEntry | null {
  if (!clientId?.trim()) return null
  const data = load()
  const entry = data[clientId.trim()]
  if (!entry || (entry.displayName === undefined && entry.preferredTone === undefined)) {
    return null
  }
  return { ...entry }
}

/**
 * 更新指定客户端的用户画像（部分更新）
 */
export function updateUserProfile(
  clientId: string,
  patch: Partial<UserProfileEntry>
): UserProfileEntry {
  if (!clientId?.trim()) {
    throw new Error('clientId is required')
  }
  const key = clientId.trim()
  const data = load()
  const current = data[key] ?? {}
  const next: UserProfileEntry = {
    displayName: patch.displayName !== undefined ? patch.displayName : current.displayName,
    preferredTone: patch.preferredTone !== undefined ? patch.preferredTone : current.preferredTone
  }
  data[key] = next
  save(data)
  return { ...next }
}
