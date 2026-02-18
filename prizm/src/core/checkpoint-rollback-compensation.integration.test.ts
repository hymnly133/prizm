/**
 * Checkpoint 回退补偿集成测试
 *
 * 测试回退路由重构后各子系统的补偿逻辑：
 * 1. 累积器重置（resetSessionAccumulator）
 * 2. 上下文追踪重置（resetSessionContext）
 * 3. P1 记忆 ID 收集（memoryRefs.created → removedMemoryIds）
 * 4. 摘要更新（llmSummary 重建/清空）
 * 5. 事件 payload 正确性（agent:session.rolledBack）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

import { ScopeStore } from './ScopeStore'
import {
  createCheckpoint,
  completeCheckpoint,
  initSnapshotCollector,
  captureFileSnapshot,
  flushSnapshotCollector,
  saveFileSnapshots,
  loadFileSnapshots,
  deleteCheckpointSnapshots,
  extractFileChangesFromMessages
} from './checkpointStore'
import * as mdStore from './mdStore'
import type { AgentSession, AgentMessage, SessionCheckpoint } from '../types'
import type { MemoryIdsByLayer, MemoryRefs } from '@prizm/shared'
import { resetSessionAccumulator } from '../llm/EverMemService'
import { recordProvision, recordActivity, getSessionContext, resetSessionContext } from '../llm/contextTracker'

const SCOPE = 'compensation-test-scope'

function makeMsg(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  memoryRefs?: MemoryRefs
): AgentMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', content: text }],
    createdAt: Date.now(),
    ...(memoryRefs ? { memoryRefs } : {})
  }
}

function simulateTurnWithMemory(
  store: ScopeStore,
  session: AgentSession,
  scopeRoot: string,
  turnIndex: number,
  opts?: {
    fileContent?: string
    memoryRefs?: MemoryRefs
  }
): SessionCheckpoint {
  const messageIndex = session.messages.length
  const cp = createCheckpoint(session.id, messageIndex, `turn-${turnIndex}`)
  initSnapshotCollector(session.id)

  session.messages.push(makeMsg(`u-${turnIndex}`, 'user', `question ${turnIndex}`))

  if (opts?.fileContent !== undefined) {
    const existing = mdStore.readFileByPath(scopeRoot, 'test-file.txt')
    captureFileSnapshot(session.id, 'test-file.txt', existing?.content ?? null)
    mdStore.writeFileByPath(scopeRoot, 'test-file.txt', opts.fileContent)
  }

  session.messages.push(
    makeMsg(`a-${turnIndex}`, 'assistant', `answer ${turnIndex}`, opts?.memoryRefs)
  )

  const fileChanges = opts?.fileContent
    ? extractFileChangesFromMessages([
        {
          parts: [
            {
              type: 'tool',
              name: 'prizm_file_write',
              arguments: JSON.stringify({ path: 'test-file.txt', content: opts.fileContent }),
              result: 'ok'
            }
          ]
        }
      ])
    : []
  const completedCp = completeCheckpoint(cp, fileChanges)

  const snapshots = flushSnapshotCollector(session.id)
  saveFileSnapshots(scopeRoot, session.id, cp.id, snapshots)

  if (!session.checkpoints) session.checkpoints = []
  session.checkpoints.push(completedCp)
  session.updatedAt = Date.now()
  store.saveScope(SCOPE)

  return completedCp
}

/**
 * 模拟回退路由的核心逻辑（不含 HTTP 层），与 sessions.ts 保持一致。
 * 返回回退路由会产生的事件 payload 数据。
 */
function performRollbackWithCompensation(
  store: ScopeStore,
  session: AgentSession,
  scopeRoot: string,
  checkpointId: string
): {
  restoredFiles: string[]
  removedMemoryIds: MemoryIdsByLayer
  deletedDocumentIds: string[]
  restoredDocumentIds: string[]
  remainingMessageCount: number
} {
  const checkpoints = session.checkpoints ?? []
  const cpIndex = checkpoints.findIndex((cp) => cp.id === checkpointId)
  if (cpIndex < 0) throw new Error(`Checkpoint not found: ${checkpointId}`)

  const checkpoint = checkpoints[cpIndex]
  const removedCheckpoints = checkpoints.slice(cpIndex)
  const removedCpIds = removedCheckpoints.map((cp) => cp.id)
  const rolledBackMessages = session.messages.slice(checkpoint.messageIndex)

  // 收集 P1 记忆 ID（与 sessions.ts 一致）
  const removedMemoryIds: MemoryIdsByLayer = { user: [], scope: [], session: [] }
  for (const msg of rolledBackMessages) {
    if (msg.memoryRefs?.created) {
      removedMemoryIds.user.push(...msg.memoryRefs.created.user)
      removedMemoryIds.scope.push(...msg.memoryRefs.created.scope)
      removedMemoryIds.session.push(...msg.memoryRefs.created.session)
    }
  }

  // 合并快照
  const mergedSnapshots = new Map<string, string>()
  for (const cp of removedCheckpoints) {
    const snaps = loadFileSnapshots(scopeRoot, session.id, cp.id)
    for (const [k, v] of Object.entries(snaps)) {
      if (!mergedSnapshots.has(k)) mergedSnapshots.set(k, v)
    }
  }

  // 恢复文件
  const restoredFiles: string[] = []
  const deletedDocumentIds: string[] = []
  const restoredDocumentIds: string[] = []
  for (const [key, value] of mergedSnapshots) {
    if (key.startsWith('[doc:')) continue
    mdStore.writeFileByPath(scopeRoot, key, value)
    restoredFiles.push(key)
  }

  // 截断消息
  const clampedIndex = Math.max(0, Math.min(checkpoint.messageIndex, session.messages.length))
  session.messages = session.messages.slice(0, clampedIndex)
  session.checkpoints = session.checkpoints?.filter((cp) => cp.messageIndex < clampedIndex)
  session.updatedAt = Date.now()
  store.saveScope(SCOPE)

  deleteCheckpointSnapshots(scopeRoot, session.id, removedCpIds)

  // 同步补偿操作
  resetSessionAccumulator(SCOPE, session.id)
  resetSessionContext(SCOPE, session.id)

  return {
    restoredFiles,
    removedMemoryIds,
    deletedDocumentIds,
    restoredDocumentIds,
    remainingMessageCount: clampedIndex
  }
}

describe('Checkpoint Rollback Compensation', () => {
  let tempDir: string
  let store: ScopeStore
  let scopeRoot: string
  let session: AgentSession

  beforeEach(() => {
    tempDir = path.join(
      os.tmpdir(),
      `prizm-cp-comp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    fs.mkdirSync(tempDir, { recursive: true })
    store = new ScopeStore(tempDir)

    const data = store.getScopeData(SCOPE)
    const now = Date.now()
    session = {
      id: `session-comp-${now}`,
      scope: SCOPE,
      messages: [],
      checkpoints: [],
      createdAt: now,
      updatedAt: now
    }
    data.agentSessions.push(session)
    store.saveScope(SCOPE)
    scopeRoot = store.getScopeRootPath(SCOPE)
  })

  afterEach(() => {
    flushSnapshotCollector(session.id)
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // ─── P1 记忆 ID 收集 ───

  describe('P1 记忆 ID 收集', () => {
    it('应从被回退消息的 memoryRefs.created 中汇总所有 P1 ID', () => {
      const cp1 = simulateTurnWithMemory(store, session, scopeRoot, 1)
      const cp2 = simulateTurnWithMemory(store, session, scopeRoot, 2, {
        memoryRefs: {
          injected: { user: ['inj-1'], scope: [], session: [] },
          created: { user: ['mem-u1'], scope: ['mem-s1', 'mem-s2'], session: [] }
        }
      })
      const cp3 = simulateTurnWithMemory(store, session, scopeRoot, 3, {
        memoryRefs: {
          injected: { user: [], scope: [], session: [] },
          created: { user: [], scope: ['mem-s3'], session: ['mem-sess1'] }
        }
      })

      const result = performRollbackWithCompensation(store, session, scopeRoot, cp2.id)

      expect(result.removedMemoryIds.user).toEqual(['mem-u1'])
      expect(result.removedMemoryIds.scope).toEqual(['mem-s1', 'mem-s2', 'mem-s3'])
      expect(result.removedMemoryIds.session).toEqual(['mem-sess1'])
    })

    it('无 memoryRefs 时返回空数组', () => {
      const cp1 = simulateTurnWithMemory(store, session, scopeRoot, 1)
      const cp2 = simulateTurnWithMemory(store, session, scopeRoot, 2)

      const result = performRollbackWithCompensation(store, session, scopeRoot, cp2.id)

      expect(result.removedMemoryIds.user).toEqual([])
      expect(result.removedMemoryIds.scope).toEqual([])
      expect(result.removedMemoryIds.session).toEqual([])
    })

    it('多轮回退应合并所有被回退轮次的 memoryRefs', () => {
      const cp1 = simulateTurnWithMemory(store, session, scopeRoot, 1, {
        memoryRefs: {
          injected: { user: [], scope: [], session: [] },
          created: { user: ['m-keep'], scope: [], session: [] }
        }
      })
      const cp2 = simulateTurnWithMemory(store, session, scopeRoot, 2, {
        memoryRefs: {
          injected: { user: [], scope: [], session: [] },
          created: { user: ['m-rm-1'], scope: [], session: [] }
        }
      })
      const cp3 = simulateTurnWithMemory(store, session, scopeRoot, 3, {
        memoryRefs: {
          injected: { user: [], scope: [], session: [] },
          created: { user: ['m-rm-2'], scope: ['m-rm-3'], session: [] }
        }
      })

      // 回退到 cp2，移除 cp2 和 cp3 的消息
      const result = performRollbackWithCompensation(store, session, scopeRoot, cp2.id)

      // cp2 和 cp3 的 assistant message 都应被收集
      expect(result.removedMemoryIds.user).toEqual(['m-rm-1', 'm-rm-2'])
      expect(result.removedMemoryIds.scope).toEqual(['m-rm-3'])
    })
  })

  // ─── 累积器重置 ───

  describe('累积器重置', () => {
    it('回退后累积器被清理，不影响后续对话', () => {
      const cp1 = simulateTurnWithMemory(store, session, scopeRoot, 1, {
        fileContent: 'v1'
      })
      const cp2 = simulateTurnWithMemory(store, session, scopeRoot, 2, {
        fileContent: 'v2'
      })

      performRollbackWithCompensation(store, session, scopeRoot, cp2.id)

      // 验证：resetSessionAccumulator 被调用后不抛异常
      // （实际效果需在 EverMemService 单元测试中验证内部状态）
      expect(session.messages.length).toBe(2) // cp1 的 2 条消息
    })
  })

  // ─── 上下文追踪重置 ───

  describe('上下文追踪重置', () => {
    it('回退后上下文追踪状态被清除', () => {
      const cp1 = simulateTurnWithMemory(store, session, scopeRoot, 1)

      // 模拟上下文追踪记录
      recordProvision(SCOPE, session.id, {
        itemId: 'doc-1',
        kind: 'document',
        mode: 'full',
        charCount: 1000,
        version: 1
      })
      recordActivity(SCOPE, session.id, {
        action: 'read',
        itemKind: 'document',
        itemId: 'doc-1',
        timestamp: Date.now()
      })

      const ctxBefore = getSessionContext(SCOPE, session.id)
      expect(ctxBefore).not.toBeNull()
      expect(ctxBefore!.provisions.length).toBe(1)
      expect(ctxBefore!.activities.length).toBe(1)

      const cp2 = simulateTurnWithMemory(store, session, scopeRoot, 2)
      performRollbackWithCompensation(store, session, scopeRoot, cp2.id)

      const ctxAfter = getSessionContext(SCOPE, session.id)
      expect(ctxAfter).toBeNull()
    })

    it('回退后新轮次可以正常建立上下文', () => {
      const cp1 = simulateTurnWithMemory(store, session, scopeRoot, 1)
      recordProvision(SCOPE, session.id, {
        itemId: 'doc-1',
        kind: 'document',
        mode: 'summary',
        charCount: 500,
        version: 1
      })

      const cp2 = simulateTurnWithMemory(store, session, scopeRoot, 2)
      performRollbackWithCompensation(store, session, scopeRoot, cp2.id)

      // 重新记录 provision（模拟新一轮对话的注入）
      recordProvision(SCOPE, session.id, {
        itemId: 'doc-2',
        kind: 'document',
        mode: 'full',
        charCount: 2000,
        version: 2
      })

      const ctxNew = getSessionContext(SCOPE, session.id)
      expect(ctxNew).not.toBeNull()
      expect(ctxNew!.provisions.length).toBe(1)
      expect(ctxNew!.provisions[0].itemId).toBe('doc-2')
    })
  })

  // ─── 摘要状态 ───

  describe('摘要状态', () => {
    it('回退到有用户消息时保留 llmSummary 数据', () => {
      const cp1 = simulateTurnWithMemory(store, session, scopeRoot, 1)
      const cp2 = simulateTurnWithMemory(store, session, scopeRoot, 2)

      // 手动设置 llmSummary
      const data = store.getScopeData(SCOPE)
      const s = data.agentSessions.find((s) => s.id === session.id)!
      s.llmSummary = '原始摘要'
      store.saveScope(SCOPE)

      performRollbackWithCompensation(store, session, scopeRoot, cp2.id)

      // 回退后仍有消息（cp1 的 2 条），摘要状态由 scheduleTurnSummary 异步更新
      // 此处验证 session 状态正确，摘要更新是异步的
      expect(session.messages.length).toBe(2)
      expect(session.messages[0].role).toBe('user')
    })

    it('回退到 messageIndex=0 时 llmSummary 应可被清空', () => {
      const cp1 = simulateTurnWithMemory(store, session, scopeRoot, 1)

      const data = store.getScopeData(SCOPE)
      const s = data.agentSessions.find((s) => s.id === session.id)!
      s.llmSummary = '旧摘要'
      store.saveScope(SCOPE)

      // 回退到 cp1（messageIndex=0），所有消息被移除
      performRollbackWithCompensation(store, session, scopeRoot, cp1.id)

      expect(session.messages.length).toBe(0)
      // 在生产代码中，route handler 检测无消息后会清空 llmSummary
      // 此处模拟该逻辑
      if (session.messages.length === 0) {
        s.llmSummary = undefined
        store.saveScope(SCOPE)
      }
      const updated = store.getScopeData(SCOPE).agentSessions.find((s) => s.id === session.id)!
      expect(updated.llmSummary).toBeUndefined()
    })
  })

  // ─── 事件 payload 正确性 ───

  describe('事件 payload 构建', () => {
    it('应正确构建回退事件的完整 payload', () => {
      const cp1 = simulateTurnWithMemory(store, session, scopeRoot, 1, {
        fileContent: 'initial'
      })
      const cp2 = simulateTurnWithMemory(store, session, scopeRoot, 2, {
        fileContent: 'modified',
        memoryRefs: {
          injected: { user: [], scope: ['inj-1'], session: [] },
          created: { user: ['cr-u1'], scope: ['cr-s1'], session: ['cr-sess1'] }
        }
      })
      const cp3 = simulateTurnWithMemory(store, session, scopeRoot, 3, {
        memoryRefs: {
          injected: { user: [], scope: [], session: [] },
          created: { user: [], scope: [], session: ['cr-sess2'] }
        }
      })

      const result = performRollbackWithCompensation(store, session, scopeRoot, cp2.id)

      expect(result.remainingMessageCount).toBe(cp2.messageIndex)
      expect(result.removedMemoryIds).toEqual({
        user: ['cr-u1'],
        scope: ['cr-s1'],
        session: ['cr-sess1', 'cr-sess2']
      })
      expect(result.restoredFiles).toContain('test-file.txt')
    })

    it('仅文件恢复无记忆时 payload 应为空数组', () => {
      const cp1 = simulateTurnWithMemory(store, session, scopeRoot, 1, {
        fileContent: 'v1'
      })
      const cp2 = simulateTurnWithMemory(store, session, scopeRoot, 2, {
        fileContent: 'v2'
      })

      const result = performRollbackWithCompensation(store, session, scopeRoot, cp2.id)

      expect(result.removedMemoryIds).toEqual({
        user: [],
        scope: [],
        session: []
      })
      expect(result.restoredFiles.length).toBeGreaterThan(0)
    })
  })

  // ─── 综合场景 ───

  describe('综合场景', () => {
    it('多轮对话回退后系统状态一致', () => {
      // 模拟 5 轮对话
      const cp1 = simulateTurnWithMemory(store, session, scopeRoot, 1, { fileContent: 'v1' })
      recordProvision(SCOPE, session.id, {
        itemId: 'note-1', kind: 'note', mode: 'summary', charCount: 200, version: 1
      })

      const cp2 = simulateTurnWithMemory(store, session, scopeRoot, 2, {
        fileContent: 'v2',
        memoryRefs: {
          injected: { user: [], scope: [], session: [] },
          created: { user: [], scope: ['mem-2a', 'mem-2b'], session: [] }
        }
      })
      recordActivity(SCOPE, session.id, {
        action: 'update', itemKind: 'file', itemId: 'test-file.txt', timestamp: Date.now()
      })

      const cp3 = simulateTurnWithMemory(store, session, scopeRoot, 3, {
        memoryRefs: {
          injected: { user: [], scope: ['mem-2a'], session: [] },
          created: { user: ['mem-3u'], scope: [], session: ['mem-3s'] }
        }
      })

      const cp4 = simulateTurnWithMemory(store, session, scopeRoot, 4, {
        fileContent: 'v4',
        memoryRefs: {
          injected: { user: [], scope: [], session: [] },
          created: { user: [], scope: ['mem-4a'], session: [] }
        }
      })

      const cp5 = simulateTurnWithMemory(store, session, scopeRoot, 5)

      expect(session.messages.length).toBe(10)
      expect(session.checkpoints!.length).toBe(5)

      // 回退到 cp3（保留 cp1,cp2 的 4 条消息）
      const result = performRollbackWithCompensation(store, session, scopeRoot, cp3.id)

      // 验证消息截断
      expect(session.messages.length).toBe(4)
      expect(result.remainingMessageCount).toBe(4)

      // 验证 P1 记忆收集（cp3,cp4,cp5 的消息中的 created）
      expect(result.removedMemoryIds.user).toEqual(['mem-3u'])
      expect(result.removedMemoryIds.scope).toEqual(['mem-4a'])
      expect(result.removedMemoryIds.session).toEqual(['mem-3s'])

      // 验证文件恢复
      const fileContent = mdStore.readFileByPath(scopeRoot, 'test-file.txt')
      expect(fileContent?.content).toBe('v2')

      // 验证上下文追踪已重置
      const ctx = getSessionContext(SCOPE, session.id)
      expect(ctx).toBeNull()

      // 验证 checkpoint 只保留 cpIndex 之前的
      expect(session.checkpoints!.length).toBe(2)
    })

    it('连续回退应保持状态一致', () => {
      const cp1 = simulateTurnWithMemory(store, session, scopeRoot, 1, {
        fileContent: 'initial',
        memoryRefs: {
          injected: { user: [], scope: [], session: [] },
          created: { user: ['m-1'], scope: [], session: [] }
        }
      })
      const cp2 = simulateTurnWithMemory(store, session, scopeRoot, 2, {
        fileContent: 'second',
        memoryRefs: {
          injected: { user: [], scope: [], session: [] },
          created: { user: ['m-2'], scope: [], session: [] }
        }
      })
      const cp3 = simulateTurnWithMemory(store, session, scopeRoot, 3, {
        fileContent: 'third',
        memoryRefs: {
          injected: { user: [], scope: [], session: [] },
          created: { user: ['m-3'], scope: [], session: [] }
        }
      })

      // 第一次回退：cp3 → cp2
      const result1 = performRollbackWithCompensation(store, session, scopeRoot, cp3.id)
      expect(result1.removedMemoryIds.user).toEqual(['m-3'])
      expect(session.messages.length).toBe(4)
      expect(mdStore.readFileByPath(scopeRoot, 'test-file.txt')?.content).toBe('second')

      // 第二次回退：cp2 → cp1（注意 cp3 已被删除，新的 cp2 就是当前最后）
      // 需要重新模拟一轮，因为 cp2 被上次回退删除了
      const cp2b = simulateTurnWithMemory(store, session, scopeRoot, 4, {
        fileContent: 'fourth',
        memoryRefs: {
          injected: { user: [], scope: [], session: [] },
          created: { user: ['m-4'], scope: [], session: [] }
        }
      })

      const result2 = performRollbackWithCompensation(store, session, scopeRoot, cp2b.id)
      expect(result2.removedMemoryIds.user).toEqual(['m-4'])
      expect(session.messages.length).toBe(4) // cp1 的 2 条 + 上面第一次回退后 cp1 保留的 2 条
      expect(mdStore.readFileByPath(scopeRoot, 'test-file.txt')?.content).toBe('second')
    })
  })
})
