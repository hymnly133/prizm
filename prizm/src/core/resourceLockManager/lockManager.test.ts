import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

let tempDir: string

// Mock PathProviderCore to use temp dir
vi.mock('../PathProviderCore', () => ({
  getDataDir: () => tempDir,
  ensureDataDir: () => {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
  }
}))

// Import after mocking
import * as lockManager from './lockManager'
import * as lockStore from './lockStore'

describe('LockManager', () => {
  beforeEach(() => {
    tempDir = path.join(
      os.tmpdir(),
      `prizm-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    fs.mkdirSync(tempDir, { recursive: true })
    lockStore.initLockStore()
  })

  afterEach(() => {
    lockStore.closeLockStore()
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('acquireLock / releaseLock', () => {
    it('应成功获取锁', () => {
      const result = lockManager.acquireLock(
        'default',
        'document',
        'doc-1',
        'session-A',
        '编辑文档'
      )
      expect(result.success).toBe(true)
      expect(result.lock).toBeDefined()
      expect(result.lock!.sessionId).toBe('session-A')
      expect(result.lock!.fenceToken).toBe(1)
      expect(result.lock!.reason).toBe('编辑文档')
    })

    it('同一 session 重入应刷新心跳并成功', () => {
      lockManager.acquireLock('default', 'document', 'doc-1', 'session-A')
      const result = lockManager.acquireLock('default', 'document', 'doc-1', 'session-A')
      expect(result.success).toBe(true)
    })

    it('不同 session 应获取失败', () => {
      lockManager.acquireLock('default', 'document', 'doc-1', 'session-A')
      const result = lockManager.acquireLock('default', 'document', 'doc-1', 'session-B')
      expect(result.success).toBe(false)
      expect(result.heldBy).toBeDefined()
      expect(result.heldBy!.sessionId).toBe('session-A')
    })

    it('释放锁后其他 session 应可获取', () => {
      lockManager.acquireLock('default', 'document', 'doc-1', 'session-A')
      const released = lockManager.releaseLock('default', 'document', 'doc-1', 'session-A')
      expect(released).toBe(true)

      const result = lockManager.acquireLock('default', 'document', 'doc-1', 'session-B')
      expect(result.success).toBe(true)
      expect(result.lock!.fenceToken).toBe(2)
    })

    it('非锁持有者不能释放', () => {
      lockManager.acquireLock('default', 'document', 'doc-1', 'session-A')
      const released = lockManager.releaseLock('default', 'document', 'doc-1', 'session-B')
      expect(released).toBe(false)
    })
  })

  describe('fencing token', () => {
    it('每次获取锁 fence token 应单调递增', () => {
      const r1 = lockManager.acquireLock('default', 'document', 'doc-1', 'session-A')
      expect(r1.lock!.fenceToken).toBe(1)

      lockManager.releaseLock('default', 'document', 'doc-1', 'session-A')
      const r2 = lockManager.acquireLock('default', 'document', 'doc-1', 'session-B')
      expect(r2.lock!.fenceToken).toBe(2)

      lockManager.releaseLock('default', 'document', 'doc-1', 'session-B')
      const r3 = lockManager.acquireLock('default', 'document', 'doc-1', 'session-A')
      expect(r3.lock!.fenceToken).toBe(3)
    })

    it('validateFence 应正确验证', () => {
      const r = lockManager.acquireLock('default', 'document', 'doc-1', 'session-A')
      expect(lockManager.validateFence('default', 'document', 'doc-1', r.lock!.fenceToken)).toBe(
        true
      )
      expect(lockManager.validateFence('default', 'document', 'doc-1', 999)).toBe(false)
    })
  })

  describe('expiry / cleanup', () => {
    it('过期锁应被自动接管', () => {
      // 获取锁并设极短 TTL
      const r = lockManager.acquireLock('default', 'document', 'doc-1', 'session-A', undefined, 1)

      // 等待过期
      const waitUntil = Date.now() + 10
      while (Date.now() < waitUntil) {
        /* spin */
      }

      // 新 session 应能获取
      const r2 = lockManager.acquireLock('default', 'document', 'doc-1', 'session-B')
      expect(r2.success).toBe(true)
      expect(r2.lock!.sessionId).toBe('session-B')
    })
  })

  describe('releaseSessionLocks', () => {
    it('应释放会话的所有锁', () => {
      lockManager.acquireLock('default', 'document', 'doc-1', 'session-A')
      lockManager.acquireLock('default', 'todo_list', 'list-1', 'session-A')
      lockManager.acquireLock('default', 'document', 'doc-2', 'session-B')

      const count = lockManager.releaseSessionLocks('default', 'session-A')
      expect(count).toBe(2)

      // session-A 的锁都释放了
      expect(lockManager.getLock('default', 'document', 'doc-1')).toBeNull()
      expect(lockManager.getLock('default', 'todo_list', 'list-1')).toBeNull()

      // session-B 的锁不受影响
      expect(lockManager.getLock('default', 'document', 'doc-2')).not.toBeNull()
    })
  })

  describe('recordRead / getResourceStatus', () => {
    it('应记录读取并返回状态', () => {
      lockManager.recordRead('default', 'session-A', 'document', 'doc-1', 1)
      lockManager.recordRead('default', 'session-B', 'document', 'doc-1', 2)

      const status = lockManager.getResourceStatus('default', 'document', 'doc-1')
      expect(status.lock).toBeNull()
      expect(status.recentReads.length).toBe(2)
      // 两条读取记录都存在（版本 1 和 2）
      const versions = status.recentReads.map((r) => r.readVersion).sort()
      expect(versions).toEqual([1, 2])
    })
  })

  describe('updateLockMetadata', () => {
    it('应更新锁的元数据', () => {
      lockManager.acquireLock('default', 'todo_list', 'list-1', 'session-A')
      lockManager.updateLockMetadata('default', 'todo_list', 'list-1', 'session-A', {
        activeTodoIds: ['todo-1', 'todo-2']
      })

      const lock = lockManager.getLock('default', 'todo_list', 'list-1')
      expect(lock).not.toBeNull()
      const meta = JSON.parse(lock!.metadata!)
      expect(meta.activeTodoIds).toEqual(['todo-1', 'todo-2'])
    })
  })
})
