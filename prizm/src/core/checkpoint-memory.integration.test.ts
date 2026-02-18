/**
 * Checkpoint + 记忆/并发 集成测试
 *
 * 测试回退对异步记忆抽取的影响以及并发回退安全性：
 * 1. 回退操作不被异步任务阻塞
 * 2. 回退后 snapshot collector 状态正确清理
 * 3. 并发回退同一 session 的安全性
 * 4. activeChats abort + rollback 的交互
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

const SCOPE = 'memory-test-scope'

function makeMsg(id: string, role: 'user' | 'assistant', text: string): AgentMessage {
  return { id, role, parts: [{ type: 'text', content: text }], createdAt: Date.now() }
}

function simulateQuickTurn(
  store: ScopeStore,
  session: AgentSession,
  scopeRoot: string,
  turnIndex: number,
  fileContent?: string
): SessionCheckpoint {
  const messageIndex = session.messages.length
  const cp = createCheckpoint(session.id, messageIndex, `turn-${turnIndex}`)
  initSnapshotCollector(session.id)

  session.messages.push(makeMsg(`u-${turnIndex}`, 'user', `turn-${turnIndex}`))

  if (fileContent !== undefined) {
    const existing = mdStore.readFileByPath(scopeRoot, 'shared.txt')
    captureFileSnapshot(session.id, 'shared.txt', existing?.content ?? null)
    mdStore.writeFileByPath(scopeRoot, 'shared.txt', fileContent)
  }

  session.messages.push(makeMsg(`a-${turnIndex}`, 'assistant', `reply-${turnIndex}`))

  const fileChanges = fileContent
    ? extractFileChangesFromMessages([
        { parts: [{ type: 'tool', name: 'prizm_file_write', arguments: JSON.stringify({ path: 'shared.txt', content: fileContent }), result: 'ok' }] }
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

function performRollback(
  store: ScopeStore,
  session: AgentSession,
  scopeRoot: string,
  checkpointId: string
): { restoredFiles: string[] } {
  const checkpoints = session.checkpoints ?? []
  const cpIndex = checkpoints.findIndex((cp) => cp.id === checkpointId)
  if (cpIndex < 0) throw new Error(`Checkpoint not found: ${checkpointId}`)

  const checkpoint = checkpoints[cpIndex]
  const removedCheckpoints = checkpoints.slice(cpIndex)
  const removedCpIds = removedCheckpoints.map((cp) => cp.id)

  // 合并快照：first-occurrence-wins（与生产代码一致）
  const mergedSnapshots = new Map<string, string>()
  for (const cp of removedCheckpoints) {
    const snapshots = loadFileSnapshots(scopeRoot, session.id, cp.id)
    for (const [key, value] of Object.entries(snapshots)) {
      if (!mergedSnapshots.has(key)) {
        mergedSnapshots.set(key, value)
      }
    }
  }

  const restoredFiles: string[] = []
  for (const [key, value] of mergedSnapshots) {
    if (key.startsWith('[doc:') || key.startsWith('[doc] ')) continue
    mdStore.writeFileByPath(scopeRoot, key, value)
    restoredFiles.push(key)
  }

  const clampedIndex = Math.max(0, Math.min(checkpoint.messageIndex, session.messages.length))
  session.messages = session.messages.slice(0, clampedIndex)
  session.checkpoints = session.checkpoints?.filter((cp) => cp.messageIndex < clampedIndex)
  session.updatedAt = Date.now()
  store.saveScope(SCOPE)

  deleteCheckpointSnapshots(scopeRoot, session.id, removedCpIds)

  return { restoredFiles }
}

describe('Checkpoint + Memory/Concurrency Integration', () => {
  let tempDir: string
  let store: ScopeStore
  let scopeRoot: string
  let session: AgentSession

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `prizm-cp-mem-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tempDir, { recursive: true })
    store = new ScopeStore(tempDir)

    const data = store.getScopeData(SCOPE)
    const now = Date.now()
    session = {
      id: `session-mem-${now}`,
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

  // ─── 记忆抽取中断场景 ───

  describe('回退与异步任务', () => {
    it('回退操作同步完成，不被异步记忆抽取阻塞', async () => {
      simulateQuickTurn(store, session, scopeRoot, 1, 'v1')
      const cp2 = simulateQuickTurn(store, session, scopeRoot, 2, 'v2')
      simulateQuickTurn(store, session, scopeRoot, 3, 'v3')

      // 模拟异步记忆抽取正在进行
      const memoryExtractionPromise = new Promise<void>((resolve) => {
        setTimeout(resolve, 100)
      })

      // 回退操作应该立即完成，不等待 memoryExtractionPromise
      const startTime = Date.now()
      performRollback(store, session, scopeRoot, cp2.id)
      const elapsed = Date.now() - startTime

      expect(elapsed).toBeLessThan(50)
      expect(session.messages).toHaveLength(2)

      await memoryExtractionPromise
    })

    it('agent:message.completed 事件触发后回退不影响结果', () => {
      simulateQuickTurn(store, session, scopeRoot, 1, 'v1')
      const cp2 = simulateQuickTurn(store, session, scopeRoot, 2, 'v2')

      // 模拟 agent:message.completed 事件已触发
      // 此时记忆抽取开始运行，但回退操作仍然可以正确截断消息和恢复文件
      performRollback(store, session, scopeRoot, cp2.id)

      expect(session.messages).toHaveLength(2)
      expect(session.checkpoints).toHaveLength(1)
    })
  })

  // ─── Snapshot Collector 清理 ───

  describe('回退后 snapshot collector 清理', () => {
    it('回退后再新建一轮对话，snapshot collector 独立', () => {
      simulateQuickTurn(store, session, scopeRoot, 1, 'v1')
      const cp2 = simulateQuickTurn(store, session, scopeRoot, 2, 'v2')

      performRollback(store, session, scopeRoot, cp2.id)

      // flush 之前轮次的 collector 应该已经清空
      const staleSnapshots = flushSnapshotCollector(session.id)
      expect(staleSnapshots).toEqual({})

      // 新一轮对话可以正常工作
      simulateQuickTurn(store, session, scopeRoot, 3, 'v3-branch')

      expect(session.messages).toHaveLength(4)
      expect(mdStore.readFileByPath(scopeRoot, 'shared.txt')?.content).toBe('v3-branch')
    })

    it('initSnapshotCollector 重置旧数据不泄漏', () => {
      initSnapshotCollector(session.id)
      captureFileSnapshot(session.id, 'leak.txt', 'should not persist')

      // 重新 init 覆盖旧数据
      initSnapshotCollector(session.id)
      const result = flushSnapshotCollector(session.id)

      expect(result).toEqual({})
    })
  })

  // ─── 并发回退安全性 ───

  describe('并发回退安全性', () => {
    it('同一 session 的多个同步回退操作结果一致', () => {
      simulateQuickTurn(store, session, scopeRoot, 1, 'v1')
      const cp2 = simulateQuickTurn(store, session, scopeRoot, 2, 'v2')
      simulateQuickTurn(store, session, scopeRoot, 3, 'v3')

      // 第一次回退
      performRollback(store, session, scopeRoot, cp2.id)
      expect(session.messages).toHaveLength(2)

      // 尝试再次回退到同一个（已被删除的）checkpoint 应该失败
      expect(() => {
        performRollback(store, session, scopeRoot, cp2.id)
      }).toThrow('Checkpoint not found')
    })

    it('并发向同一 session 写入快照时互不影响', () => {
      const sid1 = 'concurrent-1'
      const sid2 = 'concurrent-2'

      initSnapshotCollector(sid1)
      initSnapshotCollector(sid2)

      captureFileSnapshot(sid1, 'a.txt', 'content-a')
      captureFileSnapshot(sid2, 'b.txt', 'content-b')
      captureFileSnapshot(sid1, 'c.txt', 'content-c')

      const snap1 = flushSnapshotCollector(sid1)
      const snap2 = flushSnapshotCollector(sid2)

      expect(snap1).toEqual({ 'a.txt': 'content-a', 'c.txt': 'content-c' })
      expect(snap2).toEqual({ 'b.txt': 'content-b' })
    })
  })

  // ─── activeChats 模拟 ───

  describe('活跃聊天中止与回退', () => {
    it('模拟 AbortController 中止后回退操作正常', () => {
      simulateQuickTurn(store, session, scopeRoot, 1, 'v1')
      const cp2 = simulateQuickTurn(store, session, scopeRoot, 2, 'v2')

      const abortController = new AbortController()
      const activeChats = new Map<string, AbortController>()
      const key = `${SCOPE}:${session.id}`
      activeChats.set(key, abortController)

      // 中止聊天
      activeChats.get(key)?.abort()
      activeChats.delete(key)

      expect(abortController.signal.aborted).toBe(true)

      // 回退仍然正常
      performRollback(store, session, scopeRoot, cp2.id)
      expect(session.messages).toHaveLength(2)
    })

    it('无活跃聊天时回退也正常', () => {
      simulateQuickTurn(store, session, scopeRoot, 1, 'v1')
      const cp2 = simulateQuickTurn(store, session, scopeRoot, 2, 'v2')

      const activeChats = new Map<string, AbortController>()
      const key = `${SCOPE}:${session.id}`
      // 没有活跃聊天
      expect(activeChats.has(key)).toBe(false)

      performRollback(store, session, scopeRoot, cp2.id)
      expect(session.messages).toHaveLength(2)
    })
  })

  // ─── 边界：空快照恢复 ───

  describe('边界场景', () => {
    it('回退到无文件修改的 checkpoint', () => {
      const cp1 = simulateQuickTurn(store, session, scopeRoot, 1) // 无文件修改
      simulateQuickTurn(store, session, scopeRoot, 2, 'v2')

      performRollback(store, session, scopeRoot, cp1.id)
      expect(session.messages).toHaveLength(0)
    })

    it('连续 3 次回退 + 重建', () => {
      for (let round = 0; round < 3; round++) {
        const msgsBefore = session.messages.length
        simulateQuickTurn(store, session, scopeRoot, round * 2 + 1, `round-${round}-a`)
        const cp = simulateQuickTurn(store, session, scopeRoot, round * 2 + 2, `round-${round}-b`)

        performRollback(store, session, scopeRoot, cp.id)
        // 每次回退到第 2 轮的 checkpoint，保留第 1 轮的 2 条消息
        expect(session.messages).toHaveLength(msgsBefore + 2)
      }
    })

    it('大量 checkpoint 回退到第一个', () => {
      const checkpoints: SessionCheckpoint[] = []
      for (let i = 0; i < 20; i++) {
        checkpoints.push(simulateQuickTurn(store, session, scopeRoot, i, `v${i}`))
      }

      expect(session.messages).toHaveLength(40)
      expect(session.checkpoints).toHaveLength(20)

      performRollback(store, session, scopeRoot, checkpoints[0].id)

      expect(session.messages).toHaveLength(0)
      expect(session.checkpoints).toHaveLength(0)

      // 所有快照文件应被清理
      for (const cp of checkpoints) {
        expect(loadFileSnapshots(scopeRoot, session.id, cp.id)).toEqual({})
      }
    })

    it('同一文件被多个 checkpoint 连续修改，回退到中间 checkpoint', () => {
      const cp1 = simulateQuickTurn(store, session, scopeRoot, 1, 'first')
      simulateQuickTurn(store, session, scopeRoot, 2, 'second')
      simulateQuickTurn(store, session, scopeRoot, 3, 'third')
      simulateQuickTurn(store, session, scopeRoot, 4, 'fourth')
      const cp5 = simulateQuickTurn(store, session, scopeRoot, 5, 'fifth')

      // 回退到 cp5（撤销第 5 轮）
      performRollback(store, session, scopeRoot, cp5.id)

      expect(session.messages).toHaveLength(8) // 前 4 轮
      // cp5 快照保存的是第 5 轮前的状态="fourth"
      expect(mdStore.readFileByPath(scopeRoot, 'shared.txt')?.content).toBe('fourth')
    })
  })
})
