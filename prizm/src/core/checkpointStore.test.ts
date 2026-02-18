import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

let tempDir: string

vi.mock('./PathProviderCore', () => ({
  getPrizmDir: (scopeRoot: string) => path.join(scopeRoot, '.prizm')
}))

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

describe('checkpointStore', () => {
  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `prizm-cp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    // 清理 snapshot collector 残留
    flushSnapshotCollector('any-session')
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // ─── createCheckpoint ───

  describe('createCheckpoint', () => {
    it('应返回包含正确字段的 checkpoint 对象', () => {
      const cp = createCheckpoint('session-1', 5, '你好')
      expect(cp.id).toBeTruthy()
      expect(cp.sessionId).toBe('session-1')
      expect(cp.messageIndex).toBe(5)
      expect(cp.userMessage).toBe('你好')
      expect(cp.createdAt).toBeGreaterThan(0)
      expect(cp.fileChanges).toEqual([])
      expect(cp.completed).toBe(false)
    })

    it('连续创建的 checkpoint ID 唯一', () => {
      const cp1 = createCheckpoint('s1', 0, 'a')
      const cp2 = createCheckpoint('s1', 1, 'b')
      const cp3 = createCheckpoint('s2', 0, 'c')
      const ids = new Set([cp1.id, cp2.id, cp3.id])
      expect(ids.size).toBe(3)
    })
  })

  // ─── completeCheckpoint ───

  describe('completeCheckpoint', () => {
    it('应标记 completed=true 并写入 fileChanges', () => {
      const cp = createCheckpoint('s1', 0, 'hello')
      const changes = [
        { path: 'test.txt', action: 'created' as const },
        { path: 'old.txt', action: 'deleted' as const }
      ]
      const completed = completeCheckpoint(cp, changes)
      expect(completed.completed).toBe(true)
      expect(completed.fileChanges).toEqual(changes)
      expect(completed.id).toBe(cp.id)
      expect(completed.sessionId).toBe(cp.sessionId)
    })

    it('不修改原始 checkpoint 对象（不可变）', () => {
      const cp = createCheckpoint('s1', 0, 'hello')
      completeCheckpoint(cp, [{ path: 'a.txt', action: 'created' }])
      expect(cp.completed).toBe(false)
      expect(cp.fileChanges).toEqual([])
    })
  })

  // ─── Snapshot Collector 生命周期 ───

  describe('Snapshot Collector', () => {
    const sid = 'test-session'

    afterEach(() => {
      flushSnapshotCollector(sid)
    })

    it('正常流程：init → capture → flush', () => {
      initSnapshotCollector(sid)
      captureFileSnapshot(sid, 'file1.txt', 'original content')
      captureFileSnapshot(sid, 'file2.txt', 'content 2')

      const result = flushSnapshotCollector(sid)
      expect(result).toEqual({
        'file1.txt': 'original content',
        'file2.txt': 'content 2'
      })
    })

    it('重复路径只记录首次内容', () => {
      initSnapshotCollector(sid)
      captureFileSnapshot(sid, 'file.txt', 'v1')
      captureFileSnapshot(sid, 'file.txt', 'v2-should-be-ignored')

      const result = flushSnapshotCollector(sid)
      expect(result['file.txt']).toBe('v1')
    })

    it('未初始化时 captureFileSnapshot 静默忽略', () => {
      captureFileSnapshot('nonexistent-session', 'file.txt', 'content')
      const result = flushSnapshotCollector('nonexistent-session')
      expect(result).toEqual({})
    })

    it('currentContent 为 null 时存储空字符串', () => {
      initSnapshotCollector(sid)
      captureFileSnapshot(sid, 'new-file.txt', null)

      const result = flushSnapshotCollector(sid)
      expect(result['new-file.txt']).toBe('')
    })

    it('flush 后自动清空，再次 flush 返回空', () => {
      initSnapshotCollector(sid)
      captureFileSnapshot(sid, 'file.txt', 'content')

      flushSnapshotCollector(sid)
      const second = flushSnapshotCollector(sid)
      expect(second).toEqual({})
    })

    it('多个 session 互不干扰', () => {
      initSnapshotCollector('s1')
      initSnapshotCollector('s2')
      captureFileSnapshot('s1', 'a.txt', 'a-content')
      captureFileSnapshot('s2', 'b.txt', 'b-content')

      const r1 = flushSnapshotCollector('s1')
      const r2 = flushSnapshotCollector('s2')
      expect(Object.keys(r1)).toEqual(['a.txt'])
      expect(Object.keys(r2)).toEqual(['b.txt'])
    })

    it('init 重置已有收集器', () => {
      initSnapshotCollector(sid)
      captureFileSnapshot(sid, 'old.txt', 'old')
      initSnapshotCollector(sid) // 重新初始化
      captureFileSnapshot(sid, 'new.txt', 'new')

      const result = flushSnapshotCollector(sid)
      expect(result).toEqual({ 'new.txt': 'new' })
    })
  })

  // ─── 文件快照磁盘读写 ───

  describe('saveFileSnapshots / loadFileSnapshots', () => {
    it('保存和加载快照', () => {
      const snapshots = { 'file1.txt': 'hello', 'dir/file2.txt': 'world' }
      saveFileSnapshots(tempDir, 'session-1', 'cp-1', snapshots)

      const loaded = loadFileSnapshots(tempDir, 'session-1', 'cp-1')
      expect(loaded).toEqual(snapshots)
    })

    it('空快照不写入文件', () => {
      saveFileSnapshots(tempDir, 'session-1', 'cp-empty', {})
      const cpDir = path.join(tempDir, '.prizm', 'checkpoints', 'session-1')
      expect(fs.existsSync(cpDir)).toBe(false)
    })

    it('文件不存在时 loadFileSnapshots 返回空', () => {
      const loaded = loadFileSnapshots(tempDir, 'no-session', 'no-cp')
      expect(loaded).toEqual({})
    })

    it('损坏 JSON 时 loadFileSnapshots 返回空', () => {
      const cpDir = path.join(tempDir, '.prizm', 'checkpoints', 'session-1')
      fs.mkdirSync(cpDir, { recursive: true })
      fs.writeFileSync(path.join(cpDir, 'bad-cp.json'), '{not valid json!!!', 'utf8')

      const loaded = loadFileSnapshots(tempDir, 'session-1', 'bad-cp')
      expect(loaded).toEqual({})
    })

    it('多个 checkpoint 各自独立存储', () => {
      saveFileSnapshots(tempDir, 's1', 'cp-a', { 'a.txt': 'aaa' })
      saveFileSnapshots(tempDir, 's1', 'cp-b', { 'b.txt': 'bbb' })

      expect(loadFileSnapshots(tempDir, 's1', 'cp-a')).toEqual({ 'a.txt': 'aaa' })
      expect(loadFileSnapshots(tempDir, 's1', 'cp-b')).toEqual({ 'b.txt': 'bbb' })
    })

    it('大文件内容可正确保存和加载', () => {
      const bigContent = 'x'.repeat(100_000)
      saveFileSnapshots(tempDir, 's1', 'cp-big', { 'big.txt': bigContent })
      const loaded = loadFileSnapshots(tempDir, 's1', 'cp-big')
      expect(loaded['big.txt'].length).toBe(100_000)
    })
  })

  // ─── deleteCheckpointSnapshots ───

  describe('deleteCheckpointSnapshots', () => {
    it('删除指定 checkpoint 的快照文件', () => {
      saveFileSnapshots(tempDir, 's1', 'cp-1', { 'f.txt': 'content' })
      saveFileSnapshots(tempDir, 's1', 'cp-2', { 'g.txt': 'content' })

      deleteCheckpointSnapshots(tempDir, 's1', ['cp-1'])

      expect(loadFileSnapshots(tempDir, 's1', 'cp-1')).toEqual({})
      expect(loadFileSnapshots(tempDir, 's1', 'cp-2')).toEqual({ 'g.txt': 'content' })
    })

    it('批量删除多个', () => {
      saveFileSnapshots(tempDir, 's1', 'cp-a', { 'a.txt': 'a' })
      saveFileSnapshots(tempDir, 's1', 'cp-b', { 'b.txt': 'b' })
      saveFileSnapshots(tempDir, 's1', 'cp-c', { 'c.txt': 'c' })

      deleteCheckpointSnapshots(tempDir, 's1', ['cp-a', 'cp-c'])

      expect(loadFileSnapshots(tempDir, 's1', 'cp-a')).toEqual({})
      expect(loadFileSnapshots(tempDir, 's1', 'cp-b')).toEqual({ 'b.txt': 'b' })
      expect(loadFileSnapshots(tempDir, 's1', 'cp-c')).toEqual({})
    })

    it('不存在的 checkpoint ID 不报错', () => {
      expect(() => {
        deleteCheckpointSnapshots(tempDir, 's1', ['nonexistent'])
      }).not.toThrow()
    })
  })

  // ─── deleteSessionCheckpoints ───

  describe('deleteSessionCheckpoints', () => {
    it('删除整个会话的 checkpoint 目录', () => {
      saveFileSnapshots(tempDir, 's1', 'cp-1', { 'f.txt': 'content' })
      saveFileSnapshots(tempDir, 's1', 'cp-2', { 'g.txt': 'content' })

      deleteSessionCheckpoints(tempDir, 's1')

      const cpDir = path.join(tempDir, '.prizm', 'checkpoints', 's1')
      expect(fs.existsSync(cpDir)).toBe(false)
    })

    it('目录不存在时不报错', () => {
      expect(() => {
        deleteSessionCheckpoints(tempDir, 'no-such-session')
      }).not.toThrow()
    })

    it('不影响其他会话的快照', () => {
      saveFileSnapshots(tempDir, 's1', 'cp-1', { 'f.txt': 'a' })
      saveFileSnapshots(tempDir, 's2', 'cp-1', { 'f.txt': 'b' })

      deleteSessionCheckpoints(tempDir, 's1')

      expect(loadFileSnapshots(tempDir, 's2', 'cp-1')).toEqual({ 'f.txt': 'b' })
    })
  })

  // ─── extractFileChangesFromMessages ───

  describe('extractFileChangesFromMessages', () => {
    function toolPart(name: string, args: Record<string, string>, opts?: { isError?: boolean }) {
      return {
        type: 'tool' as const,
        name,
        arguments: JSON.stringify(args),
        result: 'ok',
        ...(opts?.isError !== undefined && { isError: opts.isError })
      }
    }

    it('解析 prizm_file_write', () => {
      const changes = extractFileChangesFromMessages([
        { parts: [toolPart('prizm_file_write', { path: 'test.txt', content: 'hello' })] }
      ])
      expect(changes).toEqual([{ path: 'test.txt', action: 'created' }])
    })

    it('解析 prizm_file_move', () => {
      const changes = extractFileChangesFromMessages([
        { parts: [toolPart('prizm_file_move', { from: 'old.txt', to: 'new.txt' })] }
      ])
      expect(changes).toEqual([{ path: 'new.txt', action: 'moved', fromPath: 'old.txt' }])
    })

    it('解析 prizm_file_delete', () => {
      const changes = extractFileChangesFromMessages([
        { parts: [toolPart('prizm_file_delete', { path: 'trash.txt' })] }
      ])
      expect(changes).toEqual([{ path: 'trash.txt', action: 'deleted' }])
    })

    it('解析 prizm_create_document', () => {
      const changes = extractFileChangesFromMessages([
        { parts: [toolPart('prizm_create_document', { title: '新文档' })] }
      ])
      expect(changes).toEqual([{ path: '[doc] 新文档', action: 'created' }])
    })

    it('解析 prizm_update_document', () => {
      const changes = extractFileChangesFromMessages([
        { parts: [toolPart('prizm_update_document', { id: 'doc-1' })] }
      ])
      expect(changes).toEqual([{ path: '[doc] doc-1', action: 'modified' }])
    })

    it('解析 prizm_delete_document', () => {
      const changes = extractFileChangesFromMessages([
        { parts: [toolPart('prizm_delete_document', { id: 'doc-2' })] }
      ])
      expect(changes).toEqual([{ path: '[doc] doc-2', action: 'deleted' }])
    })

    it('同一路径去重', () => {
      const changes = extractFileChangesFromMessages([
        {
          parts: [
            toolPart('prizm_file_write', { path: 'same.txt', content: 'v1' }),
            toolPart('prizm_file_write', { path: 'same.txt', content: 'v2' })
          ]
        }
      ])
      expect(changes).toHaveLength(1)
    })

    it('isError=true 的 tool call 被跳过', () => {
      const changes = extractFileChangesFromMessages([
        { parts: [toolPart('prizm_file_write', { path: 'fail.txt' }, { isError: true })] }
      ])
      expect(changes).toEqual([])
    })

    it('无效 JSON 参数容错', () => {
      const changes = extractFileChangesFromMessages([
        {
          parts: [
            { type: 'tool', name: 'prizm_file_write', arguments: '{invalid json', result: 'ok' }
          ]
        }
      ])
      expect(changes).toEqual([])
    })

    it('非 tool 类型的 part 被忽略', () => {
      const changes = extractFileChangesFromMessages([
        {
          parts: [
            { type: 'text', name: 'prizm_file_write', arguments: '{}' }
          ]
        }
      ])
      expect(changes).toEqual([])
    })

    it('不识别的 tool name 被忽略', () => {
      const changes = extractFileChangesFromMessages([
        { parts: [toolPart('prizm_some_other_tool', { path: 'x.txt' })] }
      ])
      expect(changes).toEqual([])
    })

    it('跨消息聚合并去重', () => {
      const changes = extractFileChangesFromMessages([
        { parts: [toolPart('prizm_file_write', { path: 'a.txt', content: 'a' })] },
        {
          parts: [
            toolPart('prizm_file_write', { path: 'a.txt', content: 'a-v2' }),
            toolPart('prizm_file_write', { path: 'b.txt', content: 'b' })
          ]
        }
      ])
      expect(changes).toHaveLength(2)
      expect(changes.map((c) => c.path)).toEqual(['a.txt', 'b.txt'])
    })

    it('空消息列表返回空数组', () => {
      expect(extractFileChangesFromMessages([])).toEqual([])
    })

    it('空 parts 的消息不报错', () => {
      expect(extractFileChangesFromMessages([{ parts: [] }])).toEqual([])
    })
  })
})
