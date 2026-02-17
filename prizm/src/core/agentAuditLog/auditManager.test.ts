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
import * as auditManager from './auditManager'
import * as auditStore from './auditStore'

describe('AuditManager', () => {
  beforeEach(() => {
    tempDir = path.join(
      os.tmpdir(),
      `prizm-audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    fs.mkdirSync(tempDir, { recursive: true })
    auditStore.initAuditStore()
  })

  afterEach(() => {
    auditStore.closeAuditStore()
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('record', () => {
    it('应记录审计条目并返回完整信息', () => {
      const entry = auditManager.record('default', 'session-1', {
        toolName: 'prizm_update_document',
        action: 'update',
        resourceType: 'document',
        resourceId: 'doc-1',
        resourceTitle: '测试文档',
        result: 'success'
      })

      expect(entry.id).toBeDefined()
      expect(entry.scope).toBe('default')
      expect(entry.sessionId).toBe('session-1')
      expect(entry.toolName).toBe('prizm_update_document')
      expect(entry.action).toBe('update')
      expect(entry.resourceType).toBe('document')
      expect(entry.resourceId).toBe('doc-1')
      expect(entry.result).toBe('success')
      expect(entry.timestamp).toBeGreaterThan(0)
    })

    it('应记录带记忆类型的审计条目', () => {
      const entry = auditManager.record('default', 'session-1', {
        toolName: 'prizm_search_docs_by_memory',
        action: 'search',
        resourceType: 'memory',
        memoryType: 'document',
        documentSubType: 'overview',
        detail: 'query="测试"',
        result: 'success'
      })

      expect(entry.memoryType).toBe('document')
      expect(entry.documentSubType).toBe('overview')
    })
  })

  describe('query', () => {
    beforeEach(() => {
      // 插入多条测试数据
      auditManager.record('default', 'session-1', {
        toolName: 'prizm_checkout_document',
        action: 'checkout',
        resourceType: 'document',
        resourceId: 'doc-1',
        result: 'success'
      })
      auditManager.record('default', 'session-1', {
        toolName: 'prizm_update_document',
        action: 'update',
        resourceType: 'document',
        resourceId: 'doc-1',
        result: 'success'
      })
      auditManager.record('default', 'session-2', {
        toolName: 'prizm_claim_todo_list',
        action: 'claim',
        resourceType: 'todo_list',
        resourceId: 'list-1',
        result: 'denied',
        errorMessage: '已被其他会话领取'
      })
      auditManager.record('scope-2', 'session-3', {
        toolName: 'prizm_get_document_content',
        action: 'read',
        resourceType: 'document',
        resourceId: 'doc-2',
        result: 'success'
      })
    })

    it('按 scope 过滤', () => {
      const entries = auditManager.query({ scope: 'default' })
      expect(entries.length).toBe(3)
    })

    it('按 sessionId 过滤', () => {
      const entries = auditManager.query({ sessionId: 'session-1' })
      expect(entries.length).toBe(2)
    })

    it('按 resourceType 过滤', () => {
      const entries = auditManager.query({ scope: 'default', resourceType: 'todo_list' })
      expect(entries.length).toBe(1)
    })

    it('按 result 过滤', () => {
      const entries = auditManager.query({ result: 'denied' })
      expect(entries.length).toBe(1)
      expect(entries[0].errorMessage).toBe('已被其他会话领取')
    })

    it('按 action 过滤', () => {
      const entries = auditManager.query({ action: 'checkout' })
      expect(entries.length).toBe(1)
    })

    it('分页支持', () => {
      const page1 = auditManager.query({ scope: 'default', limit: 2 })
      expect(page1.length).toBe(2)
      const page2 = auditManager.query({ scope: 'default', limit: 2, offset: 2 })
      expect(page2.length).toBe(1)
    })
  })

  describe('getResourceHistory', () => {
    it('应返回指定资源的操作历史', () => {
      auditManager.record('default', 'session-1', {
        toolName: 'prizm_get_document_content',
        action: 'read',
        resourceType: 'document',
        resourceId: 'doc-1',
        result: 'success'
      })
      auditManager.record('default', 'session-1', {
        toolName: 'prizm_update_document',
        action: 'update',
        resourceType: 'document',
        resourceId: 'doc-1',
        result: 'success'
      })
      auditManager.record('default', 'session-1', {
        toolName: 'prizm_update_todo',
        action: 'update',
        resourceType: 'todo',
        resourceId: 'todo-1',
        result: 'success'
      })

      const history = auditManager.getResourceHistory('default', 'document', 'doc-1')
      expect(history.length).toBe(2)
    })
  })

  describe('countSessionEntries', () => {
    it('应返回会话的审计条数', () => {
      auditManager.record('default', 'session-1', {
        toolName: 'test1',
        action: 'read',
        resourceType: 'document',
        result: 'success'
      })
      auditManager.record('default', 'session-1', {
        toolName: 'test2',
        action: 'update',
        resourceType: 'document',
        result: 'success'
      })
      auditManager.record('default', 'session-2', {
        toolName: 'test3',
        action: 'read',
        resourceType: 'document',
        result: 'success'
      })

      expect(auditManager.countSessionEntries('default', 'session-1')).toBe(2)
      expect(auditManager.countSessionEntries('default', 'session-2')).toBe(1)
    })
  })
})
