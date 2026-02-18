/**
 * fileTools 快照捕获测试
 *
 * 验证 executeFileWrite / executeFileMove / executeFileDelete
 * 在执行操作前正确调用 captureFileSnapshot。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

let tempDir: string

vi.mock('../../core/PathProviderCore', () => ({
  getPrizmDir: (scopeRoot: string) => path.join(scopeRoot, '.prizm'),
  getDataDir: () => tempDir,
  ensureDataDir: () => {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
  },
  getSessionWorkspaceDir: (scopeRoot: string, sessionId: string) =>
    path.join(scopeRoot, '.prizm', 'agent-sessions', sessionId, 'workspace')
}))

// Mock fileService to avoid event bus side effects
vi.mock('../../services/fileService', () => ({
  writeFile: vi.fn(async (_ctx: unknown, scopeRoot: string, relativePath: string, content: string) => {
    const { writeFileByPath } = await import('../../core/mdStore')
    return writeFileByPath(scopeRoot, relativePath, content)
  }),
  moveFile: vi.fn(async (_ctx: unknown, scopeRoot: string, from: string, to: string) => {
    const { moveFile } = await import('../../core/mdStore')
    return moveFile(scopeRoot, from, to)
  }),
  deleteFile: vi.fn(async (_ctx: unknown, scopeRoot: string, relativePath: string) => {
    const { deleteByPath } = await import('../../core/mdStore')
    return deleteByPath(scopeRoot, relativePath)
  })
}))

import * as checkpointStore from '../../core/checkpointStore'
import * as mdStore from '../../core/mdStore'
import { executeFileWrite, executeFileMove, executeFileDelete } from './fileTools'
import type { BuiltinToolContext } from './types'

const captureFileSpy = vi.spyOn(checkpointStore, 'captureFileSnapshot')

function makeCtx(overrides: Partial<BuiltinToolContext> = {}): BuiltinToolContext {
  return {
    scope: 'test-scope',
    toolName: 'prizm_file_write',
    args: {},
    scopeRoot: tempDir,
    data: { documents: [], todoLists: [], clipboard: [], agentSessions: [] },
    wsCtx: { scopeRoot: tempDir, sessionWorkspaceRoot: null, sessionId: null },
    record: vi.fn(),
    emitAudit: vi.fn(),
    wsArg: undefined,
    sessionId: 'test-session',
    grantedPaths: undefined,
    ...overrides
  }
}

describe('fileTools snapshot capture', () => {
  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `prizm-ft-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tempDir, { recursive: true })
    captureFileSpy.mockClear()
    checkpointStore.initSnapshotCollector('test-session')
  })

  afterEach(() => {
    checkpointStore.flushSnapshotCollector('test-session')
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('executeFileWrite', () => {
    it('文件已存在时 captureFileSnapshot 传入旧内容', async () => {
      mdStore.writeFileByPath(tempDir, 'existing.txt', 'old content')

      const ctx = makeCtx({
        toolName: 'prizm_file_write',
        args: { path: 'existing.txt', content: 'new content' }
      })
      await executeFileWrite(ctx)

      expect(captureFileSpy).toHaveBeenCalledWith('test-session', 'existing.txt', 'old content')
    })

    it('文件不存在时 captureFileSnapshot 传入 null', async () => {
      const ctx = makeCtx({
        toolName: 'prizm_file_write',
        args: { path: 'brand-new.txt', content: 'hello' }
      })
      await executeFileWrite(ctx)

      expect(captureFileSpy).toHaveBeenCalledWith('test-session', 'brand-new.txt', null)
    })

    it('无 sessionId 时不调用 captureFileSnapshot', async () => {
      const ctx = makeCtx({
        toolName: 'prizm_file_write',
        args: { path: 'test.txt', content: 'x' },
        sessionId: undefined
      })
      await executeFileWrite(ctx)

      expect(captureFileSpy).not.toHaveBeenCalled()
    })
  })

  describe('executeFileMove', () => {
    it('对 from 路径调用 captureFileSnapshot', async () => {
      mdStore.writeFileByPath(tempDir, 'source.txt', 'source content')

      const ctx = makeCtx({
        toolName: 'prizm_file_move',
        args: { from: 'source.txt', to: 'dest.txt' }
      })
      await executeFileMove(ctx)

      expect(captureFileSpy).toHaveBeenCalledWith('test-session', 'source.txt', 'source content')
    })

    it('source 文件不存在时 captureFileSnapshot 传入 null', async () => {
      const ctx = makeCtx({
        toolName: 'prizm_file_move',
        args: { from: 'nonexistent.txt', to: 'dest.txt' }
      })
      await executeFileMove(ctx)

      expect(captureFileSpy).toHaveBeenCalledWith('test-session', 'nonexistent.txt', null)
    })
  })

  describe('executeFileDelete', () => {
    it('删除前调用 captureFileSnapshot 保存内容', async () => {
      mdStore.writeFileByPath(tempDir, 'to-delete.txt', 'delete me')

      const ctx = makeCtx({
        toolName: 'prizm_file_delete',
        args: { path: 'to-delete.txt' }
      })
      await executeFileDelete(ctx)

      expect(captureFileSpy).toHaveBeenCalledWith('test-session', 'to-delete.txt', 'delete me')
    })

    it('文件不存在时 captureFileSnapshot 传入 null', async () => {
      const ctx = makeCtx({
        toolName: 'prizm_file_delete',
        args: { path: 'ghost.txt' }
      })
      await executeFileDelete(ctx)

      expect(captureFileSpy).toHaveBeenCalledWith('test-session', 'ghost.txt', null)
    })
  })
})
