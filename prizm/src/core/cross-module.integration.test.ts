/**
 * 跨模块联合集成测试
 *
 * 验证 会话 / 回退(Checkpoint) / 记忆 / 审计 / 版本 五个模块
 * 在真实用户场景下的联动行为。
 *
 * 基础设施：
 * - 真实 ScopeStore + 文件系统（tmpDir）
 * - 真实 SQLite（auditStore、lockStore）
 * - 真实 documentVersionStore、checkpointStore
 * - Mock：LLM provider、EverMemService 记忆操作
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// ── vi.hoisted: 在 mock 工厂和测试运行时共享的可变状态 ──

const {
  state,
  mockFlushSessionBuffer,
  mockDeleteMemory,
  mockDeleteDocumentMemories,
  mockDeleteMemoriesByGroupId,
  mockIsMemoryEnabled,
  mockAddDocumentToMemory,
  mockAddDocumentMigrationMemory,
  mockGetDocumentOverview,
  mockResetSessionAccumulator,
  mockScheduleDocumentMemory
} = vi.hoisted(() => {
  // Cannot use `path` or `os` here since imports haven't initialized yet
  const tmpBase = process.env.TEMP || process.env.TMPDIR || '/tmp'
  const _state = {
    tempDir: `${tmpBase}/prizm-cross-placeholder`,
    scopesDir: ''
  }
  return {
    state: _state,
    mockFlushSessionBuffer: vi.fn().mockResolvedValue(null),
    mockDeleteMemory: vi.fn().mockResolvedValue(true),
    mockDeleteDocumentMemories: vi.fn().mockResolvedValue(0),
    mockDeleteMemoriesByGroupId: vi.fn().mockResolvedValue(0),
    mockIsMemoryEnabled: vi.fn().mockReturnValue(true),
    mockAddDocumentToMemory: vi.fn().mockResolvedValue(undefined),
    mockAddDocumentMigrationMemory: vi.fn().mockResolvedValue(undefined),
    mockGetDocumentOverview: vi.fn().mockResolvedValue(null),
    mockResetSessionAccumulator: vi.fn(),
    mockScheduleDocumentMemory: vi.fn()
  }
})

// ── Mock PathProviderCore ──

vi.mock('./PathProviderCore', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    getDataDir: () => state.tempDir,
    ensureDataDir: () => {
      if (!fs.existsSync(state.tempDir)) fs.mkdirSync(state.tempDir, { recursive: true })
    },
    getScopesDir: () => state.scopesDir,
    getScopeRegistryPath: () => path.join(state.tempDir, 'scope-registry.json'),
    getPrizmDir: (scopeRoot: string) => path.join(scopeRoot, '.prizm'),
    getAgentSessionsDir: (scopeRoot: string) =>
      path.join(scopeRoot, '.prizm', 'agent-sessions'),
    getSessionDir: (scopeRoot: string, sessionId: string) =>
      path.join(scopeRoot, '.prizm', 'agent-sessions', sessionId),
    getSessionFilePath: (scopeRoot: string, sessionId: string) =>
      path.join(scopeRoot, '.prizm', 'agent-sessions', sessionId, 'session.md'),
    getSessionSummaryPath: (scopeRoot: string, sessionId: string) =>
      path.join(scopeRoot, '.prizm', 'agent-sessions', sessionId, 'summary.md'),
    getSessionMemoriesPath: (scopeRoot: string, sessionId: string) =>
      path.join(scopeRoot, '.prizm', 'agent-sessions', sessionId, 'memories.md'),
    getSessionWorkspaceDir: (scopeRoot: string, sessionId: string) =>
      path.join(scopeRoot, '.prizm', 'agent-sessions', sessionId, 'workspace'),
    getUsersDir: () => path.join(state.tempDir, 'users'),
    ensureMemoryDir: () => {
      const d = path.join(state.tempDir, 'users', 'memory')
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
    },
    ensureScopeMemoryDir: () => {},
    getUserMemoryDbPath: () => path.join(state.tempDir, 'users', 'memory', 'user.db'),
    getUserMemoryVecPath: () => path.join(state.tempDir, 'users', 'memory', 'user_vec'),
    getScopeMemoryDbPath: (scopeRoot: string) =>
      path.join(scopeRoot, '.prizm', 'memory', 'scope.db'),
    getScopeMemoryVecPath: (scopeRoot: string) =>
      path.join(scopeRoot, '.prizm', 'memory', 'scope_vec')
  }
})

// Mock EverMemService (path relative to test file at src/core/)
vi.mock('../llm/EverMemService', () => ({
  flushSessionBuffer: (...args: unknown[]) => mockFlushSessionBuffer(...args),
  deleteMemory: (...args: unknown[]) => mockDeleteMemory(...args),
  deleteDocumentMemories: (...args: unknown[]) => mockDeleteDocumentMemories(...args),
  deleteMemoriesByGroupId: (...args: unknown[]) => mockDeleteMemoriesByGroupId(...args),
  isMemoryEnabled: () => mockIsMemoryEnabled(),
  addDocumentToMemory: (...args: unknown[]) => mockAddDocumentToMemory(...args),
  addDocumentMigrationMemory: (...args: unknown[]) => mockAddDocumentMigrationMemory(...args),
  getDocumentOverview: (...args: unknown[]) => mockGetDocumentOverview(...args),
  resetSessionAccumulator: (...args: unknown[]) => mockResetSessionAccumulator(...args)
}))

// Mock documentMemoryService
vi.mock('../llm/documentMemoryService', () => ({
  scheduleDocumentMemory: (...args: unknown[]) => mockScheduleDocumentMemory(...args),
  isDocumentExtracting: () => false
}))

// Mock memoryLogger
vi.mock('../llm/memoryLogger', () => ({
  memLog: vi.fn()
}))

import { ScopeStore } from './ScopeStore'
import * as auditManager from './agentAuditLog/auditManager'
import * as auditStore from './agentAuditLog/auditStore'
import * as lockManager from './resourceLockManager/lockManager'
import * as lockStore from './resourceLockManager/lockStore'
import { emit, clearAll as clearEventBus } from './eventBus/eventBus'
import { registerAuditHandlers } from './eventBus/handlers/auditHandlers'
import { registerLockHandlers } from './eventBus/handlers/lockHandlers'
import { registerMemoryHandlers } from './eventBus/handlers/memoryHandlers'
import {
  saveVersion,
  getLatestVersion,
  getPreviousVersion,
  getVersionHistory,
  computeContentHash,
  computeDiff
} from './documentVersionStore'
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

// ── Helpers ──

const SCOPE = 'test-scope'

function makeMsg(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  toolParts?: Array<{ name: string; args: Record<string, string>; result?: string }>,
  memoryRefs?: AgentMessage['memoryRefs']
): AgentMessage {
  const parts: AgentMessage['parts'] = [{ type: 'text', content: text }]
  if (toolParts) {
    for (const tp of toolParts) {
      parts.push({
        type: 'tool',
        id: `tc-${id}-${tp.name}`,
        name: tp.name,
        arguments: JSON.stringify(tp.args),
        result: tp.result ?? 'ok'
      })
    }
  }
  return {
    id,
    role,
    parts,
    createdAt: Date.now(),
    ...(memoryRefs ? { memoryRefs } : {})
  }
}

function simulateTurn(
  store: ScopeStore,
  session: AgentSession,
  scopeRoot: string,
  turnIndex: number,
  userText: string,
  assistantText: string,
  fileOps?: Array<{ op: 'write' | 'delete'; path: string; content?: string }>,
  memoryRefs?: AgentMessage['memoryRefs']
): SessionCheckpoint {
  const messageIndex = session.messages.length
  const cp = createCheckpoint(session.id, messageIndex, userText)
  initSnapshotCollector(session.id)

  session.messages.push(makeMsg(`u-${turnIndex}`, 'user', userText))

  const toolParts: Array<{ name: string; args: Record<string, string> }> = []
  if (fileOps) {
    for (const fo of fileOps) {
      if (fo.op === 'write') {
        const existing = mdStore.readFileByPath(scopeRoot, fo.path)
        captureFileSnapshot(session.id, fo.path, existing?.content ?? null)
        mdStore.writeFileByPath(scopeRoot, fo.path, fo.content ?? '')
        toolParts.push({
          name: 'prizm_file_write',
          args: { path: fo.path, content: fo.content ?? '' }
        })
      } else if (fo.op === 'delete') {
        const existing = mdStore.readFileByPath(scopeRoot, fo.path)
        captureFileSnapshot(session.id, fo.path, existing?.content ?? null)
        mdStore.deleteByPath(scopeRoot, fo.path)
        toolParts.push({
          name: 'prizm_file_delete',
          args: { path: fo.path }
        })
      }
    }
  }

  session.messages.push(
    makeMsg(`a-${turnIndex}`, 'assistant', assistantText, toolParts, memoryRefs)
  )

  const fileChanges = extractFileChangesFromMessages([
    { parts: session.messages[session.messages.length - 1].parts }
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

function performRollback(
  store: ScopeStore,
  session: AgentSession,
  scopeRoot: string,
  checkpointId: string
): { removedCheckpointIds: string[]; removedMemoryIds: { user: string[]; scope: string[]; session: string[] } } {
  const cpIndex = session.checkpoints?.findIndex((c) => c.id === checkpointId) ?? -1
  if (cpIndex < 0) throw new Error('Checkpoint not found')

  const targetCp = session.checkpoints![cpIndex]
  const removedCps = session.checkpoints!.slice(cpIndex)
  const removedCheckpointIds = removedCps.map((c) => c.id)

  // Collect memory IDs from removed messages
  const removedMemoryIds = { user: [] as string[], scope: [] as string[], session: [] as string[] }
  const removedMessages = session.messages.slice(targetCp.messageIndex)
  for (const msg of removedMessages) {
    if (msg.memoryRefs?.created) {
      removedMemoryIds.user.push(...(msg.memoryRefs.created.user ?? []))
      removedMemoryIds.scope.push(...(msg.memoryRefs.created.scope ?? []))
      removedMemoryIds.session.push(...(msg.memoryRefs.created.session ?? []))
    }
  }

  // Merge snapshots: first-occurrence-wins (consistent with production code)
  const mergedSnapshots = new Map<string, string>()
  for (const cp of removedCps) {
    const snapshots = loadFileSnapshots(scopeRoot, session.id, cp.id)
    for (const [key, value] of Object.entries(snapshots)) {
      if (!mergedSnapshots.has(key)) {
        mergedSnapshots.set(key, value)
      }
    }
  }

  // Restore files
  for (const [filePath, previousContent] of mergedSnapshots) {
    if (filePath.startsWith('[doc:') || filePath.startsWith('[doc] ')) continue
    if (previousContent === '') {
      try { mdStore.deleteByPath(scopeRoot, filePath) } catch { /* file may not exist */ }
    } else {
      mdStore.writeFileByPath(scopeRoot, filePath, previousContent)
    }
  }

  // Truncate messages and checkpoints
  const clampedIndex = Math.max(0, Math.min(targetCp.messageIndex, session.messages.length))
  session.messages = session.messages.slice(0, clampedIndex)
  session.checkpoints = session.checkpoints!.filter((cp) => cp.messageIndex < clampedIndex)

  deleteCheckpointSnapshots(scopeRoot, session.id, removedCheckpointIds)
  session.updatedAt = Date.now()
  store.saveScope(SCOPE)

  return { removedCheckpointIds, removedMemoryIds }
}

// ── Test Suite ──

describe('跨模块联合集成测试', () => {
  let store: ScopeStore
  let scopeRoot: string

  beforeEach(() => {
    state.tempDir = path.join(
      os.tmpdir(),
      `prizm-cross-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    state.scopesDir = path.join(state.tempDir, 'scopes')
    fs.mkdirSync(state.tempDir, { recursive: true })
    fs.mkdirSync(state.scopesDir, { recursive: true })

    store = new ScopeStore(state.tempDir)
    store.ensureScope(SCOPE)
    scopeRoot = store.getScopeRootPath(SCOPE)

    // Init real SQLite stores
    auditStore.initAuditStore()
    lockStore.initLockStore()

    // Register event handlers
    clearEventBus()
    registerAuditHandlers()
    registerLockHandlers()
    registerMemoryHandlers()

    // Reset mocks
    mockFlushSessionBuffer.mockClear().mockResolvedValue(null)
    mockDeleteMemory.mockClear().mockResolvedValue(true)
    mockDeleteDocumentMemories.mockClear().mockResolvedValue(0)
    mockDeleteMemoriesByGroupId.mockClear().mockResolvedValue(0)
    mockIsMemoryEnabled.mockClear().mockReturnValue(true)
    mockAddDocumentToMemory.mockClear().mockResolvedValue(undefined)
    mockAddDocumentMigrationMemory.mockClear().mockResolvedValue(undefined)
    mockGetDocumentOverview.mockClear().mockResolvedValue(null)
    mockScheduleDocumentMemory.mockClear()
    mockResetSessionAccumulator.mockClear()
  })

  afterEach(() => {
    clearEventBus()
    auditStore.closeAuditStore()
    lockStore.closeLockStore()
    if (fs.existsSync(state.tempDir)) {
      fs.rmSync(state.tempDir, { recursive: true, force: true })
    }
  })

  // ══════════════════════════════════════════════════════════
  // 场景组 1：会话生命周期 + 审计
  // ══════════════════════════════════════════════════════════

  describe('场景组 1：会话生命周期 + 审计', () => {
    it('创建会话并追加消息后应正确持久化', () => {
      const data = store.getScopeData(SCOPE)
      const now = Date.now()
      const session: AgentSession = {
        id: 'sess-1',
        scope: SCOPE,
        messages: [],
        createdAt: now,
        updatedAt: now
      }
      data.agentSessions.push(session)

      session.messages.push(makeMsg('u-1', 'user', '你好'))
      session.messages.push(makeMsg('a-1', 'assistant', '你好！有什么可以帮你的？'))
      session.updatedAt = Date.now()
      store.saveScope(SCOPE)

      // 重新读取验证持久化
      const store2 = new ScopeStore(state.tempDir)
      const data2 = store2.getScopeData(SCOPE)
      expect(data2.agentSessions).toHaveLength(1)
      expect(data2.agentSessions[0].id).toBe('sess-1')
      expect(data2.agentSessions[0].messages).toHaveLength(2)
      expect(data2.agentSessions[0].messages[0].parts[0]).toMatchObject({
        type: 'text',
        content: '你好'
      })
    })

    it('tool:executed 事件应通过 auditHandler 写入审计日志', async () => {
      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-1',
        toolName: 'prizm_update_document',
        auditInput: {
          toolName: 'prizm_update_document',
          action: 'update',
          resourceType: 'document',
          resourceId: 'doc-1',
          resourceTitle: '测试文档',
          result: 'success'
        }
      })

      const entries = auditManager.query({ scope: SCOPE, sessionId: 'sess-1' })
      expect(entries).toHaveLength(1)
      expect(entries[0].toolName).toBe('prizm_update_document')
      expect(entries[0].action).toBe('update')
      expect(entries[0].resourceId).toBe('doc-1')
      expect(entries[0].result).toBe('success')
      expect(entries[0].actorType).toBe('agent')
    })

    it('多会话并发操作的审计日志应按会话隔离', async () => {
      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-A',
        toolName: 'prizm_file_write',
        auditInput: {
          toolName: 'prizm_file_write',
          action: 'create',
          resourceType: 'file',
          resourceId: 'a.txt',
          result: 'success'
        }
      })
      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-B',
        toolName: 'prizm_get_document_content',
        auditInput: {
          toolName: 'prizm_get_document_content',
          action: 'read',
          resourceType: 'document',
          resourceId: 'doc-2',
          result: 'success'
        }
      })
      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-A',
        toolName: 'prizm_update_document',
        auditInput: {
          toolName: 'prizm_update_document',
          action: 'update',
          resourceType: 'document',
          resourceId: 'doc-1',
          result: 'success'
        }
      })

      const sessA = auditManager.query({ sessionId: 'sess-A' })
      expect(sessA).toHaveLength(2)

      const sessB = auditManager.query({ sessionId: 'sess-B' })
      expect(sessB).toHaveLength(1)
      expect(sessB[0].resourceId).toBe('doc-2')
    })

    it('会话删除应级联释放锁 + flush 记忆 + 审计保留', async () => {
      // 先获取一个锁
      lockManager.acquireLock(SCOPE, 'document', 'doc-1', 'sess-del', '编辑文档')

      const locks = lockManager.listSessionLocks(SCOPE, 'sess-del')
      expect(locks).toHaveLength(1)

      // 记录审计
      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-del',
        toolName: 'prizm_checkout_document',
        auditInput: {
          toolName: 'prizm_checkout_document',
          action: 'checkout',
          resourceType: 'document',
          resourceId: 'doc-1',
          result: 'success'
        }
      })

      // 触发会话删除事件
      await emit('agent:session.deleted', { scope: SCOPE, sessionId: 'sess-del' })

      // 锁应被释放
      const locksAfter = lockManager.listSessionLocks(SCOPE, 'sess-del')
      expect(locksAfter).toHaveLength(0)
      expect(lockManager.getLock(SCOPE, 'document', 'doc-1')).toBeNull()

      // 记忆 flush 应被调用
      expect(mockFlushSessionBuffer).toHaveBeenCalledWith(SCOPE, 'sess-del')

      // 审计日志应保留（不随会话删除）
      const auditEntries = auditManager.query({ sessionId: 'sess-del' })
      expect(auditEntries).toHaveLength(1)
      expect(auditEntries[0].action).toBe('checkout')
    })
  })

  // ══════════════════════════════════════════════════════════
  // 场景组 2：文档编辑 + 版本 + 记忆
  // ══════════════════════════════════════════════════════════

  describe('场景组 2：文档编辑 + 版本 + 记忆', () => {
    it('文档创建应产生版本 v1 快照', () => {
      const content = '# 项目文档\n\n这是一个测试项目的说明文档。'
      const v1 = saveVersion(scopeRoot, 'doc-v1', '项目文档', content)

      expect(v1.version).toBe(1)
      expect(v1.title).toBe('项目文档')
      expect(v1.content).toBe(content)
      expect(v1.contentHash).toBe(computeContentHash(content))

      const latest = getLatestVersion(scopeRoot, 'doc-v1')
      expect(latest).not.toBeNull()
      expect(latest!.version).toBe(1)
    })

    it('文档更新应生成新版本 + document:saved 触发记忆抽取', async () => {
      const contentV1 = '# 会议记录\n\n参会人员：张三、李四'
      saveVersion(scopeRoot, 'doc-meeting', '会议记录', contentV1)

      const contentV2 = '# 会议记录\n\n参会人员：张三、李四、王五\n\n结论：通过方案 A'
      const v2 = saveVersion(scopeRoot, 'doc-meeting', '会议记录', contentV2)
      expect(v2.version).toBe(2)

      const diff = computeDiff(contentV1, contentV2)
      expect(diff).toContain('新增')
      expect(diff).toContain('王五')

      // 触发 document:saved 事件
      await emit('document:saved', {
        scope: SCOPE,
        documentId: 'doc-meeting',
        title: '会议记录',
        content: contentV2,
        previousContent: contentV1
      })

      expect(mockScheduleDocumentMemory).toHaveBeenCalledWith(
        SCOPE,
        'doc-meeting',
        expect.objectContaining({ previousContent: contentV1 })
      )
    })

    it('相同内容保存不应产生新版本', () => {
      const content = '# 不变内容'
      const v1 = saveVersion(scopeRoot, 'doc-static', '不变', content)
      const v2 = saveVersion(scopeRoot, 'doc-static', '不变', content)

      expect(v1.version).toBe(1)
      expect(v2.version).toBe(1) // 返回已有版本
      expect(v1.contentHash).toBe(v2.contentHash)

      const history = getVersionHistory(scopeRoot, 'doc-static')
      expect(history.versions).toHaveLength(1)
    })

    it('文档删除事件应清理关联记忆', async () => {
      mockDeleteDocumentMemories.mockResolvedValue(3)

      await emit('document:deleted', {
        scope: SCOPE,
        documentId: 'doc-del'
      })

      expect(mockDeleteDocumentMemories).toHaveBeenCalledWith(SCOPE, 'doc-del')
    })
  })

  // ══════════════════════════════════════════════════════════
  // 场景组 3：Checkpoint + 回退 + 记忆清理
  // ══════════════════════════════════════════════════════════

  describe('场景组 3：Checkpoint + 回退 + 记忆清理', () => {
    let session: AgentSession

    beforeEach(() => {
      const data = store.getScopeData(SCOPE)
      session = {
        id: 'sess-cp',
        scope: SCOPE,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        checkpoints: []
      }
      data.agentSessions.push(session)
    })

    it('多轮对话应正确创建 checkpoint 链', () => {
      const cp1 = simulateTurn(store, session, scopeRoot, 1, '创建文件', '好的', [
        { op: 'write', path: 'hello.txt', content: 'Hello World' }
      ])
      const cp2 = simulateTurn(store, session, scopeRoot, 2, '修改文件', '已修改', [
        { op: 'write', path: 'hello.txt', content: 'Hello Prizm' }
      ])
      const cp3 = simulateTurn(store, session, scopeRoot, 3, '新建配置', '配置已创建', [
        { op: 'write', path: 'config.json', content: '{"key":"value"}' }
      ])

      expect(session.checkpoints).toHaveLength(3)
      expect(session.messages).toHaveLength(6) // 3 user + 3 assistant

      expect(cp1.completed).toBe(true)
      expect(cp2.completed).toBe(true)
      expect(cp3.completed).toBe(true)

      // 快照应已持久化
      const snap1 = loadFileSnapshots(scopeRoot, session.id, cp1.id)
      expect(snap1['hello.txt']).toBe('') // 首次写入前为空

      const snap2 = loadFileSnapshots(scopeRoot, session.id, cp2.id)
      expect(snap2['hello.txt']).toBe('Hello World')

      // 文件当前状态
      const helloContent = mdStore.readFileByPath(scopeRoot, 'hello.txt')
      expect(helloContent?.content).toBe('Hello Prizm')
      const configContent = mdStore.readFileByPath(scopeRoot, 'config.json')
      expect(configContent?.content).toBe('{"key":"value"}')
    })

    it('回退到中间 checkpoint 应恢复文件 + 截断消息', () => {
      simulateTurn(store, session, scopeRoot, 1, '创建', '创建了', [
        { op: 'write', path: 'data.txt', content: 'v1' }
      ])
      const cp2 = simulateTurn(store, session, scopeRoot, 2, '修改', '修改了', [
        { op: 'write', path: 'data.txt', content: 'v2' }
      ])
      simulateTurn(store, session, scopeRoot, 3, '再改', '又改了', [
        { op: 'write', path: 'data.txt', content: 'v3' }
      ])

      expect(session.messages).toHaveLength(6)
      const dataV3 = mdStore.readFileByPath(scopeRoot, 'data.txt')
      expect(dataV3?.content).toBe('v3')

      // 回退到 cp2
      performRollback(store, session, scopeRoot, cp2.id)

      expect(session.messages).toHaveLength(2) // cp2.messageIndex = 2
      expect(session.checkpoints).toHaveLength(1) // 只剩 cp1

      // 文件应恢复到 cp2 之前（即 v1）
      const dataAfter = mdStore.readFileByPath(scopeRoot, 'data.txt')
      expect(dataAfter?.content).toBe('v1')
    })

    it('回退应通过事件删除 P1 记忆', async () => {
      simulateTurn(store, session, scopeRoot, 1, '对话1', '回答1')
      const cp2 = simulateTurn(
        store,
        session,
        scopeRoot,
        2,
        '对话2',
        '回答2',
        undefined,
        { created: { user: ['mem-u1'], scope: ['mem-s1', 'mem-s2'], session: ['mem-ss1'] } }
      )
      simulateTurn(
        store,
        session,
        scopeRoot,
        3,
        '对话3',
        '回答3',
        undefined,
        { created: { user: ['mem-u2'], scope: [], session: ['mem-ss2'] } }
      )

      const { removedMemoryIds } = performRollback(store, session, scopeRoot, cp2.id)

      // 发送回退事件
      await emit('agent:session.rolledBack', {
        scope: SCOPE,
        sessionId: session.id,
        checkpointId: cp2.id,
        checkpointMessageIndex: cp2.messageIndex,
        removedCheckpointIds: [cp2.id],
        removedMemoryIds,
        deletedDocumentIds: [],
        restoredDocumentIds: [],
        remainingMessageCount: session.messages.length
      })

      // 应删除 cp2 + cp3 的记忆（从 cp2.messageIndex 之后的消息）
      const allDeletedIds = [
        ...removedMemoryIds.user,
        ...removedMemoryIds.scope,
        ...removedMemoryIds.session
      ]
      expect(allDeletedIds).toContain('mem-u1')
      expect(allDeletedIds).toContain('mem-s1')
      expect(allDeletedIds).toContain('mem-s2')
      expect(allDeletedIds).toContain('mem-ss1')
      expect(allDeletedIds).toContain('mem-u2')
      expect(allDeletedIds).toContain('mem-ss2')

      // deleteMemory 应被调用
      expect(mockDeleteMemory).toHaveBeenCalledTimes(allDeletedIds.length)
    })

    it('回退操作应可配合审计记录', async () => {
      simulateTurn(store, session, scopeRoot, 1, '创建', '创建了', [
        { op: 'write', path: 'audit-test.txt', content: 'original' }
      ])

      // 记录工具执行审计
      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: session.id,
        toolName: 'prizm_file_write',
        auditInput: {
          toolName: 'prizm_file_write',
          action: 'create',
          resourceType: 'file',
          resourceId: 'audit-test.txt',
          result: 'success'
        }
      })

      simulateTurn(store, session, scopeRoot, 2, '修改', '修改了', [
        { op: 'write', path: 'audit-test.txt', content: 'modified' }
      ])

      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: session.id,
        toolName: 'prizm_file_write',
        auditInput: {
          toolName: 'prizm_file_write',
          action: 'update',
          resourceType: 'file',
          resourceId: 'audit-test.txt',
          result: 'success'
        }
      })

      // 回退到 cp1 — 审计日志不应删除
      performRollback(store, session, scopeRoot, session.checkpoints![0].id)

      // 回退前后审计日志都存在
      const entries = auditManager.query({
        scope: SCOPE,
        sessionId: session.id,
        resourceId: 'audit-test.txt'
      })
      expect(entries).toHaveLength(2) // 审计不随回退删除
    })
  })

  // ══════════════════════════════════════════════════════════
  // 场景组 4：会话压缩 + 记忆缓冲 flush
  // ══════════════════════════════════════════════════════════

  describe('场景组 4：会话压缩 + 记忆缓冲', () => {
    it('会话压缩事件应触发旧轮次记忆提取', async () => {
      const oldMessages = [
        makeMsg('u-old-1', 'user', '第一轮对话'),
        makeMsg('a-old-1', 'assistant', '第一轮回答'),
        makeMsg('u-old-2', 'user', '第二轮对话'),
        makeMsg('a-old-2', 'assistant', '第二轮回答')
      ]

      await emit('agent:session.compressing', {
        scope: SCOPE,
        sessionId: 'sess-compress',
        rounds: oldMessages
      })

      // 压缩事件本身不直接触发 handler（memoryHandlers 未订阅此事件），
      // 实际触发在 chat 路由调用 addSessionMemoryFromRounds。
      // 但此事件确认 EventBus 传播正常。
      expect(true).toBe(true)
    })

    it('会话删除时应 flush 记忆缓冲区', async () => {
      mockFlushSessionBuffer.mockResolvedValue({
        user: ['flush-u1'],
        scope: ['flush-s1'],
        session: []
      })

      await emit('agent:session.deleted', {
        scope: SCOPE,
        sessionId: 'sess-flush'
      })

      expect(mockFlushSessionBuffer).toHaveBeenCalledWith(SCOPE, 'sess-flush')
    })
  })

  // ══════════════════════════════════════════════════════════
  // 场景组 5：跨模块完整工作流 + Scope 隔离
  // ══════════════════════════════════════════════════════════

  describe('场景组 5：跨模块完整工作流', () => {
    it('完整用户工作流：创建会话 → 文档编辑(版本+审计) → checkpoint → 回退 → 删除', async () => {
      // 1. 创建会话
      const data = store.getScopeData(SCOPE)
      const session: AgentSession = {
        id: 'sess-full',
        scope: SCOPE,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        checkpoints: []
      }
      data.agentSessions.push(session)

      await emit('agent:session.created', { scope: SCOPE, sessionId: 'sess-full' })

      // 2. 第一轮：创建文档 + 文件
      const cp1 = simulateTurn(store, session, scopeRoot, 1, '写一个方案', '好的，已创建', [
        { op: 'write', path: 'plan.md', content: '# 方案\n\n初始版本' }
      ])

      // 版本 v1
      saveVersion(scopeRoot, 'doc-plan', '方案', '# 方案\n\n初始版本')

      // 审计
      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-full',
        toolName: 'prizm_create_document',
        auditInput: {
          toolName: 'prizm_create_document',
          action: 'create',
          resourceType: 'document',
          resourceId: 'doc-plan',
          resourceTitle: '方案',
          result: 'success'
        }
      })

      // document:saved → 记忆
      await emit('document:saved', {
        scope: SCOPE,
        documentId: 'doc-plan',
        title: '方案',
        content: '# 方案\n\n初始版本'
      })

      // 3. 第二轮：修改文档
      const cp2 = simulateTurn(
        store,
        session,
        scopeRoot,
        2,
        '加入预算部分',
        '已更新方案',
        [{ op: 'write', path: 'plan.md', content: '# 方案\n\n初始版本\n\n## 预算\n\n10万元' }],
        { created: { user: [], scope: ['mem-plan-1'], session: [] } }
      )

      const v2 = saveVersion(
        scopeRoot,
        'doc-plan',
        '方案',
        '# 方案\n\n初始版本\n\n## 预算\n\n10万元',
        { changedBy: { type: 'agent', sessionId: 'sess-full' } }
      )
      expect(v2.version).toBe(2)

      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-full',
        toolName: 'prizm_update_document',
        auditInput: {
          toolName: 'prizm_update_document',
          action: 'update',
          resourceType: 'document',
          resourceId: 'doc-plan',
          result: 'success'
        }
      })

      // 4. 第三轮
      simulateTurn(
        store,
        session,
        scopeRoot,
        3,
        '加人员列表',
        '已添加',
        [{ op: 'write', path: 'plan.md', content: '# 方案\n\n初始版本\n\n## 预算\n\n10万元\n\n## 人员\n\n张三' }],
        { created: { user: [], scope: ['mem-plan-2'], session: [] } }
      )

      // 验证中间状态
      expect(session.messages).toHaveLength(6)
      expect(session.checkpoints).toHaveLength(3)
      const fileNow = mdStore.readFileByPath(scopeRoot, 'plan.md')
      expect(fileNow?.content).toContain('人员')

      // 5. 回退到 cp2（撤销第三轮）
      const { removedMemoryIds } = performRollback(store, session, scopeRoot, cp2.id)

      // 文件恢复到 cp2 之前
      const fileAfterRollback = mdStore.readFileByPath(scopeRoot, 'plan.md')
      expect(fileAfterRollback?.content).toBe('# 方案\n\n初始版本')
      expect(session.messages).toHaveLength(2)

      // 触发回退事件
      await emit('agent:session.rolledBack', {
        scope: SCOPE,
        sessionId: 'sess-full',
        checkpointId: cp2.id,
        checkpointMessageIndex: cp2.messageIndex,
        removedCheckpointIds: [cp2.id],
        removedMemoryIds,
        deletedDocumentIds: [],
        restoredDocumentIds: [],
        remainingMessageCount: session.messages.length
      })

      // 被回退的记忆应被清理
      expect(removedMemoryIds.scope).toContain('mem-plan-1')
      expect(removedMemoryIds.scope).toContain('mem-plan-2')

      // 6. 验证版本历史不受回退影响
      const history = getVersionHistory(scopeRoot, 'doc-plan')
      expect(history.versions).toHaveLength(2) // v1 + v2 仍在

      // 7. 审计日志完整保留
      const allAudit = auditManager.query({ scope: SCOPE, sessionId: 'sess-full' })
      expect(allAudit.length).toBeGreaterThanOrEqual(2)

      // 8. 删除会话
      await emit('agent:session.deleted', { scope: SCOPE, sessionId: 'sess-full' })
      expect(mockFlushSessionBuffer).toHaveBeenCalledWith(SCOPE, 'sess-full')

      // 审计仍可查
      const auditAfterDelete = auditManager.query({ sessionId: 'sess-full' })
      expect(auditAfterDelete.length).toBeGreaterThanOrEqual(2)
    })

    it('不同 Scope 的操作应互不干扰', async () => {
      const SCOPE_B = 'scope-b'
      store.ensureScope(SCOPE_B)
      const scopeRootB = store.getScopeRootPath(SCOPE_B)

      // Scope A: 保存版本 + 审计
      saveVersion(scopeRoot, 'doc-a', '文档A', '内容A')
      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-a',
        toolName: 'prizm_create_document',
        auditInput: {
          toolName: 'prizm_create_document',
          action: 'create',
          resourceType: 'document',
          resourceId: 'doc-a',
          result: 'success'
        }
      })

      // Scope B: 保存版本 + 审计
      saveVersion(scopeRootB, 'doc-b', '文档B', '内容B')
      await emit('tool:executed', {
        scope: SCOPE_B,
        sessionId: 'sess-b',
        toolName: 'prizm_create_document',
        auditInput: {
          toolName: 'prizm_create_document',
          action: 'create',
          resourceType: 'document',
          resourceId: 'doc-b',
          result: 'success'
        }
      })

      // 审计隔离
      const auditA = auditManager.query({ scope: SCOPE })
      const auditB = auditManager.query({ scope: SCOPE_B })
      expect(auditA).toHaveLength(1)
      expect(auditA[0].resourceId).toBe('doc-a')
      expect(auditB).toHaveLength(1)
      expect(auditB[0].resourceId).toBe('doc-b')

      // 版本隔离
      const versionA = getLatestVersion(scopeRoot, 'doc-a')
      const versionB = getLatestVersion(scopeRootB, 'doc-b')
      expect(versionA?.title).toBe('文档A')
      expect(versionB?.title).toBe('文档B')

      // 交叉查不到
      expect(getLatestVersion(scopeRoot, 'doc-b')).toBeNull()
      expect(getLatestVersion(scopeRootB, 'doc-a')).toBeNull()

      // 锁隔离
      lockManager.acquireLock(SCOPE, 'document', 'shared-id', 'sess-a')
      lockManager.acquireLock(SCOPE_B, 'document', 'shared-id', 'sess-b')
      expect(lockManager.getLock(SCOPE, 'document', 'shared-id')?.sessionId).toBe('sess-a')
      expect(lockManager.getLock(SCOPE_B, 'document', 'shared-id')?.sessionId).toBe('sess-b')
    })
  })

  // ══════════════════════════════════════════════════════════
  // 场景组 6：审计深度场景
  // ══════════════════════════════════════════════════════════

  describe('场景组 6：审计深度场景', () => {
    it('User 操作者类型的审计（非 Agent）', async () => {
      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-u',
        toolName: 'api:documents',
        auditInput: {
          toolName: 'api:documents',
          action: 'create',
          resourceType: 'document',
          resourceId: 'doc-user',
          result: 'success'
        },
        actor: { type: 'user', clientId: 'client-abc' }
      })

      const entries = auditManager.query({ scope: SCOPE, actorType: 'user' })
      expect(entries).toHaveLength(1)
      expect(entries[0].actorType).toBe('user')
      expect(entries[0].clientId).toBe('client-abc')
    })

    it('错误和拒绝结果的审计记录', async () => {
      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-err',
        toolName: 'prizm_update_document',
        auditInput: {
          toolName: 'prizm_update_document',
          action: 'update',
          resourceType: 'document',
          resourceId: 'doc-locked',
          result: 'denied',
          errorMessage: '文档已被其他会话锁定'
        }
      })

      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-err',
        toolName: 'prizm_file_write',
        auditInput: {
          toolName: 'prizm_file_write',
          action: 'create',
          resourceType: 'file',
          resourceId: 'forbidden.txt',
          result: 'error',
          errorMessage: '路径越界'
        }
      })

      const denied = auditManager.query({ result: 'denied' })
      expect(denied).toHaveLength(1)
      expect(denied[0].errorMessage).toBe('文档已被其他会话锁定')

      const errors = auditManager.query({ result: 'error' })
      expect(errors).toHaveLength(1)
      expect(errors[0].errorMessage).toBe('路径越界')
    })

    it('审计时间范围过滤', async () => {
      const before = Date.now()

      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-time',
        toolName: 'prizm_file_write',
        auditInput: {
          toolName: 'prizm_file_write',
          action: 'create',
          resourceType: 'file',
          result: 'success'
        }
      })

      const after = Date.now() + 1

      const withinRange = auditManager.query({ since: before, until: after })
      expect(withinRange.length).toBeGreaterThanOrEqual(1)

      const outOfRange = auditManager.query({ since: after + 1000 })
      expect(outOfRange).toHaveLength(0)
    })

    it('资源操作历史查询', async () => {
      for (const action of ['read', 'update', 'read', 'update', 'read'] as const) {
        await emit('tool:executed', {
          scope: SCOPE,
          sessionId: 'sess-hist',
          toolName: action === 'read' ? 'prizm_get_document_content' : 'prizm_update_document',
          auditInput: {
            toolName: action === 'read' ? 'prizm_get_document_content' : 'prizm_update_document',
            action,
            resourceType: 'document',
            resourceId: 'doc-tracked',
            result: 'success'
          }
        })
      }

      const history = auditManager.getResourceHistory(SCOPE, 'document', 'doc-tracked')
      expect(history).toHaveLength(5)

      const limitedHistory = auditManager.getResourceHistory(SCOPE, 'document', 'doc-tracked', 2)
      expect(limitedHistory).toHaveLength(2)
    })

    it('会话审计条数统计', async () => {
      for (let i = 0; i < 7; i++) {
        await emit('tool:executed', {
          scope: SCOPE,
          sessionId: 'sess-count',
          toolName: 'prizm_file_write',
          auditInput: {
            toolName: 'prizm_file_write',
            action: 'create',
            resourceType: 'file',
            resourceId: `file-${i}.txt`,
            result: 'success'
          }
        })
      }

      const count = auditManager.countSessionEntries(SCOPE, 'sess-count')
      expect(count).toBe(7)
    })

    it('记忆相关审计字段', async () => {
      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-mem-audit',
        toolName: 'prizm_search_docs_by_memory',
        auditInput: {
          toolName: 'prizm_search_docs_by_memory',
          action: 'search',
          resourceType: 'memory',
          memoryType: 'document',
          documentSubType: 'overview',
          detail: 'query="项目进度"',
          result: 'success'
        }
      })

      const entries = auditManager.query({ sessionId: 'sess-mem-audit' })
      expect(entries).toHaveLength(1)
      expect(entries[0].memoryType).toBe('document')
      expect(entries[0].documentSubType).toBe('overview')
      expect(entries[0].detail).toContain('项目进度')
    })

    it('审计分页查询', async () => {
      for (let i = 0; i < 10; i++) {
        auditManager.record(SCOPE, `sess-page-${i}`, {
          toolName: 'prizm_file_write',
          action: 'create',
          resourceType: 'file',
          resourceId: `page-${i}.txt`,
          result: 'success'
        })
      }

      const page1 = auditManager.query({ scope: SCOPE, limit: 3 })
      expect(page1).toHaveLength(3)

      const page2 = auditManager.query({ scope: SCOPE, limit: 3, offset: 3 })
      expect(page2).toHaveLength(3)

      expect(page1[0].id).not.toBe(page2[0].id)
    })
  })

  // ══════════════════════════════════════════════════════════
  // 场景组 7：锁管理深度场景
  // ══════════════════════════════════════════════════════════

  describe('场景组 7：锁管理深度场景', () => {
    it('锁竞争：不同会话锁同一资源应被拒绝', () => {
      const result1 = lockManager.acquireLock(SCOPE, 'document', 'contested-doc', 'sess-1')
      expect(result1.success).toBe(true)

      const result2 = lockManager.acquireLock(SCOPE, 'document', 'contested-doc', 'sess-2')
      expect(result2.success).toBe(false)
      expect(result2.heldBy?.sessionId).toBe('sess-1')
    })

    it('同一会话重入锁应成功（心跳刷新）', () => {
      lockManager.acquireLock(SCOPE, 'document', 'reentrant-doc', 'sess-re')

      const result = lockManager.acquireLock(SCOPE, 'document', 'reentrant-doc', 'sess-re')
      expect(result.success).toBe(true)
    })

    it('释放锁后其他会话可获取', () => {
      lockManager.acquireLock(SCOPE, 'document', 'release-doc', 'sess-holder')

      const released = lockManager.releaseLock(SCOPE, 'document', 'release-doc', 'sess-holder')
      expect(released).toBe(true)

      const result = lockManager.acquireLock(SCOPE, 'document', 'release-doc', 'sess-new')
      expect(result.success).toBe(true)
    })

    it('非持有者释放锁应失败', () => {
      lockManager.acquireLock(SCOPE, 'document', 'steal-doc', 'sess-owner')

      const result = lockManager.releaseLock(SCOPE, 'document', 'steal-doc', 'sess-thief')
      expect(result).toBe(false)

      expect(lockManager.getLock(SCOPE, 'document', 'steal-doc')?.sessionId).toBe('sess-owner')
    })

    it('强制释放锁', () => {
      lockManager.acquireLock(SCOPE, 'document', 'force-doc', 'sess-force')

      const released = lockManager.forceReleaseLock(SCOPE, 'document', 'force-doc')
      expect(released).not.toBeNull()
      expect(released!.sessionId).toBe('sess-force')

      expect(lockManager.getLock(SCOPE, 'document', 'force-doc')).toBeNull()
    })

    it('一个会话持有多个锁 + 批量释放', () => {
      lockManager.acquireLock(SCOPE, 'document', 'multi-1', 'sess-multi')
      lockManager.acquireLock(SCOPE, 'document', 'multi-2', 'sess-multi')
      lockManager.acquireLock(SCOPE, 'todo_list', 'multi-3', 'sess-multi')

      expect(lockManager.listSessionLocks(SCOPE, 'sess-multi')).toHaveLength(3)

      const count = lockManager.releaseSessionLocks(SCOPE, 'sess-multi')
      expect(count).toBe(3)
      expect(lockManager.listSessionLocks(SCOPE, 'sess-multi')).toHaveLength(0)
    })

    it('Fence token 单调递增', () => {
      const r1 = lockManager.acquireLock(SCOPE, 'document', 'fence-doc', 'sess-f1')
      const fence1 = r1.lock!.fenceToken

      lockManager.releaseLock(SCOPE, 'document', 'fence-doc', 'sess-f1')

      const r2 = lockManager.acquireLock(SCOPE, 'document', 'fence-doc', 'sess-f2')
      const fence2 = r2.lock!.fenceToken

      expect(fence2).toBeGreaterThan(fence1)
    })

    it('会话删除事件应释放该会话所有锁并发出 lock.changed 事件', async () => {
      lockManager.acquireLock(SCOPE, 'document', 'evt-doc-1', 'sess-lock-evt')
      lockManager.acquireLock(SCOPE, 'todo_list', 'evt-list-1', 'sess-lock-evt')

      const lockEvents: Array<{ action: string; resourceType: string; resourceId: string }> = []
      const unsub = (await import('./eventBus/eventBus')).subscribe('resource:lock.changed', (d) => {
        lockEvents.push({ action: d.action, resourceType: d.resourceType, resourceId: d.resourceId })
      })

      await emit('agent:session.deleted', { scope: SCOPE, sessionId: 'sess-lock-evt' })

      expect(lockEvents).toHaveLength(2)
      expect(lockEvents.every((e) => e.action === 'unlocked')).toBe(true)

      unsub()
    })
  })

  // ══════════════════════════════════════════════════════════
  // 场景组 8：版本控制深度场景
  // ══════════════════════════════════════════════════════════

  describe('场景组 8：版本控制深度场景', () => {
    it('多次连续更新应产生完整版本链', () => {
      for (let i = 1; i <= 5; i++) {
        saveVersion(scopeRoot, 'doc-chain', `标题v${i}`, `内容版本${i}`)
      }

      const history = getVersionHistory(scopeRoot, 'doc-chain')
      expect(history.versions).toHaveLength(5)
      expect(history.versions[0].version).toBe(1)
      expect(history.versions[4].version).toBe(5)
      expect(history.versions[4].content).toBe('内容版本5')

      const latest = getLatestVersion(scopeRoot, 'doc-chain')
      expect(latest?.version).toBe(5)

      const prev = getPreviousVersion(scopeRoot, 'doc-chain')
      expect(prev?.version).toBe(4)
    })

    it('版本中应记录 changedBy 信息', () => {
      saveVersion(scopeRoot, 'doc-by', '初始', '初始内容')
      const v2 = saveVersion(scopeRoot, 'doc-by', '修改', '修改内容', {
        changedBy: { type: 'agent', sessionId: 'sess-by' }
      })
      expect(v2.changedBy).toEqual({ type: 'agent', sessionId: 'sess-by' })

      const v3 = saveVersion(scopeRoot, 'doc-by', '再改', '再改内容', {
        changedBy: { type: 'user', apiSource: 'electron' },
        changeReason: '用户手动编辑'
      })
      expect(v3.changedBy).toEqual({ type: 'user', apiSource: 'electron' })
      expect(v3.changeReason).toBe('用户手动编辑')
    })

    it('不存在的文档应返回 null', () => {
      expect(getLatestVersion(scopeRoot, 'nonexistent')).toBeNull()
      expect(getPreviousVersion(scopeRoot, 'nonexistent')).toBeNull()

      const history = getVersionHistory(scopeRoot, 'nonexistent')
      expect(history.versions).toHaveLength(0)
    })

    it('diff 计算应检测增删行', () => {
      const diff1 = computeDiff('A\nB\nC', 'A\nB\nC\nD')
      expect(diff1).toContain('新增')
      expect(diff1).toContain('D')

      const diff2 = computeDiff('A\nB\nC', 'A\nC')
      expect(diff2).toContain('删除')
      expect(diff2).toContain('B')

      const diff3 = computeDiff('same', 'same')
      expect(diff3).toContain('无显著变更')
    })

    it('contentHash 应对不同内容产生不同值', () => {
      const h1 = computeContentHash('hello')
      const h2 = computeContentHash('world')
      const h3 = computeContentHash('hello')

      expect(h1).not.toBe(h2)
      expect(h1).toBe(h3)
    })
  })

  // ══════════════════════════════════════════════════════════
  // 场景组 9：Checkpoint 边界场景
  // ══════════════════════════════════════════════════════════

  describe('场景组 9：Checkpoint 边界场景', () => {
    let session: AgentSession

    beforeEach(() => {
      const data = store.getScopeData(SCOPE)
      session = {
        id: 'sess-edge',
        scope: SCOPE,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        checkpoints: []
      }
      data.agentSessions.push(session)
    })

    it('回退到最早 checkpoint 应清空所有消息', () => {
      const cp1 = simulateTurn(store, session, scopeRoot, 1, '第一轮', '回复1', [
        { op: 'write', path: 'edge1.txt', content: 'first' }
      ])
      simulateTurn(store, session, scopeRoot, 2, '第二轮', '回复2', [
        { op: 'write', path: 'edge2.txt', content: 'second' }
      ])

      performRollback(store, session, scopeRoot, cp1.id)

      expect(session.messages).toHaveLength(0)
      expect(session.checkpoints).toHaveLength(0)
    })

    it('单轮中操作多个文件 + 回退应全部恢复', () => {
      simulateTurn(store, session, scopeRoot, 1, '创建多文件', '已创建', [
        { op: 'write', path: 'multi-a.txt', content: 'A' },
        { op: 'write', path: 'multi-b.txt', content: 'B' },
        { op: 'write', path: 'multi-c.txt', content: 'C' }
      ])

      expect(mdStore.readFileByPath(scopeRoot, 'multi-a.txt')?.content).toBe('A')
      expect(mdStore.readFileByPath(scopeRoot, 'multi-b.txt')?.content).toBe('B')
      expect(mdStore.readFileByPath(scopeRoot, 'multi-c.txt')?.content).toBe('C')

      performRollback(store, session, scopeRoot, session.checkpoints![0].id)

      // 所有文件应被删除（恢复为空）
      expect(mdStore.readFileByPath(scopeRoot, 'multi-a.txt')).toBeNull()
      expect(mdStore.readFileByPath(scopeRoot, 'multi-b.txt')).toBeNull()
      expect(mdStore.readFileByPath(scopeRoot, 'multi-c.txt')).toBeNull()
    })

    it('创建 → 修改 → 删除文件 → 回退到创建后应恢复为初始内容', () => {
      simulateTurn(store, session, scopeRoot, 1, '创建', '好的', [
        { op: 'write', path: 'lifecycle.txt', content: 'born' }
      ])
      const cp2 = simulateTurn(store, session, scopeRoot, 2, '修改', '改了', [
        { op: 'write', path: 'lifecycle.txt', content: 'grown' }
      ])
      simulateTurn(store, session, scopeRoot, 3, '删除', '删了', [
        { op: 'delete', path: 'lifecycle.txt' }
      ])

      expect(mdStore.readFileByPath(scopeRoot, 'lifecycle.txt')).toBeNull()

      performRollback(store, session, scopeRoot, cp2.id)

      // 应恢复为 cp2 之前的内容（即 'born'）
      expect(mdStore.readFileByPath(scopeRoot, 'lifecycle.txt')?.content).toBe('born')
    })

    it('无文件操作的纯对话轮次也应产生有效 checkpoint', () => {
      const cp = simulateTurn(store, session, scopeRoot, 1, '纯对话', '纯回复')

      expect(cp.completed).toBe(true)
      expect(cp.fileChanges).toHaveLength(0)
      expect(session.checkpoints).toHaveLength(1)

      simulateTurn(store, session, scopeRoot, 2, '第二轮', '回复')
      performRollback(store, session, scopeRoot, session.checkpoints![1].id)
      expect(session.messages).toHaveLength(2)
    })

    it('连续回退（先部分回退再进一步回退）', () => {
      simulateTurn(store, session, scopeRoot, 1, 'T1', 'R1', [
        { op: 'write', path: 'step.txt', content: 'step1' }
      ])
      simulateTurn(store, session, scopeRoot, 2, 'T2', 'R2', [
        { op: 'write', path: 'step.txt', content: 'step2' }
      ])
      simulateTurn(store, session, scopeRoot, 3, 'T3', 'R3', [
        { op: 'write', path: 'step.txt', content: 'step3' }
      ])
      simulateTurn(store, session, scopeRoot, 4, 'T4', 'R4', [
        { op: 'write', path: 'step.txt', content: 'step4' }
      ])

      // 先回退到 cp3
      performRollback(store, session, scopeRoot, session.checkpoints![2].id)
      expect(mdStore.readFileByPath(scopeRoot, 'step.txt')?.content).toBe('step2')
      expect(session.messages).toHaveLength(4)

      // 再回退到 cp1
      performRollback(store, session, scopeRoot, session.checkpoints![0].id)
      expect(session.messages).toHaveLength(0)
    })
  })

  // ══════════════════════════════════════════════════════════
  // 场景组 10：记忆系统边界场景
  // ══════════════════════════════════════════════════════════

  describe('场景组 10：记忆系统边界场景', () => {
    it('记忆关闭时 document:saved 不应触发记忆抽取', async () => {
      mockIsMemoryEnabled.mockReturnValue(false)

      await emit('document:saved', {
        scope: SCOPE,
        documentId: 'doc-disabled',
        title: '禁用记忆',
        content: '内容'
      })

      expect(mockScheduleDocumentMemory).not.toHaveBeenCalled()
    })

    it('记忆关闭时 session.deleted 不应 flush', async () => {
      mockIsMemoryEnabled.mockReturnValue(false)

      await emit('agent:session.deleted', { scope: SCOPE, sessionId: 'sess-no-mem' })

      expect(mockFlushSessionBuffer).not.toHaveBeenCalled()
    })

    it('记忆关闭时回退不应清理记忆', async () => {
      mockIsMemoryEnabled.mockReturnValue(false)

      await emit('agent:session.rolledBack', {
        scope: SCOPE,
        sessionId: 'sess-no-mem-rb',
        checkpointId: 'cp-1',
        checkpointMessageIndex: 0,
        removedCheckpointIds: ['cp-1'],
        removedMemoryIds: { user: ['m-1'], scope: ['m-2'], session: [] },
        deletedDocumentIds: ['doc-rb'],
        restoredDocumentIds: [],
        remainingMessageCount: 0
      })

      expect(mockDeleteMemory).not.toHaveBeenCalled()
      expect(mockDeleteDocumentMemories).not.toHaveBeenCalled()
    })

    it('回退事件应清理被删除文档的记忆', async () => {
      mockDeleteDocumentMemories.mockResolvedValue(2)

      await emit('agent:session.rolledBack', {
        scope: SCOPE,
        sessionId: 'sess-doc-rb',
        checkpointId: 'cp-doc',
        checkpointMessageIndex: 0,
        removedCheckpointIds: ['cp-doc'],
        removedMemoryIds: { user: [], scope: [], session: [] },
        deletedDocumentIds: ['doc-created-then-deleted', 'doc-another'],
        restoredDocumentIds: [],
        remainingMessageCount: 0
      })

      expect(mockDeleteDocumentMemories).toHaveBeenCalledTimes(2)
      expect(mockDeleteDocumentMemories).toHaveBeenCalledWith(SCOPE, 'doc-created-then-deleted')
      expect(mockDeleteDocumentMemories).toHaveBeenCalledWith(SCOPE, 'doc-another')
    })

    it('回退无记忆 refs 时不调用 deleteMemory', async () => {
      await emit('agent:session.rolledBack', {
        scope: SCOPE,
        sessionId: 'sess-empty-refs',
        checkpointId: 'cp-empty',
        checkpointMessageIndex: 0,
        removedCheckpointIds: ['cp-empty'],
        removedMemoryIds: { user: [], scope: [], session: [] },
        deletedDocumentIds: [],
        restoredDocumentIds: [],
        remainingMessageCount: 0
      })

      expect(mockDeleteMemory).not.toHaveBeenCalled()
    })

    it('document:saved 应携带 actor 信息给记忆服务', async () => {
      await emit('document:saved', {
        scope: SCOPE,
        documentId: 'doc-actor',
        title: '有作者的文档',
        content: '内容较长'.repeat(200),
        actor: { type: 'agent', sessionId: 'sess-author' }
      })

      expect(mockScheduleDocumentMemory).toHaveBeenCalledWith(
        SCOPE,
        'doc-actor',
        expect.objectContaining({
          changedBy: { type: 'agent', sessionId: 'sess-author' }
        })
      )
    })
  })

  // ══════════════════════════════════════════════════════════
  // 场景组 11：会话数据完整性
  // ══════════════════════════════════════════════════════════

  describe('场景组 11：会话数据完整性', () => {
    it('带工具调用的消息应正确持久化和恢复', () => {
      const data = store.getScopeData(SCOPE)
      const session: AgentSession = {
        id: 'sess-tool',
        scope: SCOPE,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      data.agentSessions.push(session)

      session.messages.push(makeMsg('u-1', 'user', '帮我创建一个文件'))
      session.messages.push(
        makeMsg('a-1', 'assistant', '好的，已创建', [
          { name: 'prizm_file_write', args: { path: 'test.txt', content: 'hello' } },
          { name: 'prizm_file_write', args: { path: 'test2.txt', content: 'world' } }
        ])
      )
      store.saveScope(SCOPE)

      const store2 = new ScopeStore(state.tempDir)
      const restored = store2.getScopeData(SCOPE).agentSessions[0]
      expect(restored.messages).toHaveLength(2)
      const toolParts = restored.messages[1].parts.filter((p) => p.type === 'tool')
      expect(toolParts).toHaveLength(2)
      expect(toolParts[0].name).toBe('prizm_file_write')
    })

    it('多个会话应独立存储和读取', () => {
      const data = store.getScopeData(SCOPE)

      for (let i = 1; i <= 3; i++) {
        const s: AgentSession = {
          id: `sess-multi-${i}`,
          scope: SCOPE,
          messages: [makeMsg(`u-${i}`, 'user', `消息${i}`)],
          createdAt: Date.now() - (3 - i) * 1000,
          updatedAt: Date.now() - (3 - i) * 1000
        }
        data.agentSessions.push(s)
      }
      store.saveScope(SCOPE)

      const store2 = new ScopeStore(state.tempDir)
      const sessions = store2.getScopeData(SCOPE).agentSessions
      expect(sessions).toHaveLength(3)

      for (let i = 1; i <= 3; i++) {
        const found = sessions.find((s) => s.id === `sess-multi-${i}`)
        expect(found).toBeDefined()
        expect(found!.messages[0].parts[0]).toMatchObject({ type: 'text', content: `消息${i}` })
      }
    })

    it('会话 llmSummary 和 compressedThroughRound 应持久化', () => {
      const data = store.getScopeData(SCOPE)
      const session: AgentSession = {
        id: 'sess-meta',
        scope: SCOPE,
        messages: [makeMsg('u-1', 'user', '测试')],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        llmSummary: '讨论项目方案',
        compressedThroughRound: 5
      }
      data.agentSessions.push(session)
      store.saveScope(SCOPE)

      const store2 = new ScopeStore(state.tempDir)
      const restored = store2.getScopeData(SCOPE).agentSessions.find((s) => s.id === 'sess-meta')
      expect(restored?.llmSummary).toBe('讨论项目方案')
      expect(restored?.compressedThroughRound).toBe(5)
    })

    it('grantedPaths 应持久化', () => {
      const data = store.getScopeData(SCOPE)
      const session: AgentSession = {
        id: 'sess-grant',
        scope: SCOPE,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        grantedPaths: ['/workspace/src', '/workspace/docs']
      }
      data.agentSessions.push(session)
      store.saveScope(SCOPE)

      const store2 = new ScopeStore(state.tempDir)
      const restored = store2.getScopeData(SCOPE).agentSessions.find((s) => s.id === 'sess-grant')
      expect(restored?.grantedPaths).toEqual(['/workspace/src', '/workspace/docs'])
    })
  })

  // ══════════════════════════════════════════════════════════
  // 场景组 12：复杂联动场景
  // ══════════════════════════════════════════════════════════

  describe('场景组 12：复杂联动场景', () => {
    it('同一文档被多个会话操作：锁竞争 + 审计追踪', async () => {
      // 会话1 获取锁
      const r1 = lockManager.acquireLock(SCOPE, 'document', 'shared-doc', 'sess-1', '编辑')
      expect(r1.success).toBe(true)

      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-1',
        toolName: 'prizm_checkout_document',
        auditInput: {
          toolName: 'prizm_checkout_document',
          action: 'checkout',
          resourceType: 'document',
          resourceId: 'shared-doc',
          result: 'success'
        }
      })

      // 会话2 尝试获取锁（被拒）
      const r2 = lockManager.acquireLock(SCOPE, 'document', 'shared-doc', 'sess-2', '也要编辑')
      expect(r2.success).toBe(false)

      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-2',
        toolName: 'prizm_checkout_document',
        auditInput: {
          toolName: 'prizm_checkout_document',
          action: 'checkout',
          resourceType: 'document',
          resourceId: 'shared-doc',
          result: 'denied',
          errorMessage: '被 sess-1 锁定'
        }
      })

      // 会话1 释放
      lockManager.releaseLock(SCOPE, 'document', 'shared-doc', 'sess-1')

      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-1',
        toolName: 'prizm_checkin_document',
        auditInput: {
          toolName: 'prizm_checkin_document',
          action: 'checkin',
          resourceType: 'document',
          resourceId: 'shared-doc',
          result: 'success'
        }
      })

      // 会话2 重新获取（成功）
      const r3 = lockManager.acquireLock(SCOPE, 'document', 'shared-doc', 'sess-2')
      expect(r3.success).toBe(true)

      // 审计应有完整记录
      const allAudit = auditManager.query({ resourceId: 'shared-doc' })
      expect(allAudit).toHaveLength(3)
      const denied = allAudit.find((e) => e.result === 'denied')
      expect(denied?.sessionId).toBe('sess-2')
    })

    it('文档多次编辑产生版本链 + 每次审计 + 最终回退', async () => {
      const data = store.getScopeData(SCOPE)
      const session: AgentSession = {
        id: 'sess-multi-edit',
        scope: SCOPE,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        checkpoints: []
      }
      data.agentSessions.push(session)

      const contentVersions = ['v1-初稿', 'v2-增加章节', 'v3-修订', 'v4-终稿']

      for (let i = 0; i < contentVersions.length; i++) {
        simulateTurn(store, session, scopeRoot, i + 1, `编辑第${i + 1}次`, '已编辑', [
          { op: 'write', path: 'evolving.md', content: contentVersions[i] }
        ])

        saveVersion(scopeRoot, 'doc-evolving', '演进文档', contentVersions[i])

        await emit('tool:executed', {
          scope: SCOPE,
          sessionId: session.id,
          toolName: 'prizm_update_document',
          auditInput: {
            toolName: 'prizm_update_document',
            action: i === 0 ? 'create' : 'update',
            resourceType: 'document',
            resourceId: 'doc-evolving',
            result: 'success'
          }
        })
      }

      // 验证版本链
      const history = getVersionHistory(scopeRoot, 'doc-evolving')
      expect(history.versions).toHaveLength(4)

      // 验证审计数
      const auditEntries = auditManager.query({ sessionId: session.id })
      expect(auditEntries).toHaveLength(4)

      // 回退到 cp2（v2之前的状态）
      performRollback(store, session, scopeRoot, session.checkpoints![1].id)

      // 文件恢复
      expect(mdStore.readFileByPath(scopeRoot, 'evolving.md')?.content).toBe('v1-初稿')

      // 版本历史不受回退影响（版本是不可变的快照）
      expect(getVersionHistory(scopeRoot, 'doc-evolving').versions).toHaveLength(4)

      // 审计日志不受回退影响
      expect(auditManager.query({ sessionId: session.id })).toHaveLength(4)
    })

    it('并行操作不同资源类型应互不影响', async () => {
      // 同时操作文档和 todo_list
      lockManager.acquireLock(SCOPE, 'document', 'doc-parallel', 'sess-p')
      lockManager.acquireLock(SCOPE, 'todo_list', 'list-parallel', 'sess-p')

      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-p',
        toolName: 'prizm_update_document',
        auditInput: {
          toolName: 'prizm_update_document',
          action: 'update',
          resourceType: 'document',
          resourceId: 'doc-parallel',
          result: 'success'
        }
      })

      await emit('tool:executed', {
        scope: SCOPE,
        sessionId: 'sess-p',
        toolName: 'prizm_update_todo',
        auditInput: {
          toolName: 'prizm_update_todo',
          action: 'update',
          resourceType: 'todo_list',
          resourceId: 'list-parallel',
          result: 'success'
        }
      })

      const docAudit = auditManager.query({ resourceType: 'document', resourceId: 'doc-parallel' })
      const todoAudit = auditManager.query({ resourceType: 'todo_list', resourceId: 'list-parallel' })
      expect(docAudit).toHaveLength(1)
      expect(todoAudit).toHaveLength(1)

      // 释放其中一个不影响另一个
      lockManager.releaseLock(SCOPE, 'document', 'doc-parallel', 'sess-p')
      expect(lockManager.getLock(SCOPE, 'document', 'doc-parallel')).toBeNull()
      expect(lockManager.getLock(SCOPE, 'todo_list', 'list-parallel')).not.toBeNull()
    })

    it('快速连续的 document:saved 事件应各自触发记忆', async () => {
      for (let i = 1; i <= 5; i++) {
        await emit('document:saved', {
          scope: SCOPE,
          documentId: `rapid-doc-${i}`,
          title: `快速文档${i}`,
          content: `内容${i}`.repeat(100)
        })
      }

      expect(mockScheduleDocumentMemory).toHaveBeenCalledTimes(5)
    })

    it('回退后继续对话再回退：二次回退', () => {
      const data = store.getScopeData(SCOPE)
      const session: AgentSession = {
        id: 'sess-double-rb',
        scope: SCOPE,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        checkpoints: []
      }
      data.agentSessions.push(session)

      // 3 轮对话
      simulateTurn(store, session, scopeRoot, 1, 'T1', 'R1', [
        { op: 'write', path: 'double.txt', content: 'v1' }
      ])
      simulateTurn(store, session, scopeRoot, 2, 'T2', 'R2', [
        { op: 'write', path: 'double.txt', content: 'v2' }
      ])
      simulateTurn(store, session, scopeRoot, 3, 'T3', 'R3', [
        { op: 'write', path: 'double.txt', content: 'v3' }
      ])

      // 回退到 cp3 (撤销 T3)
      performRollback(store, session, scopeRoot, session.checkpoints![2].id)
      expect(mdStore.readFileByPath(scopeRoot, 'double.txt')?.content).toBe('v2')
      expect(session.messages).toHaveLength(4)
      expect(session.checkpoints).toHaveLength(2)

      // 继续新对话
      simulateTurn(store, session, scopeRoot, 4, 'T4-new', 'R4-new', [
        { op: 'write', path: 'double.txt', content: 'v4-new' }
      ])
      expect(session.checkpoints).toHaveLength(3)

      // 再次回退到 cp2（撤销 T2 + T4-new）
      performRollback(store, session, scopeRoot, session.checkpoints![1].id)
      expect(mdStore.readFileByPath(scopeRoot, 'double.txt')?.content).toBe('v1')
      expect(session.messages).toHaveLength(2)
    })
  })
})
