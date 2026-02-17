/**
 * Session sub-files: activities.json
 * Token usage 已迁移到 SQLite (tokenUsageDb.ts)，此文件仅保留 activities 相关函数。
 */

import fs from 'fs'
import path from 'path'
import { getSessionActivitiesPath } from '../PathProviderCore'
import { ensureDir } from './utils'

// ============ Session sub-files: activities.json ============

export function readSessionActivities(
  scopeRoot: string,
  sessionId: string
): Array<Record<string, unknown>> {
  const fp = getSessionActivitiesPath(scopeRoot, sessionId)
  if (!fs.existsSync(fp)) return []
  try {
    const raw = fs.readFileSync(fp, 'utf-8')
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function appendSessionActivities(
  scopeRoot: string,
  sessionId: string,
  activities: unknown[]
): void {
  const existing = readSessionActivities(scopeRoot, sessionId)
  const merged = [...existing, ...activities]
  const fp = getSessionActivitiesPath(scopeRoot, sessionId)
  ensureDir(path.dirname(fp))
  fs.writeFileSync(fp, JSON.stringify(merged, null, 2), 'utf-8')
}
