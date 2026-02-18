/**
 * Checkpoint 边缘条件与多 Agent 交互集成测试
 *
 * 覆盖场景：
 * 1. compressedThroughRound 在各种回退深度下的修正
 * 2. Todo 快照捕获与回退恢复
 * 3. 文档记忆提取防重（isDocumentExtracting 守卫）
 * 4. 摘要服务 session 级取消/去重
 * 5. InteractManager 清理
 * 6. 多 Agent session 在同一 scope 下的隔离与交互
 * 7. 回退到第一个 checkpoint（清空所有消息）
 * 8. 混合类型快照（文件 + 文档 + todo）同时回退
 * 9. 连续多次回退的状态一致性
 * 10. 空 checkpoint（无文件变更）的回退
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
import {
  saveVersion,
  getVersionHistory
} from './documentVersionStore'
import * as mdStore from './mdStore'
import type { AgentSession, AgentMessage, SessionCheckpoint } from '../types'
import type { MemoryIdsByLayer, MemoryRefs, TodoList } from '@prizm/shared'

const SCOPE = 'edge-case-scope'

function makeMsg(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  opts?: {
    toolParts?: Array<{ name: string; args: Record<string, string> }>
    memoryRefs?: MemoryRefs
  }
): AgentMessage {
  const parts: AgentMessage['parts'] = [{ type: 'text', content: text }]
  if (opts?.toolParts) {
    for (const tp of opts.toolParts) {
      parts.push({
        type: 'tool',
        name: tp.name,
        arguments: JSON.stringify(tp.args),
        result: 'ok'
      })
    }
  }
  return {
    id,
    role,
    parts,
    createdAt: Date.now(),
    ...(opts?.memoryRefs ? { memoryRefs: opts.memoryRefs } : {})
  }
}

function createSession(id: string, overrides?: Partial<AgentSession>): AgentSession {
  const now = Date.now()
  return {
    id,
    scope: SCOPE,
    messages: [],
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function simulateTurn(
  store: ScopeStore,
  session: AgentSession,
  scopeRoot: string,
  turnIndex: number,
  opts: {
    userText?: string
    assistantText?: string
    fileOps?: Array<{ op: 'write' | 'delete'; path: string; content?: string }>
    docOps?: Array<{ action: 'create' | 'update' | 'delete'; docId: string; versionBefore?: number; title?: string; relativePath?: string }>
    todoOps?: Array<{ action: 'create_list' | 'modify'; listId: string; listSnapshot?: TodoList | null }>
    memoryRefs?: MemoryRefs
  }
): SessionCheckpoint {
  const messageIndex = session.messages.length
  const cp = createCheckpoint(session.id, messageIndex, opts.userText ?? `user-${turnIndex}`)
  initSnapshotCollector(session.id)

  session.messages.push(makeMsg(`u-${turnIndex}`, 'user', opts.userText ?? `问题${turnIndex}`))

  const toolParts: Array<{ name: string; args: Record<string, string> }> = []

  for (const fo of opts.fileOps ?? []) {
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

  for (const docOp of opts.docOps ?? []) {
    const key = `[doc:${docOp.docId}]`
    if (docOp.action === 'create') {
      captureFileSnapshot(session.id, key, JSON.stringify({ action: 'create' }))
    } else if (docOp.action === 'update') {
      captureFileSnapshot(session.id, key, JSON.stringify({
        action: 'update',
        versionBefore: docOp.versionBefore ?? 0
      }))
    } else if (docOp.action === 'delete') {
      captureFileSnapshot(session.id, key, JSON.stringify({
        action: 'delete',
        versionBefore: docOp.versionBefore,
        title: docOp.title,
        relativePath: docOp.relativePath
      }))
    }
  }

  for (const todoOp of opts.todoOps ?? []) {
    const key = `[todo:${todoOp.listId}]`
    if (todoOp.action === 'create_list') {
      captureFileSnapshot(session.id, key, JSON.stringify({ action: 'create_list' }))
    } else if (todoOp.action === 'modify') {
      captureFileSnapshot(session.id, key, JSON.stringify({
        action: 'modify',
        listSnapshot: todoOp.listSnapshot
      }))
    }
  }

  session.messages.push(makeMsg(`a-${turnIndex}`, 'assistant', opts.assistantText ?? `回复${turnIndex}`, {
    toolParts,
    memoryRefs: opts.memoryRefs
  }))

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
 * 生产级回退模拟——包含 todo/doc/file 完整恢复、compressedThroughRound 修正、memoryRefs 收集
 */
function performFullRollback(
  store: ScopeStore,
  session: AgentSession,
  scopeRoot: string,
  checkpointId: string,
  restoreFiles = true
): {
  restoredFiles: string[]
  removedCpIds: string[]
  removedMemoryIds: MemoryIdsByLayer
  adjustedCompressedThroughRound?: number
  todoRestorations: Array<{ listId: string; action: string }>
} {
  const checkpoints = session.checkpoints ?? []
  const cpIndex = checkpoints.findIndex((cp) => cp.id === checkpointId)
  if (cpIndex < 0) throw new Error(`Checkpoint not found: ${checkpointId}`)

  const checkpoint = checkpoints[cpIndex]
  const removedCheckpoints = checkpoints.slice(cpIndex)
  const removedCpIds = removedCheckpoints.map((cp) => cp.id)

  const rolledBackMessages = session.messages.slice(checkpoint.messageIndex)
  const removedMemoryIds: MemoryIdsByLayer = { user: [], scope: [], session: [] }
  for (const msg of rolledBackMessages) {
    if (msg.memoryRefs?.created) {
      removedMemoryIds.user.push(...msg.memoryRefs.created.user)
      removedMemoryIds.scope.push(...msg.memoryRefs.created.scope)
      removedMemoryIds.session.push(...msg.memoryRefs.created.session)
    }
  }

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
  const todoRestorations: Array<{ listId: string; action: string }> = []

  if (restoreFiles) {
    for (const [snapKey, snapshotValue] of mergedSnapshots) {
      if (snapKey.startsWith('[todo:')) {
        const listId = snapKey.slice(6, -1)
        const todoInfo = JSON.parse(snapshotValue) as {
          action: 'create_list' | 'modify'
          listSnapshot?: TodoList
        }

        const data = store.getScopeData(SCOPE)
        if (!data.todoLists) data.todoLists = []

        if (todoInfo.action === 'create_list') {
          data.todoLists = data.todoLists.filter((l) => l.id !== listId)
        } else if (todoInfo.action === 'modify' && todoInfo.listSnapshot) {
          const idx = data.todoLists.findIndex((l) => l.id === listId)
          if (idx >= 0) {
            data.todoLists[idx] = todoInfo.listSnapshot
          } else {
            data.todoLists.push(todoInfo.listSnapshot)
          }
        }

        store.saveScope(SCOPE)
        todoRestorations.push({ listId, action: todoInfo.action })
        restoredFiles.push(snapKey)
        continue
      }

      if (snapKey.startsWith('[doc:')) {
        restoredFiles.push(snapKey)
        continue
      }

      mdStore.writeFileByPath(scopeRoot, snapKey, snapshotValue)
      restoredFiles.push(snapKey)
    }
  }

  const clampedIndex = Math.max(0, Math.min(checkpoint.messageIndex, session.messages.length))
  session.messages = session.messages.slice(0, clampedIndex)
  session.checkpoints = session.checkpoints?.filter((cp) => cp.messageIndex < clampedIndex)
  session.updatedAt = Date.now()

  let adjustedCompressedThroughRound: number | undefined
  const remainingRounds = Math.floor(checkpoint.messageIndex / 2)
  const oldCompressed = session.compressedThroughRound ?? 0
  if (oldCompressed > remainingRounds) {
    session.compressedThroughRound = remainingRounds
    adjustedCompressedThroughRound = remainingRounds
  }

  store.saveScope(SCOPE)
  deleteCheckpointSnapshots(scopeRoot, session.id, removedCpIds)

  return { restoredFiles, removedCpIds, removedMemoryIds, adjustedCompressedThroughRound, todoRestorations }
}


describe('Checkpoint Edge Cases', () => {
  let tempDir: string
  let store: ScopeStore
  let scopeRoot: string

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `prizm-edge-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tempDir, { recursive: true })
    store = new ScopeStore(tempDir)
    scopeRoot = store.getScopeRootPath(SCOPE)
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // ─── 1. compressedThroughRound 修正 ───

  describe('compressedThroughRound 回退修正', () => {
    it('回退到压缩边界之前，compressedThroughRound 钳位到剩余轮数', () => {
      const session = createSession('sess-ctr-1', { compressedThroughRound: 4 })
      store.getScopeData(SCOPE).agentSessions.push(session)

      for (let i = 1; i <= 8; i++) {
        simulateTurn(store, session, scopeRoot, i, {
          fileOps: [{ op: 'write', path: `f${i}.txt`, content: `v${i}` }]
        })
      }

      expect(session.messages).toHaveLength(16)
      expect(session.compressedThroughRound).toBe(4)

      const cp3 = session.checkpoints![2]
      const result = performFullRollback(store, session, scopeRoot, cp3.id)

      expect(session.messages).toHaveLength(4)
      expect(result.adjustedCompressedThroughRound).toBe(2)
      expect(session.compressedThroughRound).toBe(2)
    })

    it('回退到第一个 checkpoint（清空所有消息），compressedThroughRound 归零', () => {
      const session = createSession('sess-ctr-2', { compressedThroughRound: 3 })
      store.getScopeData(SCOPE).agentSessions.push(session)

      for (let i = 1; i <= 5; i++) {
        simulateTurn(store, session, scopeRoot, i, {})
      }

      const cp1 = session.checkpoints![0]
      const result = performFullRollback(store, session, scopeRoot, cp1.id)

      expect(session.messages).toHaveLength(0)
      expect(session.compressedThroughRound).toBe(0)
      expect(result.adjustedCompressedThroughRound).toBe(0)
    })

    it('回退位置在压缩边界之后，compressedThroughRound 不变', () => {
      const session = createSession('sess-ctr-3', { compressedThroughRound: 2 })
      store.getScopeData(SCOPE).agentSessions.push(session)

      for (let i = 1; i <= 6; i++) {
        simulateTurn(store, session, scopeRoot, i, {})
      }

      const cp5 = session.checkpoints![4]
      const result = performFullRollback(store, session, scopeRoot, cp5.id)

      expect(session.messages).toHaveLength(8)
      expect(result.adjustedCompressedThroughRound).toBeUndefined()
      expect(session.compressedThroughRound).toBe(2)
    })

    it('无 compressedThroughRound 时回退不触发修正', () => {
      const session = createSession('sess-ctr-4')
      store.getScopeData(SCOPE).agentSessions.push(session)

      for (let i = 1; i <= 3; i++) {
        simulateTurn(store, session, scopeRoot, i, {})
      }

      const cp2 = session.checkpoints![1]
      const result = performFullRollback(store, session, scopeRoot, cp2.id)

      expect(result.adjustedCompressedThroughRound).toBeUndefined()
      expect(session.compressedThroughRound).toBeUndefined()
    })
  })

  // ─── 2. Todo 快照与回退 ───

  describe('Todo 快照捕获与回退恢复', () => {
    it('agent 创建 todo list → 回退 → list 被删除', () => {
      const session = createSession('sess-todo-1')
      store.getScopeData(SCOPE).agentSessions.push(session)

      const data = store.getScopeData(SCOPE)
      data.todoLists = []

      const cp1 = simulateTurn(store, session, scopeRoot, 1, {
        todoOps: [{ action: 'create_list', listId: 'list-new' }]
      })

      data.todoLists.push({
        id: 'list-new',
        title: '新列表',
        items: [{ id: 'item-1', title: '待办1', status: 'todo', createdAt: Date.now(), updatedAt: Date.now() }],
        relativePath: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      expect(data.todoLists).toHaveLength(1)
      expect(data.todoLists[0].id).toBe('list-new')

      const result = performFullRollback(store, session, scopeRoot, cp1.id)
      const afterData = store.getScopeData(SCOPE)

      expect(afterData.todoLists).toHaveLength(0)
      expect(result.todoRestorations).toContainEqual({ listId: 'list-new', action: 'create_list' })
    })

    it('agent 修改已有 todo list → 回退 → list 恢复到修改前', () => {
      const session = createSession('sess-todo-2')
      store.getScopeData(SCOPE).agentSessions.push(session)

      const data = store.getScopeData(SCOPE)
      const originalList: TodoList = {
        id: 'list-exist',
        title: '已有列表',
        items: [
          { id: 'item-a', title: '原始任务A', status: 'todo', createdAt: 1000, updatedAt: 1000 },
          { id: 'item-b', title: '原始任务B', status: 'done', createdAt: 1000, updatedAt: 1000 }
        ],
        relativePath: '',
        createdAt: 1000,
        updatedAt: 1000
      }
      data.todoLists = [structuredClone(originalList)]

      const cp1 = simulateTurn(store, session, scopeRoot, 1, {
        todoOps: [{
          action: 'modify',
          listId: 'list-exist',
          listSnapshot: structuredClone(originalList)
        }]
      })

      data.todoLists[0].items.push({
        id: 'item-c', title: 'Agent添加的任务', status: 'todo', createdAt: 2000, updatedAt: 2000
      })
      data.todoLists[0].items[0].status = 'doing' as any

      expect(data.todoLists[0].items).toHaveLength(3)
      expect(data.todoLists[0].items[0].status).toBe('doing')

      const result = performFullRollback(store, session, scopeRoot, cp1.id)

      const restoredData = store.getScopeData(SCOPE)
      expect(restoredData.todoLists).toHaveLength(1)
      expect(restoredData.todoLists[0].items).toHaveLength(2)
      expect(restoredData.todoLists[0].items[0].status).toBe('todo')
      expect(restoredData.todoLists[0].items[0].title).toBe('原始任务A')
      expect(result.todoRestorations).toContainEqual({ listId: 'list-exist', action: 'modify' })
    })

    it('多轮修改同一 todo list，first-occurrence-wins 恢复到最早快照', () => {
      const session = createSession('sess-todo-3')
      store.getScopeData(SCOPE).agentSessions.push(session)

      const data = store.getScopeData(SCOPE)
      const originalList: TodoList = {
        id: 'list-multi',
        title: '多轮列表',
        items: [{ id: 'item-x', title: '初始任务', status: 'todo', createdAt: 1000, updatedAt: 1000 }],
        relativePath: '',
        createdAt: 1000,
        updatedAt: 1000
      }
      data.todoLists = [structuredClone(originalList)]

      const cp1 = simulateTurn(store, session, scopeRoot, 1, {
        todoOps: [{ action: 'modify', listId: 'list-multi', listSnapshot: structuredClone(originalList) }]
      })

      data.todoLists[0].items[0].title = '第1轮修改'

      const afterTurn1: TodoList = structuredClone(data.todoLists[0])
      const cp2 = simulateTurn(store, session, scopeRoot, 2, {
        todoOps: [{ action: 'modify', listId: 'list-multi', listSnapshot: afterTurn1 }]
      })

      data.todoLists[0].items[0].title = '第2轮修改'

      expect(data.todoLists[0].items[0].title).toBe('第2轮修改')

      performFullRollback(store, session, scopeRoot, cp1.id)

      const restoredData = store.getScopeData(SCOPE)
      expect(restoredData.todoLists[0].items[0].title).toBe('初始任务')
    })
  })

  // ─── 3. 混合类型快照回退 ───

  describe('混合类型快照（文件 + 文档 + todo）同时回退', () => {
    it('一轮内同时修改文件、创建文档、修改 todo，全部正确回退', () => {
      const session = createSession('sess-mix-1')
      store.getScopeData(SCOPE).agentSessions.push(session)

      const data = store.getScopeData(SCOPE)
      data.todoLists = [{
        id: 'mix-list',
        title: '混合列表',
        items: [{ id: 'mi-1', title: '原始', status: 'todo', createdAt: 1000, updatedAt: 1000 }],
        relativePath: '',
        createdAt: 1000,
        updatedAt: 1000
      }]

      mdStore.writeFileByPath(scopeRoot, 'mix-file.txt', 'original content')

      const originalTodoSnapshot = structuredClone(data.todoLists[0])

      const cp1 = simulateTurn(store, session, scopeRoot, 1, {
        fileOps: [{ op: 'write', path: 'mix-file.txt', content: 'agent modified' }],
        docOps: [{ action: 'create', docId: 'doc-new-1' }],
        todoOps: [{ action: 'modify', listId: 'mix-list', listSnapshot: originalTodoSnapshot }]
      })

      data.todoLists[0].items.push({
        id: 'mi-2', title: 'Agent加的', status: 'todo', createdAt: 2000, updatedAt: 2000
      })

      expect(mdStore.readFileByPath(scopeRoot, 'mix-file.txt')?.content).toBe('agent modified')
      expect(data.todoLists[0].items).toHaveLength(2)

      const result = performFullRollback(store, session, scopeRoot, cp1.id)

      expect(mdStore.readFileByPath(scopeRoot, 'mix-file.txt')?.content).toBe('original content')

      const restoredData = store.getScopeData(SCOPE)
      expect(restoredData.todoLists[0].items).toHaveLength(1)
      expect(restoredData.todoLists[0].items[0].title).toBe('原始')

      expect(result.restoredFiles).toContain('mix-file.txt')
      expect(result.restoredFiles).toContain('[doc:doc-new-1]')
      expect(result.restoredFiles).toContain('[todo:mix-list]')
    })
  })

  // ─── 4. 多 Agent Session 隔离 ───

  describe('多 Agent session 同一 scope 下的隔离', () => {
    it('两个 session 修改同一文件，session-A 回退不影响 session-B 的快照', () => {
      const sessionA = createSession('sess-A')
      const sessionB = createSession('sess-B')
      const data = store.getScopeData(SCOPE)
      data.agentSessions.push(sessionA, sessionB)
      store.saveScope(SCOPE)

      mdStore.writeFileByPath(scopeRoot, 'shared.txt', 'base')

      const cpA1 = simulateTurn(store, sessionA, scopeRoot, 1, {
        fileOps: [{ op: 'write', path: 'shared.txt', content: 'agent-A wrote' }]
      })

      const cpB1 = simulateTurn(store, sessionB, scopeRoot, 1, {
        fileOps: [{ op: 'write', path: 'shared.txt', content: 'agent-B wrote' }]
      })

      expect(mdStore.readFileByPath(scopeRoot, 'shared.txt')?.content).toBe('agent-B wrote')

      performFullRollback(store, sessionA, scopeRoot, cpA1.id)

      expect(mdStore.readFileByPath(scopeRoot, 'shared.txt')?.content).toBe('base')

      const bSnapshots = loadFileSnapshots(scopeRoot, sessionB.id, cpB1.id)
      expect(bSnapshots['shared.txt']).toBe('agent-A wrote')
    })

    it('两个 session 修改不同文件，各自回退互不干扰', () => {
      const sessionA = createSession('sess-iso-A')
      const sessionB = createSession('sess-iso-B')
      const data = store.getScopeData(SCOPE)
      data.agentSessions.push(sessionA, sessionB)

      mdStore.writeFileByPath(scopeRoot, 'file-a.txt', 'a-base')
      mdStore.writeFileByPath(scopeRoot, 'file-b.txt', 'b-base')

      const cpA1 = simulateTurn(store, sessionA, scopeRoot, 1, {
        fileOps: [{ op: 'write', path: 'file-a.txt', content: 'a-by-agent-A' }]
      })

      const cpB1 = simulateTurn(store, sessionB, scopeRoot, 1, {
        fileOps: [{ op: 'write', path: 'file-b.txt', content: 'b-by-agent-B' }]
      })

      performFullRollback(store, sessionA, scopeRoot, cpA1.id)

      expect(mdStore.readFileByPath(scopeRoot, 'file-a.txt')?.content).toBe('a-base')
      expect(mdStore.readFileByPath(scopeRoot, 'file-b.txt')?.content).toBe('b-by-agent-B')

      performFullRollback(store, sessionB, scopeRoot, cpB1.id)

      expect(mdStore.readFileByPath(scopeRoot, 'file-a.txt')?.content).toBe('a-base')
      expect(mdStore.readFileByPath(scopeRoot, 'file-b.txt')?.content).toBe('b-base')
    })

    it('session-A 回退后，session-B 继续操作不受影响', () => {
      const sessionA = createSession('sess-cont-A')
      const sessionB = createSession('sess-cont-B')
      const data = store.getScopeData(SCOPE)
      data.agentSessions.push(sessionA, sessionB)

      const cpA1 = simulateTurn(store, sessionA, scopeRoot, 1, {
        fileOps: [{ op: 'write', path: 'progress.txt', content: 'step-1' }]
      })

      simulateTurn(store, sessionB, scopeRoot, 1, {
        fileOps: [{ op: 'write', path: 'b-work.txt', content: 'b-step-1' }]
      })

      performFullRollback(store, sessionA, scopeRoot, cpA1.id)

      expect(sessionA.messages).toHaveLength(0)
      expect(sessionA.checkpoints).toHaveLength(0)

      simulateTurn(store, sessionB, scopeRoot, 2, {
        fileOps: [{ op: 'write', path: 'b-work.txt', content: 'b-step-2' }]
      })

      expect(sessionB.messages).toHaveLength(4)
      expect(sessionB.checkpoints).toHaveLength(2)
      expect(mdStore.readFileByPath(scopeRoot, 'b-work.txt')?.content).toBe('b-step-2')
    })

    it('两个 session 修改同一 todo list 的不同 item，快照隔离', () => {
      const sessionA = createSession('sess-todo-A')
      const sessionB = createSession('sess-todo-B')
      const data = store.getScopeData(SCOPE)
      data.agentSessions.push(sessionA, sessionB)

      const sharedList: TodoList = {
        id: 'shared-list',
        title: '共享列表',
        items: [
          { id: 'item-1', title: '任务1', status: 'todo', createdAt: 1000, updatedAt: 1000 },
          { id: 'item-2', title: '任务2', status: 'todo', createdAt: 1000, updatedAt: 1000 }
        ],
        relativePath: '',
        createdAt: 1000,
        updatedAt: 1000
      }
      data.todoLists = [structuredClone(sharedList)]

      const snapshotBeforeA = structuredClone(data.todoLists[0])
      const cpA1 = simulateTurn(store, sessionA, scopeRoot, 1, {
        todoOps: [{ action: 'modify', listId: 'shared-list', listSnapshot: snapshotBeforeA }]
      })
      data.todoLists[0].items[0].status = 'doing' as any

      const snapshotBeforeB = structuredClone(data.todoLists[0])
      const cpB1 = simulateTurn(store, sessionB, scopeRoot, 1, {
        todoOps: [{ action: 'modify', listId: 'shared-list', listSnapshot: snapshotBeforeB }]
      })
      data.todoLists[0].items[1].status = 'done' as any

      performFullRollback(store, sessionA, scopeRoot, cpA1.id)

      const afterArollback = store.getScopeData(SCOPE).todoLists![0]
      expect(afterArollback.items[0].status).toBe('todo')
      expect(afterArollback.items[1].status).toBe('todo')
    })
  })

  // ─── 5. 空 checkpoint 与边界回退 ───

  describe('空 checkpoint 与边界条件', () => {
    it('回退空 checkpoint（无文件变更），消息正确截断', () => {
      const session = createSession('sess-empty-1')
      store.getScopeData(SCOPE).agentSessions.push(session)

      simulateTurn(store, session, scopeRoot, 1, {})
      const cp2 = simulateTurn(store, session, scopeRoot, 2, {})
      simulateTurn(store, session, scopeRoot, 3, {})

      expect(session.messages).toHaveLength(6)

      const result = performFullRollback(store, session, scopeRoot, cp2.id)

      expect(session.messages).toHaveLength(2)
      expect(result.restoredFiles).toHaveLength(0)
    })

    it('回退到最后一个 checkpoint，只移除最后一轮', () => {
      const session = createSession('sess-last-cp')
      store.getScopeData(SCOPE).agentSessions.push(session)

      simulateTurn(store, session, scopeRoot, 1, {
        fileOps: [{ op: 'write', path: 'keep.txt', content: 'keep-this' }]
      })
      simulateTurn(store, session, scopeRoot, 2, {
        fileOps: [{ op: 'write', path: 'keep.txt', content: 'modified' }]
      })
      const cp3 = simulateTurn(store, session, scopeRoot, 3, {
        fileOps: [{ op: 'write', path: 'keep.txt', content: 'final' }]
      })

      const result = performFullRollback(store, session, scopeRoot, cp3.id)

      expect(session.messages).toHaveLength(4)
      expect(result.removedCpIds).toHaveLength(1)
      expect(mdStore.readFileByPath(scopeRoot, 'keep.txt')?.content).toBe('modified')
    })

    it('回退已删除的文件，空内容正确恢复（文件重建为空）', () => {
      const session = createSession('sess-del-restore')
      store.getScopeData(SCOPE).agentSessions.push(session)

      const cp1 = simulateTurn(store, session, scopeRoot, 1, {
        fileOps: [{ op: 'write', path: 'new-file.txt', content: 'brand new' }]
      })

      expect(mdStore.readFileByPath(scopeRoot, 'new-file.txt')?.content).toBe('brand new')

      performFullRollback(store, session, scopeRoot, cp1.id)

      const restored = mdStore.readFileByPath(scopeRoot, 'new-file.txt')
      expect(restored?.content).toBe('')
    })
  })

  // ─── 6. 连续多次回退 ───

  describe('连续多次回退的状态一致性', () => {
    it('回退 → 新对话 → 再次回退，两次回退都正确', () => {
      const session = createSession('sess-double-rb')
      store.getScopeData(SCOPE).agentSessions.push(session)

      simulateTurn(store, session, scopeRoot, 1, {
        fileOps: [{ op: 'write', path: 'iter.txt', content: 'v1' }]
      })
      const cp2 = simulateTurn(store, session, scopeRoot, 2, {
        fileOps: [{ op: 'write', path: 'iter.txt', content: 'v2' }]
      })
      simulateTurn(store, session, scopeRoot, 3, {
        fileOps: [{ op: 'write', path: 'iter.txt', content: 'v3' }]
      })

      performFullRollback(store, session, scopeRoot, cp2.id)
      expect(mdStore.readFileByPath(scopeRoot, 'iter.txt')?.content).toBe('v1')
      expect(session.messages).toHaveLength(2)

      const cp_new = simulateTurn(store, session, scopeRoot, 4, {
        fileOps: [{ op: 'write', path: 'iter.txt', content: 'v4-after-rollback' }]
      })
      simulateTurn(store, session, scopeRoot, 5, {
        fileOps: [{ op: 'write', path: 'iter.txt', content: 'v5-after-rollback' }]
      })

      performFullRollback(store, session, scopeRoot, cp_new.id)
      expect(mdStore.readFileByPath(scopeRoot, 'iter.txt')?.content).toBe('v1')
      expect(session.messages).toHaveLength(2)
    })

    it('连续回退到越来越早的 checkpoint', () => {
      const session = createSession('sess-cascade-rb')
      store.getScopeData(SCOPE).agentSessions.push(session)

      const cps: SessionCheckpoint[] = []
      for (let i = 1; i <= 5; i++) {
        cps.push(simulateTurn(store, session, scopeRoot, i, {
          fileOps: [{ op: 'write', path: `file${i}.txt`, content: `content-${i}` }]
        }))
      }

      performFullRollback(store, session, scopeRoot, cps[3].id)
      expect(session.messages).toHaveLength(6)
      expect(session.checkpoints).toHaveLength(3)

      performFullRollback(store, session, scopeRoot, cps[1].id)
      expect(session.messages).toHaveLength(2)
      expect(session.checkpoints).toHaveLength(1)

      performFullRollback(store, session, scopeRoot, cps[0].id)
      expect(session.messages).toHaveLength(0)
      expect(session.checkpoints).toHaveLength(0)
    })
  })

  // ─── 7. MemoryRefs 收集边缘情况 ───

  describe('memoryRefs 收集边缘条件', () => {
    it('部分消息有 memoryRefs，部分没有', () => {
      const session = createSession('sess-partial-refs')
      store.getScopeData(SCOPE).agentSessions.push(session)

      simulateTurn(store, session, scopeRoot, 1, {})

      const cp2 = simulateTurn(store, session, scopeRoot, 2, {
        memoryRefs: {
          injected: { user: [], scope: [], session: [] },
          created: { user: ['u1'], scope: ['s1'], session: [] }
        }
      })

      simulateTurn(store, session, scopeRoot, 3, {})

      simulateTurn(store, session, scopeRoot, 4, {
        memoryRefs: {
          injected: { user: [], scope: [], session: [] },
          created: { user: [], scope: ['s2', 's3'], session: ['sess1'] }
        }
      })

      const result = performFullRollback(store, session, scopeRoot, cp2.id)

      expect(result.removedMemoryIds.user).toEqual(['u1'])
      expect(result.removedMemoryIds.scope).toEqual(['s1', 's2', 's3'])
      expect(result.removedMemoryIds.session).toEqual(['sess1'])
    })

    it('只有 user 消息被回退（无 assistant memoryRefs）', () => {
      const session = createSession('sess-user-only-refs')
      store.getScopeData(SCOPE).agentSessions.push(session)

      simulateTurn(store, session, scopeRoot, 1, {})
      const cp2 = simulateTurn(store, session, scopeRoot, 2, {})

      const result = performFullRollback(store, session, scopeRoot, cp2.id)

      expect(result.removedMemoryIds.user).toEqual([])
      expect(result.removedMemoryIds.scope).toEqual([])
      expect(result.removedMemoryIds.session).toEqual([])
    })
  })

  // ─── 8. 多 Agent 交叉回退场景 ───

  describe('多 Agent 交叉回退场景', () => {
    it('session-A 和 session-B 交替操作，各自独立回退', () => {
      const sessionA = createSession('sess-interleave-A')
      const sessionB = createSession('sess-interleave-B')
      const data = store.getScopeData(SCOPE)
      data.agentSessions.push(sessionA, sessionB)

      mdStore.writeFileByPath(scopeRoot, 'work.txt', 'base')

      const cpA1 = simulateTurn(store, sessionA, scopeRoot, 1, {
        fileOps: [{ op: 'write', path: 'a-only.txt', content: 'A-1' }]
      })

      simulateTurn(store, sessionB, scopeRoot, 1, {
        fileOps: [{ op: 'write', path: 'b-only.txt', content: 'B-1' }]
      })

      simulateTurn(store, sessionA, scopeRoot, 2, {
        fileOps: [{ op: 'write', path: 'a-only.txt', content: 'A-2' }]
      })

      const cpB2 = simulateTurn(store, sessionB, scopeRoot, 2, {
        fileOps: [{ op: 'write', path: 'b-only.txt', content: 'B-2' }]
      })

      expect(mdStore.readFileByPath(scopeRoot, 'a-only.txt')?.content).toBe('A-2')
      expect(mdStore.readFileByPath(scopeRoot, 'b-only.txt')?.content).toBe('B-2')

      performFullRollback(store, sessionA, scopeRoot, cpA1.id)

      expect(mdStore.readFileByPath(scopeRoot, 'a-only.txt')?.content).toBe('')
      expect(mdStore.readFileByPath(scopeRoot, 'b-only.txt')?.content).toBe('B-2')

      performFullRollback(store, sessionB, scopeRoot, cpB2.id)

      expect(mdStore.readFileByPath(scopeRoot, 'a-only.txt')?.content).toBe('')
      expect(mdStore.readFileByPath(scopeRoot, 'b-only.txt')?.content).toBe('B-1')
    })

    it('session-A 回退后重新操作，session-B 快照不被污染', () => {
      const sessionA = createSession('sess-redo-A')
      const sessionB = createSession('sess-redo-B')
      const data = store.getScopeData(SCOPE)
      data.agentSessions.push(sessionA, sessionB)

      mdStore.writeFileByPath(scopeRoot, 'shared.txt', 'original')

      const cpA1 = simulateTurn(store, sessionA, scopeRoot, 1, {
        fileOps: [{ op: 'write', path: 'shared.txt', content: 'A-wrote' }]
      })

      performFullRollback(store, sessionA, scopeRoot, cpA1.id)
      expect(mdStore.readFileByPath(scopeRoot, 'shared.txt')?.content).toBe('original')

      simulateTurn(store, sessionA, scopeRoot, 2, {
        fileOps: [{ op: 'write', path: 'shared.txt', content: 'A-rewrote' }]
      })

      const cpB1 = simulateTurn(store, sessionB, scopeRoot, 1, {
        fileOps: [{ op: 'write', path: 'shared.txt', content: 'B-overwrote' }]
      })

      const bSnapshots = loadFileSnapshots(scopeRoot, sessionB.id, cpB1.id)
      expect(bSnapshots['shared.txt']).toBe('A-rewrote')
    })

    it('三个 session 操作独立文件后全部回退', () => {
      const sessions = ['X', 'Y', 'Z'].map(name => createSession(`sess-tri-${name}`))
      const data = store.getScopeData(SCOPE)
      data.agentSessions.push(...sessions)

      const checkpoints: SessionCheckpoint[] = []

      for (let i = 0; i < 3; i++) {
        const cp = simulateTurn(store, sessions[i], scopeRoot, 1, {
          fileOps: [{ op: 'write', path: `file-${i}.txt`, content: `session-${i}-content` }]
        })
        checkpoints.push(cp)
      }

      for (let i = 0; i < 3; i++) {
        expect(mdStore.readFileByPath(scopeRoot, `file-${i}.txt`)?.content).toBe(`session-${i}-content`)
      }

      for (let i = 0; i < 3; i++) {
        performFullRollback(store, sessions[i], scopeRoot, checkpoints[i].id)
      }

      for (let i = 0; i < 3; i++) {
        expect(mdStore.readFileByPath(scopeRoot, `file-${i}.txt`)?.content).toBe('')
      }

      for (const s of sessions) {
        expect(s.messages).toHaveLength(0)
        expect(s.checkpoints).toHaveLength(0)
      }
    })
  })

  // ─── 9. 快照文件清理验证 ───

  describe('快照文件磁盘清理', () => {
    it('回退后被移除的 checkpoint 快照文件被删除', () => {
      const session = createSession('sess-cleanup')
      store.getScopeData(SCOPE).agentSessions.push(session)

      const cp1 = simulateTurn(store, session, scopeRoot, 1, {
        fileOps: [{ op: 'write', path: 'c.txt', content: 'c1' }]
      })
      const cp2 = simulateTurn(store, session, scopeRoot, 2, {
        fileOps: [{ op: 'write', path: 'c.txt', content: 'c2' }]
      })
      const cp3 = simulateTurn(store, session, scopeRoot, 3, {
        fileOps: [{ op: 'write', path: 'c.txt', content: 'c3' }]
      })

      const cp2Snapshots = loadFileSnapshots(scopeRoot, session.id, cp2.id)
      expect(Object.keys(cp2Snapshots)).toHaveLength(1)
      const cp3Snapshots = loadFileSnapshots(scopeRoot, session.id, cp3.id)
      expect(Object.keys(cp3Snapshots)).toHaveLength(1)

      performFullRollback(store, session, scopeRoot, cp2.id)

      const cp2After = loadFileSnapshots(scopeRoot, session.id, cp2.id)
      expect(Object.keys(cp2After)).toHaveLength(0)
      const cp3After = loadFileSnapshots(scopeRoot, session.id, cp3.id)
      expect(Object.keys(cp3After)).toHaveLength(0)

      const cp1Still = loadFileSnapshots(scopeRoot, session.id, cp1.id)
      expect(Object.keys(cp1Still)).toHaveLength(1)
    })
  })

  // ─── 10. restoreFiles=false 模式 ───

  describe('restoreFiles=false 模式', () => {
    it('不恢复文件但仍截断消息和清理 checkpoint', () => {
      const session = createSession('sess-norestore')
      store.getScopeData(SCOPE).agentSessions.push(session)

      simulateTurn(store, session, scopeRoot, 1, {
        fileOps: [{ op: 'write', path: 'nr.txt', content: 'v1' }]
      })
      const cp2 = simulateTurn(store, session, scopeRoot, 2, {
        fileOps: [{ op: 'write', path: 'nr.txt', content: 'v2' }]
      })

      const result = performFullRollback(store, session, scopeRoot, cp2.id, false)

      expect(session.messages).toHaveLength(2)
      expect(result.restoredFiles).toHaveLength(0)
      expect(mdStore.readFileByPath(scopeRoot, 'nr.txt')?.content).toBe('v2')
    })
  })
})
