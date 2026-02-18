/**
 * Checkpoint Store — 会话回退点存储
 *
 * 设计：
 * - Checkpoint 元数据存于 AgentSession.checkpoints[]（随 session 一起通过 mdStore 持久化）
 * - 文件快照单独存储于 {scopeRoot}/.prizm/checkpoints/{sessionId}/{checkpointId}.json
 *   避免 session 文件体积膨胀
 *
 * 回退流程：
 * 1. 根据 checkpoint.messageIndex 截断 session.messages
 * 2. 从快照文件恢复被修改的文件内容
 * 3. 删除该 checkpoint 之后的所有 checkpoint
 */

import fs from 'fs'
import path from 'path'
import { getPrizmDir } from './PathProviderCore'
import { createLogger } from '../logger'
import { genUniqueId } from '../id'
import type { SessionCheckpoint, CheckpointFileChange } from '../types'

const log = createLogger('CheckpointStore')

const CHECKPOINTS_DIR = 'checkpoints'

/**
 * 运行时缓冲：per-session 文件快照收集器。
 * chat 路由创建 checkpoint 时初始化，工具写文件前自动 capture，
 * chat 结束后由路由取回并保存到磁盘。
 * Key: sessionId, Value: { path → previousContent }
 */
const _sessionFileSnapshots = new Map<string, Map<string, string>>()

/** 初始化会话快照收集器（每轮对话前调用） */
export function initSnapshotCollector(sessionId: string): void {
  _sessionFileSnapshots.set(sessionId, new Map())
}

/** 工具写文件前调用：如果是首次写入该路径，记录当前内容 */
export function captureFileSnapshot(sessionId: string, relativePath: string, currentContent: string | null): void {
  const collector = _sessionFileSnapshots.get(sessionId)
  if (!collector) return
  if (collector.has(relativePath)) return
  collector.set(relativePath, currentContent ?? '')
}

/** 取回并清空会话快照（对话完成后调用） */
export function flushSnapshotCollector(sessionId: string): Record<string, string> {
  const collector = _sessionFileSnapshots.get(sessionId)
  _sessionFileSnapshots.delete(sessionId)
  if (!collector || collector.size === 0) return {}
  return Object.fromEntries(collector)
}

/** 文件快照结构 */
interface CheckpointSnapshot {
  checkpointId: string
  sessionId: string
  /** path → previousContent 映射 */
  fileSnapshots: Record<string, string>
}

function getCheckpointDir(scopeRoot: string, sessionId: string): string {
  return path.join(getPrizmDir(scopeRoot), CHECKPOINTS_DIR, sessionId)
}

function getSnapshotPath(scopeRoot: string, sessionId: string, checkpointId: string): string {
  const safe = checkpointId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown'
  return path.join(getCheckpointDir(scopeRoot, sessionId), `${safe}.json`)
}

/** 创建 checkpoint（在每轮对话前调用） */
export function createCheckpoint(
  sessionId: string,
  messageIndex: number,
  userMessage: string
): SessionCheckpoint {
  return {
    id: genUniqueId(),
    sessionId,
    messageIndex,
    userMessage,
    createdAt: Date.now(),
    fileChanges: [],
    completed: false
  }
}

/** 完成 checkpoint（对话轮次结束后调用，记录文件变更） */
export function completeCheckpoint(
  checkpoint: SessionCheckpoint,
  fileChanges: CheckpointFileChange[]
): SessionCheckpoint {
  return {
    ...checkpoint,
    fileChanges,
    completed: true
  }
}

/** 保存文件快照到磁盘 */
export function saveFileSnapshots(
  scopeRoot: string,
  sessionId: string,
  checkpointId: string,
  snapshots: Record<string, string>
): void {
  if (Object.keys(snapshots).length === 0) return
  const dir = getCheckpointDir(scopeRoot, sessionId)
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const data: CheckpointSnapshot = {
      checkpointId,
      sessionId,
      fileSnapshots: snapshots
    }
    const filePath = getSnapshotPath(scopeRoot, sessionId, checkpointId)
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf8')
    log.info('Saved file snapshots: checkpoint=%s files=%d', checkpointId, Object.keys(snapshots).length)
  } catch (e) {
    log.warn('Failed to save file snapshots:', checkpointId, e)
  }
}

/** 读取文件快照 */
export function loadFileSnapshots(
  scopeRoot: string,
  sessionId: string,
  checkpointId: string
): Record<string, string> {
  const filePath = getSnapshotPath(scopeRoot, sessionId, checkpointId)
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8')
      const data = JSON.parse(raw) as CheckpointSnapshot
      return data.fileSnapshots ?? {}
    }
  } catch (e) {
    log.warn('Failed to load file snapshots:', checkpointId, e)
  }
  return {}
}

/** 删除 checkpoint 快照文件 */
export function deleteCheckpointSnapshots(
  scopeRoot: string,
  sessionId: string,
  checkpointIds: string[]
): void {
  for (const cpId of checkpointIds) {
    const filePath = getSnapshotPath(scopeRoot, sessionId, cpId)
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch (e) {
      log.warn('Failed to delete snapshot file:', cpId, e)
    }
  }
}

/** 删除整个会话的 checkpoint 快照目录 */
export function deleteSessionCheckpoints(scopeRoot: string, sessionId: string): void {
  const dir = getCheckpointDir(scopeRoot, sessionId)
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      log.info('Deleted checkpoint dir for session:', sessionId)
    }
  } catch (e) {
    log.warn('Failed to delete session checkpoint dir:', sessionId, e)
  }
}

/**
 * 从工具调用消息中提取文件变更列表。
 * 分析 assistant 消息的 tool parts，识别写入/移动/删除操作。
 */
export function extractFileChangesFromMessages(
  messages: Array<{ parts: Array<{ type: string; name?: string; arguments?: string; result?: string; isError?: boolean }> }>
): CheckpointFileChange[] {
  const changes: CheckpointFileChange[] = []
  const seen = new Set<string>()

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type !== 'tool' || part.isError) continue
      try {
        const args = part.arguments ? JSON.parse(part.arguments) : {}
        let change: CheckpointFileChange | null = null

        switch (part.name) {
          case 'prizm_file_write':
            change = {
              path: args.path ?? '',
              action: 'created'
            }
            break
          case 'prizm_file_move':
            change = {
              path: args.to ?? '',
              action: 'moved',
              fromPath: args.from
            }
            break
          case 'prizm_file_delete':
            change = { path: args.path ?? '', action: 'deleted' }
            break
          case 'prizm_create_document':
            change = { path: `[doc] ${args.title ?? ''}`, action: 'created' }
            break
          case 'prizm_update_document':
            change = { path: `[doc] ${args.id ?? ''}`, action: 'modified' }
            break
          case 'prizm_delete_document':
            change = { path: `[doc] ${args.id ?? ''}`, action: 'deleted' }
            break
        }

        if (change && change.path && !seen.has(change.path)) {
          seen.add(change.path)
          changes.push(change)
        }
      } catch {
        // JSON parse failure — skip
      }
    }
  }

  return changes
}
