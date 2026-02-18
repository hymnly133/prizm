/**
 * Checkpoint 系统端到端集成测试
 *
 * 模拟真实多轮对话 → 文件修改 → 回退的完整流程，
 * 使用真实 ScopeStore + 文件系统，验证：
 * - 消息截断
 * - checkpoint 过滤
 * - 文件内容恢复
 * - 快照文件清理
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
  deleteSessionCheckpoints,
  extractFileChangesFromMessages
} from './checkpointStore'
import * as mdStore from './mdStore'
import type { AgentSession, AgentMessage, SessionCheckpoint } from '../types'

const SCOPE = 'integration-scope'

function makeMsg(id: string, role: 'user' | 'assistant', text: string, toolParts?: Array<{ name: string; args: Record<string, string> }>): AgentMessage {
  const parts: AgentMessage['parts'] = [{ type: 'text', content: text }]
  if (toolParts) {
    for (const tp of toolParts) {
      parts.push({
        type: 'tool',
        name: tp.name,
        arguments: JSON.stringify(tp.args),
        result: 'ok'
      })
    }
  }
  return { id, role, parts, createdAt: Date.now() }
}

/**
 * 模拟一轮对话：
 * 1. 创建 checkpoint
 * 2. 追加 user + assistant 消息
 * 3. 记录文件变更快照
 * 4. 完成 checkpoint
 */
function simulateTurn(
  store: ScopeStore,
  session: AgentSession,
  scopeRoot: string,
  turnIndex: number,
  userText: string,
  assistantText: string,
  fileOps: Array<{ op: 'write' | 'delete'; path: string; content?: string }>
): SessionCheckpoint {
  const messageIndex = session.messages.length
  const cp = createCheckpoint(session.id, messageIndex, userText)
  initSnapshotCollector(session.id)

  // 追加 user 消息
  session.messages.push(makeMsg(`u-${turnIndex}`, 'user', userText))

  // 执行文件操作，捕获快照
  const toolParts: Array<{ name: string; args: Record<string, string> }> = []
  for (const fo of fileOps) {
    if (fo.op === 'write') {
      const existing = mdStore.readFileByPath(scopeRoot, fo.path)
      captureFileSnapshot(session.id, fo.path, existing?.content ?? null)
      mdStore.writeFileByPath(scopeRoot, fo.path, fo.content ?? '')
      toolParts.push({ name: 'prizm_file_write', args: { path: fo.path, content: fo.content ?? '' } })
    } else if (fo.op === 'delete') {
      const existing = mdStore.readFileByPath(scopeRoot, fo.path)
      captureFileSnapshot(session.id, fo.path, existing?.content ?? null)
      mdStore.deleteByPath(scopeRoot, fo.path)
      toolParts.push({ name: 'prizm_file_delete', args: { path: fo.path } })
    }
  }

  // 追加 assistant 消息
  session.messages.push(makeMsg(`a-${turnIndex}`, 'assistant', assistantText, toolParts))

  // 完成 checkpoint
  const fileChanges = extractFileChangesFromMessages([
    { parts: toolParts.map((tp) => ({ type: 'tool', name: tp.name, arguments: JSON.stringify(tp.args), result: 'ok' })) }
  ])
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
 * 模拟回退：
 * 1. 从快照恢复文件
 * 2. 截断消息
 * 3. 清理快照文件
 */
function performRollback(
  store: ScopeStore,
  session: AgentSession,
  scopeRoot: string,
  checkpointId: string,
  restoreFiles = true
): { restoredFiles: string[]; removedCpIds: string[] } {
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
  if (restoreFiles) {
    for (const [key, value] of mergedSnapshots) {
      if (key.startsWith('[doc:') || key.startsWith('[doc] ')) continue
      mdStore.writeFileByPath(scopeRoot, key, value)
      restoredFiles.push(key)
    }
  }

  // 截断消息
  const clampedIndex = Math.max(0, Math.min(checkpoint.messageIndex, session.messages.length))
  session.messages = session.messages.slice(0, clampedIndex)
  session.checkpoints = session.checkpoints?.filter((cp) => cp.messageIndex < clampedIndex)
  session.updatedAt = Date.now()
  store.saveScope(SCOPE)

  // 清理快照
  deleteCheckpointSnapshots(scopeRoot, session.id, removedCpIds)

  return { restoredFiles, removedCpIds }
}

describe('Checkpoint Integration', () => {
  let tempDir: string
  let store: ScopeStore
  let scopeRoot: string
  let session: AgentSession

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `prizm-cp-int-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tempDir, { recursive: true })
    store = new ScopeStore(tempDir)

    const data = store.getScopeData(SCOPE)
    const now = Date.now()
    session = {
      id: `session-${now}`,
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

  // ─── 场景 A：基本多轮对话回退 ───

  describe('场景 A：基本多轮对话回退', () => {
    it('3 轮对话后回退到第 2 轮，消息和文件正确恢复', () => {
      const cp1 = simulateTurn(store, session, scopeRoot, 1, '创建文件', '好的', [
        { op: 'write', path: 'hello.txt', content: 'hello world' }
      ])
      const cp2 = simulateTurn(store, session, scopeRoot, 2, '修改文件', '已修改', [
        { op: 'write', path: 'hello.txt', content: 'hello modified' }
      ])
      const cp3 = simulateTurn(store, session, scopeRoot, 3, '再改一次', '再次修改', [
        { op: 'write', path: 'hello.txt', content: 'hello final' }
      ])

      // 回退前文件状态
      expect(mdStore.readFileByPath(scopeRoot, 'hello.txt')?.content).toBe('hello final')
      expect(session.messages).toHaveLength(6)
      expect(session.checkpoints).toHaveLength(3)

      // 回退到 cp2（第 2 轮之前）
      const { restoredFiles } = performRollback(store, session, scopeRoot, cp2.id)

      // 消息截断到 cp2.messageIndex（第 1 轮的 2 条消息）
      expect(session.messages).toHaveLength(cp2.messageIndex)
      // 只保留 messageIndex < cp2.messageIndex 的 checkpoint
      expect(session.checkpoints).toHaveLength(1)
      expect(session.checkpoints![0].id).toBe(cp1.id)
      // 文件恢复
      expect(restoredFiles).toContain('hello.txt')
      // cp2 快照: hello.txt="hello world" (第 2 轮修改前的原始状态)
      // cp3 快照: hello.txt="hello modified" (第 3 轮修改前)
      // first-occurrence-wins: cp2 先出现 → 恢复到 "hello world"（cp2 之前的状态）

      // first-occurrence-wins：cp2 快照 "hello world" 优先（代表 cp2 之前的原始状态）
      const fileContent = mdStore.readFileByPath(scopeRoot, 'hello.txt')?.content
      expect(fileContent).toBe('hello world')
    })
  })

  // ─── 场景 B：多文件交叉修改回退 ───

  describe('场景 B：多文件交叉修改回退', () => {
    it('多文件被不同轮次修改，回退后各自恢复', () => {
      // 第 1 轮：创建 file-a
      simulateTurn(store, session, scopeRoot, 1, '创建 a', '好的', [
        { op: 'write', path: 'file-a.txt', content: 'a-v1' }
      ])

      // 第 2 轮：修改 file-a + 创建 file-b
      const cp2 = simulateTurn(store, session, scopeRoot, 2, '修改 a 创建 b', '好的', [
        { op: 'write', path: 'file-a.txt', content: 'a-v2' },
        { op: 'write', path: 'file-b.txt', content: 'b-v1' }
      ])

      // 第 3 轮：删除 file-a + 修改 file-b
      simulateTurn(store, session, scopeRoot, 3, '删除 a 修改 b', '好的', [
        { op: 'delete', path: 'file-a.txt' },
        { op: 'write', path: 'file-b.txt', content: 'b-v2' }
      ])

      // 回退前: file-a 已删除, file-b=b-v2
      expect(mdStore.readFileByPath(scopeRoot, 'file-a.txt')).toBeNull()
      expect(mdStore.readFileByPath(scopeRoot, 'file-b.txt')?.content).toBe('b-v2')

      // 回退到 cp2（撤销第 2 轮和第 3 轮）
      performRollback(store, session, scopeRoot, cp2.id)

      // first-occurrence-wins:
      // cp2 快照: file-a="a-v1" (第 2 轮修改前), file-b="" (新文件)
      // cp3 快照: file-a="a-v2" (第 3 轮删除前), file-b="b-v1" (第 3 轮修改前)
      // cp2 先出现 → file-a="a-v1", file-b=""
      expect(mdStore.readFileByPath(scopeRoot, 'file-a.txt')?.content).toBe('a-v1')
      expect(mdStore.readFileByPath(scopeRoot, 'file-b.txt')?.content).toBe('')
    })
  })

  // ─── 场景 C：全量回退到第 1 个 checkpoint ───

  describe('场景 C：全量回退', () => {
    it('回退到第 1 个 checkpoint 清空所有消息', () => {
      const cp1 = simulateTurn(store, session, scopeRoot, 1, '创建文件', '好的', [
        { op: 'write', path: 'new.txt', content: 'created' }
      ])
      simulateTurn(store, session, scopeRoot, 2, '修改', '好的', [
        { op: 'write', path: 'new.txt', content: 'modified' }
      ])

      performRollback(store, session, scopeRoot, cp1.id)

      expect(session.messages).toHaveLength(0)
      expect(session.checkpoints).toHaveLength(0)
      // first-occurrence-wins:
      // cp1 快照: new.txt="" (新文件创建前) — 先出现，优先
      // cp2 快照: new.txt="created" (修改前)
      expect(mdStore.readFileByPath(scopeRoot, 'new.txt')?.content).toBe('')
    })

    it('只有一轮时回退到第 1 个 checkpoint', () => {
      const cp1 = simulateTurn(store, session, scopeRoot, 1, '创建文件', '好的', [
        { op: 'write', path: 'only.txt', content: 'hello' }
      ])

      performRollback(store, session, scopeRoot, cp1.id)

      expect(session.messages).toHaveLength(0)
      expect(session.checkpoints).toHaveLength(0)
      // 只有 cp1 一个快照: only.txt="" (新文件)
      expect(mdStore.readFileByPath(scopeRoot, 'only.txt')?.content).toBe('')
    })
  })

  // ─── 场景 D：连续回退 ───

  describe('场景 D：连续回退', () => {
    it('先回退到 cp3 再回退到 cp1', () => {
      const cp1 = simulateTurn(store, session, scopeRoot, 1, '第 1 轮', 'ok', [
        { op: 'write', path: 'f.txt', content: 'v1' }
      ])
      simulateTurn(store, session, scopeRoot, 2, '第 2 轮', 'ok', [
        { op: 'write', path: 'f.txt', content: 'v2' }
      ])
      const cp3 = simulateTurn(store, session, scopeRoot, 3, '第 3 轮', 'ok', [
        { op: 'write', path: 'f.txt', content: 'v3' }
      ])
      simulateTurn(store, session, scopeRoot, 4, '第 4 轮', 'ok', [
        { op: 'write', path: 'f.txt', content: 'v4' }
      ])

      // 第一次回退到 cp3
      performRollback(store, session, scopeRoot, cp3.id)
      expect(session.messages).toHaveLength(4) // 前 2 轮 × 2 条消息
      expect(session.checkpoints).toHaveLength(2)

      // 第二次回退到 cp1
      performRollback(store, session, scopeRoot, cp1.id)
      expect(session.messages).toHaveLength(0)
      expect(session.checkpoints).toHaveLength(0)
    })
  })

  // ─── 场景 E：restoreFiles=false ───

  describe('场景 E：仅回退消息不恢复文件', () => {
    it('restoreFiles=false 时文件保持修改后状态', () => {
      const cp1 = simulateTurn(store, session, scopeRoot, 1, '创建文件', 'ok', [
        { op: 'write', path: 'keep.txt', content: 'original' }
      ])
      simulateTurn(store, session, scopeRoot, 2, '修改', 'ok', [
        { op: 'write', path: 'keep.txt', content: 'modified' }
      ])

      performRollback(store, session, scopeRoot, cp1.id, false)

      expect(session.messages).toHaveLength(0)
      // 文件不恢复，保持最新状态
      expect(mdStore.readFileByPath(scopeRoot, 'keep.txt')?.content).toBe('modified')
    })
  })

  // ─── 场景 F：回退后重新对话 ───

  describe('场景 F：回退后重新对话（分支）', () => {
    it('回退后可以新建一轮对话并创建新的 checkpoint', () => {
      const cp1 = simulateTurn(store, session, scopeRoot, 1, '第 1 轮', 'ok', [
        { op: 'write', path: 'f.txt', content: 'v1' }
      ])
      const cp2 = simulateTurn(store, session, scopeRoot, 2, '第 2 轮', 'ok', [
        { op: 'write', path: 'f.txt', content: 'v2' }
      ])

      // 回退到 cp2
      performRollback(store, session, scopeRoot, cp2.id)
      expect(session.messages).toHaveLength(2) // 第 1 轮的消息

      // 新建一轮（分支对话）
      const cpNew = simulateTurn(store, session, scopeRoot, 3, '分支对话', 'ok', [
        { op: 'write', path: 'f.txt', content: 'branch-v1' }
      ])

      expect(session.messages).toHaveLength(4) // 第 1 轮 + 分支轮
      expect(session.checkpoints).toHaveLength(2) // cp1 + cpNew
      expect(session.checkpoints![0].id).toBe(cp1.id)
      expect(session.checkpoints![1].id).toBe(cpNew.id)
      expect(mdStore.readFileByPath(scopeRoot, 'f.txt')?.content).toBe('branch-v1')
    })
  })

  // ─── 场景 G：会话删除清理 ───

  describe('场景 G：会话删除清理快照', () => {
    it('删除 session 后快照目录被清理', () => {
      simulateTurn(store, session, scopeRoot, 1, '第 1 轮', 'ok', [
        { op: 'write', path: 'f.txt', content: 'v1' }
      ])
      simulateTurn(store, session, scopeRoot, 2, '第 2 轮', 'ok', [
        { op: 'write', path: 'f.txt', content: 'v2' }
      ])

      // 确认快照目录存在
      const cpDir = path.join(scopeRoot, '.prizm', 'checkpoints', session.id)
      expect(fs.existsSync(cpDir)).toBe(true)

      // 删除会话
      deleteSessionCheckpoints(scopeRoot, session.id)

      expect(fs.existsSync(cpDir)).toBe(false)
    })
  })

  // ─── 场景 H：快照文件清理一致性 ───

  describe('快照文件清理一致性', () => {
    it('回退只删除被回退的 checkpoint 快照，保留之前的', () => {
      const cp1 = simulateTurn(store, session, scopeRoot, 1, '第 1 轮', 'ok', [
        { op: 'write', path: 'a.txt', content: 'a' }
      ])
      const cp2 = simulateTurn(store, session, scopeRoot, 2, '第 2 轮', 'ok', [
        { op: 'write', path: 'b.txt', content: 'b' }
      ])
      const cp3 = simulateTurn(store, session, scopeRoot, 3, '第 3 轮', 'ok', [
        { op: 'write', path: 'c.txt', content: 'c' }
      ])

      // 回退到 cp2（删除 cp2 和 cp3 的快照）
      const { removedCpIds } = performRollback(store, session, scopeRoot, cp2.id)

      expect(removedCpIds).toContain(cp2.id)
      expect(removedCpIds).toContain(cp3.id)

      // cp1 的快照文件仍然存在
      const cp1Snapshots = loadFileSnapshots(scopeRoot, session.id, cp1.id)
      expect(cp1Snapshots).toHaveProperty('a.txt')

      // cp2, cp3 的快照文件已删除
      expect(loadFileSnapshots(scopeRoot, session.id, cp2.id)).toEqual({})
      expect(loadFileSnapshots(scopeRoot, session.id, cp3.id)).toEqual({})
    })
  })

  // ─── 场景 I：无文件修改的纯对话轮次 ───

  describe('无文件修改的纯对话轮次', () => {
    it('纯文本对话也创建 checkpoint，回退只影响消息', () => {
      const cp1 = simulateTurn(store, session, scopeRoot, 1, '你好', '你好！', [])
      const cp2 = simulateTurn(store, session, scopeRoot, 2, '再见', '再见！', [])

      expect(session.checkpoints).toHaveLength(2)
      expect(cp1.fileChanges).toEqual([])
      expect(cp2.fileChanges).toEqual([])

      performRollback(store, session, scopeRoot, cp2.id)

      expect(session.messages).toHaveLength(2)
      expect(session.checkpoints).toHaveLength(1)
    })
  })

  // ─── 场景 J：持久化后重新加载验证 ───

  describe('持久化后重新加载', () => {
    it('checkpoint 数据随 session 持久化后可被正确加载', () => {
      simulateTurn(store, session, scopeRoot, 1, '你好', '你好！', [
        { op: 'write', path: 'persist.txt', content: 'test' }
      ])

      // 重新创建 ScopeStore 模拟重启
      const store2 = new ScopeStore(tempDir)
      const loadedData = store2.getScopeData(SCOPE)
      const loadedSession = loadedData.agentSessions.find((s) => s.id === session.id)

      expect(loadedSession).toBeDefined()
      expect(loadedSession!.messages).toHaveLength(2)
      expect(loadedSession!.checkpoints).toHaveLength(1)
      expect(loadedSession!.checkpoints![0].completed).toBe(true)
      expect(loadedSession!.checkpoints![0].userMessage).toBe('你好')
    })
  })
})
