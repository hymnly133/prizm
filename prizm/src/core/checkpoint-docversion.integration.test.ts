/**
 * Checkpoint + 文档版本系统集成测试
 *
 * 验证 checkpoint 回退与 documentVersionStore 的协调工作：
 * - 文档 update 回退：恢复到修改前版本，版本历史线性追加
 * - 文档 create 回退：撤销创建（删除文档）
 * - 文档 delete 回退：重新创建文档
 * - 多轮文档修改 first-occurrence-wins
 * - 文件 + 文档混合回退
 * - 多 checkpoint 文件回退顺序修复验证
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
import {
  saveVersion,
  getLatestVersion,
  getVersionHistory
} from './documentVersionStore'
import * as mdStore from './mdStore'
import type { AgentSession, AgentMessage, SessionCheckpoint, Document } from '../types'

const SCOPE = 'doc-version-scope'

function makeMsg(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  toolParts?: Array<{ name: string; args: Record<string, unknown> }>
): AgentMessage {
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
 * 在 scopeStore 中创建一个文档并初始化版本历史
 */
function createDocInScope(
  store: ScopeStore,
  scopeRoot: string,
  docId: string,
  title: string,
  content: string
): Document {
  const data = store.getScopeData(SCOPE)
  const now = Date.now()
  const doc: Document = {
    id: docId,
    title,
    content,
    relativePath: '',
    createdAt: now,
    updatedAt: now
  }
  data.documents.push(doc)
  store.saveScope(SCOPE)

  saveVersion(scopeRoot, docId, title, content, {
    changedBy: { type: 'user', source: 'test:setup' },
    changeReason: 'Initial creation'
  })

  return doc
}

/**
 * 模拟 agent 通过 documentTools 修改文档的一轮对话。
 * 包含 captureFileSnapshot 调用来记录版本引用。
 */
function simulateDocUpdateTurn(
  store: ScopeStore,
  session: AgentSession,
  scopeRoot: string,
  turnIndex: number,
  userText: string,
  docId: string,
  newContent: string,
  newTitle?: string
): SessionCheckpoint {
  const messageIndex = session.messages.length
  const cp = createCheckpoint(session.id, messageIndex, userText)
  initSnapshotCollector(session.id)

  session.messages.push(makeMsg(`u-${turnIndex}`, 'user', userText))

  // captureFileSnapshot: 记录版本号引用（模拟 documentTools.executeUpdateDocument 的行为）
  const latestVer = getLatestVersion(scopeRoot, docId)
  captureFileSnapshot(
    session.id,
    `[doc:${docId}]`,
    JSON.stringify({ action: 'update', versionBefore: latestVer?.version ?? 0 })
  )

  // 执行文档更新
  const data = store.getScopeData(SCOPE)
  const doc = data.documents.find((d) => d.id === docId)
  if (doc) {
    if (newTitle) doc.title = newTitle
    doc.content = newContent
    doc.updatedAt = Date.now()
    store.saveScope(SCOPE)
  }

  // 保存版本（模拟 document:saved → scheduleDocumentMemory → saveVersion）
  saveVersion(scopeRoot, docId, newTitle ?? doc?.title ?? '', newContent, {
    changedBy: { type: 'agent', sessionId: session.id, source: 'test:update' }
  })

  const toolParts = [{ name: 'prizm_update_document', args: { id: docId, content: newContent } }]
  session.messages.push(makeMsg(`a-${turnIndex}`, 'assistant', '已更新', toolParts))

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
 * 模拟 agent 创建文档的一轮对话
 */
function simulateDocCreateTurn(
  store: ScopeStore,
  session: AgentSession,
  scopeRoot: string,
  turnIndex: number,
  userText: string,
  docId: string,
  title: string,
  content: string
): SessionCheckpoint {
  const messageIndex = session.messages.length
  const cp = createCheckpoint(session.id, messageIndex, userText)
  initSnapshotCollector(session.id)

  session.messages.push(makeMsg(`u-${turnIndex}`, 'user', userText))

  // 创建文档
  const data = store.getScopeData(SCOPE)
  const now = Date.now()
  const doc: Document = { id: docId, title, content, relativePath: '', createdAt: now, updatedAt: now }
  data.documents.push(doc)
  store.saveScope(SCOPE)

  saveVersion(scopeRoot, docId, title, content, {
    changedBy: { type: 'agent', sessionId: session.id, source: 'test:create' }
  })

  // captureFileSnapshot 在创建之后（模拟 documentTools.executeCreateDocument 的行为）
  captureFileSnapshot(session.id, `[doc:${docId}]`, JSON.stringify({ action: 'create' }))

  const toolParts = [{ name: 'prizm_create_document', args: { title, content } }]
  session.messages.push(makeMsg(`a-${turnIndex}`, 'assistant', '已创建', toolParts))

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
 * 模拟 agent 删除文档的一轮对话
 */
function simulateDocDeleteTurn(
  store: ScopeStore,
  session: AgentSession,
  scopeRoot: string,
  turnIndex: number,
  userText: string,
  docId: string
): SessionCheckpoint {
  const messageIndex = session.messages.length
  const cp = createCheckpoint(session.id, messageIndex, userText)
  initSnapshotCollector(session.id)

  session.messages.push(makeMsg(`u-${turnIndex}`, 'user', userText))

  // captureFileSnapshot 在删除之前（模拟 documentTools.executeDeleteDocument 的行为）
  const data = store.getScopeData(SCOPE)
  const docObj = data.documents.find((d) => d.id === docId)
  const latestVer = getLatestVersion(scopeRoot, docId)
  captureFileSnapshot(
    session.id,
    `[doc:${docId}]`,
    JSON.stringify({
      action: 'delete',
      versionBefore: latestVer?.version ?? 0,
      title: docObj?.title,
      relativePath: docObj?.relativePath
    })
  )

  // 删除文档
  const idx = data.documents.findIndex((d) => d.id === docId)
  if (idx >= 0) data.documents.splice(idx, 1)
  store.saveScope(SCOPE)

  const toolParts = [{ name: 'prizm_delete_document', args: { id: docId } }]
  session.messages.push(makeMsg(`a-${turnIndex}`, 'assistant', '已删除', toolParts))

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
 * 模拟文件操作的一轮对话
 */
function simulateFileTurn(
  store: ScopeStore,
  session: AgentSession,
  scopeRoot: string,
  turnIndex: number,
  userText: string,
  fileOps: Array<{ path: string; content: string }>
): SessionCheckpoint {
  const messageIndex = session.messages.length
  const cp = createCheckpoint(session.id, messageIndex, userText)
  initSnapshotCollector(session.id)

  session.messages.push(makeMsg(`u-${turnIndex}`, 'user', userText))

  const toolParts: Array<{ name: string; args: Record<string, string> }> = []
  for (const fo of fileOps) {
    const existing = mdStore.readFileByPath(scopeRoot, fo.path)
    captureFileSnapshot(session.id, fo.path, existing?.content ?? null)
    mdStore.writeFileByPath(scopeRoot, fo.path, fo.content)
    toolParts.push({ name: 'prizm_file_write', args: { path: fo.path, content: fo.content } })
  }

  session.messages.push(makeMsg(`a-${turnIndex}`, 'assistant', 'ok', toolParts))

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
 * 执行回退（包含文档恢复逻辑，与 sessions.ts 路由一致）
 */
function performDocAwareRollback(
  store: ScopeStore,
  session: AgentSession,
  scopeRoot: string,
  checkpointId: string,
  restoreFiles = true
): { restoredFiles: string[]; restoredDocs: string[] } {
  const checkpoints = session.checkpoints ?? []
  const cpIndex = checkpoints.findIndex((cp) => cp.id === checkpointId)
  if (cpIndex < 0) throw new Error(`Checkpoint not found: ${checkpointId}`)

  const checkpoint = checkpoints[cpIndex]
  const removedCheckpoints = checkpoints.slice(cpIndex)
  const removedCpIds = removedCheckpoints.map((cp) => cp.id)

  // 合并快照：first-occurrence-wins
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
  const restoredDocs: string[] = []
  if (restoreFiles) {
    for (const [key, snapshotValue] of mergedSnapshots) {
      if (key.startsWith('[doc:')) {
        const docId = key.slice(5, -1)
        const info = JSON.parse(snapshotValue) as {
          action: 'create' | 'update' | 'delete'
          versionBefore?: number
          title?: string
          relativePath?: string
        }

        if (info.action === 'update' && info.versionBefore) {
          const history = getVersionHistory(scopeRoot, docId)
          const targetVer = history.versions.find((v) => v.version === info.versionBefore)
          if (targetVer) {
            const data = store.getScopeData(SCOPE)
            const doc = data.documents.find((d) => d.id === docId)
            if (doc) {
              doc.title = targetVer.title
              doc.content = targetVer.content
              doc.updatedAt = Date.now()
              store.saveScope(SCOPE)
            }
            saveVersion(scopeRoot, docId, targetVer.title, targetVer.content, {
              changedBy: { type: 'user', source: 'api:rollback' },
              changeReason: `Checkpoint rollback to v${info.versionBefore}`
            })
          }
        } else if (info.action === 'create') {
          const data = store.getScopeData(SCOPE)
          const idx = data.documents.findIndex((d) => d.id === docId)
          if (idx >= 0) data.documents.splice(idx, 1)
          store.saveScope(SCOPE)
        } else if (info.action === 'delete' && info.versionBefore) {
          const history = getVersionHistory(scopeRoot, docId)
          const targetVer = history.versions.find((v) => v.version === info.versionBefore)
          if (targetVer) {
            const data = store.getScopeData(SCOPE)
            const now = Date.now()
            data.documents.push({
              id: docId,
              title: info.title ?? targetVer.title,
              content: targetVer.content,
              relativePath: info.relativePath ?? '',
              createdAt: now,
              updatedAt: now
            })
            store.saveScope(SCOPE)
          }
        }

        restoredDocs.push(docId)
        restoredFiles.push(key)
        continue
      }

      mdStore.writeFileByPath(scopeRoot, key, snapshotValue)
      restoredFiles.push(key)
    }
  }

  // 截断消息
  const clampedIndex = Math.max(0, Math.min(checkpoint.messageIndex, session.messages.length))
  session.messages = session.messages.slice(0, clampedIndex)
  session.checkpoints = session.checkpoints?.filter((cp) => cp.messageIndex < clampedIndex)
  session.updatedAt = Date.now()
  store.saveScope(SCOPE)

  deleteCheckpointSnapshots(scopeRoot, session.id, removedCpIds)

  return { restoredFiles, restoredDocs }
}

describe('Checkpoint + DocumentVersion Integration', () => {
  let tempDir: string
  let store: ScopeStore
  let scopeRoot: string
  let session: AgentSession

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `prizm-cp-doc-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

  // ─── 文档 update 回退 ───

  describe('文档 update 回退', () => {
    it('修改文档后回退，文档内容恢复到修改前版本', () => {
      const doc = createDocInScope(store, scopeRoot, 'doc-1', '测试文档', 'Hello v1')

      const cp1 = simulateDocUpdateTurn(store, session, scopeRoot, 1, '修改文档', 'doc-1', 'Hello v2')

      // 修改后验证
      const data = store.getScopeData(SCOPE)
      expect(data.documents.find((d) => d.id === 'doc-1')?.content).toBe('Hello v2')

      // 回退
      performDocAwareRollback(store, session, scopeRoot, cp1.id)

      // 文档内容恢复到 v1
      const restored = store.getScopeData(SCOPE).documents.find((d) => d.id === 'doc-1')
      expect(restored?.content).toBe('Hello v1')

      // 版本历史应包含 3 个版本：v1(初始) → v2(修改) → v3(回退恢复到v1内容)
      const history = getVersionHistory(scopeRoot, 'doc-1')
      expect(history.versions).toHaveLength(3)
      expect(history.versions[0].content).toBe('Hello v1')
      expect(history.versions[1].content).toBe('Hello v2')
      expect(history.versions[2].content).toBe('Hello v1')
      expect(history.versions[2].changeReason).toContain('rollback')
    })

    it('连续两轮修改后回退到最初，first-occurrence-wins 生效', () => {
      createDocInScope(store, scopeRoot, 'doc-2', '文档', 'original')

      const cp1 = simulateDocUpdateTurn(store, session, scopeRoot, 1, '第一次修改', 'doc-2', 'modified-1')
      const cp2 = simulateDocUpdateTurn(store, session, scopeRoot, 2, '第二次修改', 'doc-2', 'modified-2')

      // 回退到 cp1 之前（删除 cp1 和 cp2）
      performDocAwareRollback(store, session, scopeRoot, cp1.id)

      // first-occurrence-wins: cp1 的快照记录了 versionBefore=1 (original)
      const restored = store.getScopeData(SCOPE).documents.find((d) => d.id === 'doc-2')
      expect(restored?.content).toBe('original')

      // 版本历史: v1(original) → v2(modified-1) → v3(modified-2) → v4(rollback to original)
      const history = getVersionHistory(scopeRoot, 'doc-2')
      expect(history.versions).toHaveLength(4)
      expect(history.versions[3].content).toBe('original')
    })
  })

  // ─── 文档 create 回退 ───

  describe('文档 create 回退', () => {
    it('创建文档后回退，文档被删除', () => {
      const cp1 = simulateDocCreateTurn(store, session, scopeRoot, 1, '创建文档', 'new-doc', '新文档', '内容')

      // 创建后验证
      const data = store.getScopeData(SCOPE)
      expect(data.documents.find((d) => d.id === 'new-doc')).toBeDefined()

      // 回退
      performDocAwareRollback(store, session, scopeRoot, cp1.id)

      // 文档被删除
      const after = store.getScopeData(SCOPE)
      expect(after.documents.find((d) => d.id === 'new-doc')).toBeUndefined()
    })

    it('创建后修改再回退，create 快照优先，文档被删除', () => {
      const cp1 = simulateDocCreateTurn(store, session, scopeRoot, 1, '创建文档', 'cd-doc', '新文档', 'v1')
      const cp2 = simulateDocUpdateTurn(store, session, scopeRoot, 2, '修改文档', 'cd-doc', 'v2')

      // 回退到 cp1（first-occurrence-wins: cp1 记录 action=create，优先于 cp2 的 action=update）
      performDocAwareRollback(store, session, scopeRoot, cp1.id)

      const after = store.getScopeData(SCOPE)
      expect(after.documents.find((d) => d.id === 'cd-doc')).toBeUndefined()
    })
  })

  // ─── 文档 delete 回退 ───

  describe('文档 delete 回退', () => {
    it('删除文档后回退，文档被重新创建', () => {
      createDocInScope(store, scopeRoot, 'del-doc', '将被删除', '重要内容')

      const cp1 = simulateDocDeleteTurn(store, session, scopeRoot, 1, '删除文档', 'del-doc')

      // 删除后验证
      const data = store.getScopeData(SCOPE)
      expect(data.documents.find((d) => d.id === 'del-doc')).toBeUndefined()

      // 回退
      const { restoredDocs } = performDocAwareRollback(store, session, scopeRoot, cp1.id)

      // 文档被重新创建
      const restored = store.getScopeData(SCOPE).documents.find((d) => d.id === 'del-doc')
      expect(restored).toBeDefined()
      expect(restored?.title).toBe('将被删除')
      expect(restored?.content).toBe('重要内容')
      expect(restoredDocs).toContain('del-doc')

      // 版本历史保持不变（内容未变，saveVersion hash 去重会跳过）
      const history = getVersionHistory(scopeRoot, 'del-doc')
      expect(history.versions).toHaveLength(1)
    })
  })

  // ─── 文件 + 文档混合回退 ───

  describe('文件 + 文档混合回退', () => {
    it('同一轮中修改文件和文档，回退后两者都恢复', () => {
      createDocInScope(store, scopeRoot, 'mix-doc', '混合文档', '文档原始内容')

      // 模拟一轮中同时修改文件和文档
      const messageIndex = session.messages.length
      const cp = createCheckpoint(session.id, messageIndex, '混合修改')
      initSnapshotCollector(session.id)

      session.messages.push(makeMsg('u-mix', 'user', '混合修改'))

      // 文件操作
      const existingFile = mdStore.readFileByPath(scopeRoot, 'mix.txt')
      captureFileSnapshot(session.id, 'mix.txt', existingFile?.content ?? null)
      mdStore.writeFileByPath(scopeRoot, 'mix.txt', 'file content v1')

      // 文档操作
      const latestVer = getLatestVersion(scopeRoot, 'mix-doc')
      captureFileSnapshot(
        session.id,
        '[doc:mix-doc]',
        JSON.stringify({ action: 'update', versionBefore: latestVer?.version ?? 0 })
      )
      const data = store.getScopeData(SCOPE)
      const doc = data.documents.find((d) => d.id === 'mix-doc')!
      doc.content = '文档修改后'
      doc.updatedAt = Date.now()
      store.saveScope(SCOPE)
      saveVersion(scopeRoot, 'mix-doc', doc.title, '文档修改后', {
        changedBy: { type: 'agent', sessionId: session.id, source: 'test:update' }
      })

      session.messages.push(makeMsg('a-mix', 'assistant', '已完成混合修改'))

      const completedCp = completeCheckpoint(cp, [])
      const snapshots = flushSnapshotCollector(session.id)
      saveFileSnapshots(scopeRoot, session.id, cp.id, snapshots)
      if (!session.checkpoints) session.checkpoints = []
      session.checkpoints.push(completedCp)
      store.saveScope(SCOPE)

      // 验证修改后状态
      expect(mdStore.readFileByPath(scopeRoot, 'mix.txt')?.content).toBe('file content v1')
      expect(store.getScopeData(SCOPE).documents.find((d) => d.id === 'mix-doc')?.content).toBe('文档修改后')

      // 回退
      performDocAwareRollback(store, session, scopeRoot, completedCp.id)

      // 文件恢复（新文件恢复为空字符串）
      expect(mdStore.readFileByPath(scopeRoot, 'mix.txt')?.content).toBe('')
      // 文档恢复
      expect(store.getScopeData(SCOPE).documents.find((d) => d.id === 'mix-doc')?.content).toBe('文档原始内容')
    })
  })

  // ─── 多 checkpoint 文件回退顺序修复验证 ───

  describe('多 checkpoint 文件回退 first-occurrence-wins', () => {
    it('连续 3 轮修改同一文件，回退到第 1 轮之前，恢复到原始状态', () => {
      mdStore.writeFileByPath(scopeRoot, 'seq.txt', 'original')

      const cp1 = simulateFileTurn(store, session, scopeRoot, 1, '第1轮', [
        { path: 'seq.txt', content: 'v1' }
      ])
      simulateFileTurn(store, session, scopeRoot, 2, '第2轮', [
        { path: 'seq.txt', content: 'v2' }
      ])
      simulateFileTurn(store, session, scopeRoot, 3, '第3轮', [
        { path: 'seq.txt', content: 'v3' }
      ])

      expect(mdStore.readFileByPath(scopeRoot, 'seq.txt')?.content).toBe('v3')

      // 回退到 cp1（first-occurrence-wins: cp1 快照="original"）
      performDocAwareRollback(store, session, scopeRoot, cp1.id)

      expect(mdStore.readFileByPath(scopeRoot, 'seq.txt')?.content).toBe('original')
    })

    it('多文件多轮修改，每个文件恢复到各自的第一次被记录的快照', () => {
      mdStore.writeFileByPath(scopeRoot, 'a.txt', 'a-orig')
      mdStore.writeFileByPath(scopeRoot, 'b.txt', 'b-orig')

      const cp1 = simulateFileTurn(store, session, scopeRoot, 1, '修改 a', [
        { path: 'a.txt', content: 'a-v1' }
      ])
      simulateFileTurn(store, session, scopeRoot, 2, '修改 a 和 b', [
        { path: 'a.txt', content: 'a-v2' },
        { path: 'b.txt', content: 'b-v1' }
      ])

      performDocAwareRollback(store, session, scopeRoot, cp1.id)

      // a.txt: cp1 快照="a-orig" (first-occurrence)
      expect(mdStore.readFileByPath(scopeRoot, 'a.txt')?.content).toBe('a-orig')
      // b.txt: cp2 快照="b-orig" (first-occurrence, cp1 没有 b.txt 快照)
      expect(mdStore.readFileByPath(scopeRoot, 'b.txt')?.content).toBe('b-orig')
    })
  })

  // ─── 版本历史线性性验证 ───

  describe('版本历史线性性', () => {
    it('修改 → 回退 → 再修改，版本号严格递增', () => {
      createDocInScope(store, scopeRoot, 'linear-doc', '线性', 'v1-content')

      // 第 1 轮修改
      const cp1 = simulateDocUpdateTurn(store, session, scopeRoot, 1, '修改', 'linear-doc', 'v2-content')

      // 回退
      performDocAwareRollback(store, session, scopeRoot, cp1.id)

      // 再次修改（回退后新的轮次）
      simulateDocUpdateTurn(store, session, scopeRoot, 2, '新修改', 'linear-doc', 'v4-content')

      const history = getVersionHistory(scopeRoot, 'linear-doc')
      // v1(initial) → v2(agent update) → v3(rollback to v1) → v4(new agent update)
      expect(history.versions).toHaveLength(4)
      expect(history.versions[0].version).toBe(1)
      expect(history.versions[1].version).toBe(2)
      expect(history.versions[2].version).toBe(3)
      expect(history.versions[3].version).toBe(4)

      // 版本号严格递增
      for (let i = 1; i < history.versions.length; i++) {
        expect(history.versions[i].version).toBe(history.versions[i - 1].version + 1)
      }
    })

    it('回退到相同内容时版本 hash 去重，不产生冗余版本', () => {
      createDocInScope(store, scopeRoot, 'dedup-doc', '去重', 'content-a')

      // 修改为 content-b
      const cp1 = simulateDocUpdateTurn(store, session, scopeRoot, 1, '修改', 'dedup-doc', 'content-b')

      // 再修改回 content-a（手动模拟用户操作使内容等于 v1）
      simulateDocUpdateTurn(store, session, scopeRoot, 2, '改回去', 'dedup-doc', 'content-a')

      // 此时最新版本的内容已经是 content-a
      // 回退到 cp1（恢复到 versionBefore=1, content=content-a）
      // saveVersion 的 hash 去重应该跳过（当前最新版已经是 content-a）
      const historyBefore = getVersionHistory(scopeRoot, 'dedup-doc')
      const versionCountBefore = historyBefore.versions.length

      performDocAwareRollback(store, session, scopeRoot, cp1.id)

      const historyAfter = getVersionHistory(scopeRoot, 'dedup-doc')
      // 不应增加新版本（hash 相同，被去重跳过）
      expect(historyAfter.versions.length).toBe(versionCountBefore)
    })
  })

  // ─── 快照数据格式验证 ───

  describe('快照数据格式', () => {
    it('文档 update 快照包含正确的 action 和 versionBefore', () => {
      createDocInScope(store, scopeRoot, 'fmt-doc', '格式', 'content')

      simulateDocUpdateTurn(store, session, scopeRoot, 1, '修改', 'fmt-doc', 'new content')

      const cp = session.checkpoints![0]
      const snapshots = loadFileSnapshots(scopeRoot, session.id, cp.id)
      const docSnapshot = snapshots['[doc:fmt-doc]']
      expect(docSnapshot).toBeDefined()

      const parsed = JSON.parse(docSnapshot)
      expect(parsed.action).toBe('update')
      expect(parsed.versionBefore).toBe(1)
    })

    it('文档 create 快照包含 action=create', () => {
      simulateDocCreateTurn(store, session, scopeRoot, 1, '创建', 'fmt-new', '新文档', '内容')

      const cp = session.checkpoints![0]
      const snapshots = loadFileSnapshots(scopeRoot, session.id, cp.id)
      const docSnapshot = snapshots['[doc:fmt-new]']
      expect(docSnapshot).toBeDefined()

      const parsed = JSON.parse(docSnapshot)
      expect(parsed.action).toBe('create')
    })

    it('文档 delete 快照包含 action=delete, versionBefore 和元数据', () => {
      createDocInScope(store, scopeRoot, 'fmt-del', '将删除', '内容')

      simulateDocDeleteTurn(store, session, scopeRoot, 1, '删除', 'fmt-del')

      const cp = session.checkpoints![0]
      const snapshots = loadFileSnapshots(scopeRoot, session.id, cp.id)
      const docSnapshot = snapshots['[doc:fmt-del]']
      expect(docSnapshot).toBeDefined()

      const parsed = JSON.parse(docSnapshot)
      expect(parsed.action).toBe('delete')
      expect(parsed.versionBefore).toBe(1)
      expect(parsed.title).toBe('将删除')
    })
  })
})
