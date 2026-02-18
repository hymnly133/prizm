/**
 * sessionStore BG 字段持久化解析/写入往返测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { AgentSession } from '../../types'
import { readAgentSessions, writeAgentSessions } from './sessionStore'

let tempDir: string

function makeScopeRoot(): string {
  const dir = path.join(tempDir, 'scopes', 'test-scope')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

beforeEach(() => {
  tempDir = path.join(
    os.tmpdir(),
    `prizm-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  fs.mkdirSync(tempDir, { recursive: true })
})

afterEach(() => {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

describe('sessionStore BG 字段持久化', () => {
  describe('parseAgentSession 兼容性', () => {
    it('旧数据（无 BG 字段）→ 解析成功，BG 字段均为 undefined', () => {
      const scopeRoot = makeScopeRoot()
      const session: AgentSession = {
        id: 'old-sess-1',
        scope: 'test-scope',
        messages: [
          { id: 'm1', role: 'user', parts: [{ type: 'text', content: 'hello' }], createdAt: 100 }
        ],
        createdAt: 100,
        updatedAt: 200
      }

      writeAgentSessions(scopeRoot, [session], 'test-scope')
      const loaded = readAgentSessions(scopeRoot)

      expect(loaded).toHaveLength(1)
      expect(loaded[0].kind).toBeUndefined()
      expect(loaded[0].bgMeta).toBeUndefined()
      expect(loaded[0].bgStatus).toBeUndefined()
      expect(loaded[0].bgResult).toBeUndefined()
      expect(loaded[0].startedAt).toBeUndefined()
      expect(loaded[0].finishedAt).toBeUndefined()
    })

    it('新数据（含 BG 字段）→ 正确解析', () => {
      const scopeRoot = makeScopeRoot()
      const session: AgentSession = {
        id: 'bg-sess-1',
        scope: 'test-scope',
        messages: [],
        createdAt: 100,
        updatedAt: 200,
        kind: 'background',
        bgMeta: {
          triggerType: 'tool_spawn',
          parentSessionId: 'parent-1',
          label: '数据分析',
          timeoutMs: 30000,
          depth: 1,
          memoryPolicy: {
            skipPerRoundExtract: true,
            skipDocumentExtract: false,
            skipConversationSummary: true,
            skipNarrativeBatchExtract: true
          },
          announceTarget: { sessionId: 'parent-1', scope: 'default' }
        },
        bgStatus: 'completed',
        bgResult: '分析结果',
        startedAt: 150,
        finishedAt: 250
      }

      writeAgentSessions(scopeRoot, [session], 'test-scope')
      const loaded = readAgentSessions(scopeRoot)

      expect(loaded).toHaveLength(1)
      expect(loaded[0].kind).toBe('background')
      expect(loaded[0].bgStatus).toBe('completed')
      expect(loaded[0].bgResult).toBe('分析结果')
      expect(loaded[0].startedAt).toBe(150)
      expect(loaded[0].finishedAt).toBe(250)
    })
  })

  describe('writeAgentSessions → readAgentSessions 往返', () => {
    it('写入带 BG 字段的 session → 重新读取 → 所有字段一致', () => {
      const scopeRoot = makeScopeRoot()
      const session: AgentSession = {
        id: 'rt-sess-1',
        scope: 'test-scope',
        messages: [
          { id: 'm1', role: 'user', parts: [{ type: 'text', content: '执行任务' }], createdAt: 100 },
          { id: 'm2', role: 'assistant', parts: [{ type: 'text', content: '已完成' }], createdAt: 200 }
        ],
        createdAt: 100,
        updatedAt: 300,
        kind: 'background',
        bgMeta: { triggerType: 'api', label: 'test' },
        bgStatus: 'completed',
        bgResult: '任务结果文本',
        startedAt: 100,
        finishedAt: 300
      }

      writeAgentSessions(scopeRoot, [session], 'test-scope')
      const loaded = readAgentSessions(scopeRoot)

      expect(loaded).toHaveLength(1)
      const s = loaded[0]
      expect(s.id).toBe('rt-sess-1')
      expect(s.kind).toBe('background')
      expect(s.bgMeta?.triggerType).toBe('api')
      expect(s.bgMeta?.label).toBe('test')
      expect(s.bgStatus).toBe('completed')
      expect(s.bgResult).toBe('任务结果文本')
      expect(s.startedAt).toBe(100)
      expect(s.finishedAt).toBe(300)
      expect(s.messages).toHaveLength(2)
    })

    it('bgMeta 包含嵌套对象（memoryPolicy, announceTarget）→ 序列化/反序列化正确', () => {
      const scopeRoot = makeScopeRoot()
      const session: AgentSession = {
        id: 'nested-sess-1',
        scope: 'test-scope',
        messages: [],
        createdAt: 100,
        updatedAt: 200,
        kind: 'background',
        bgMeta: {
          triggerType: 'tool_spawn',
          parentSessionId: 'p-1',
          depth: 2,
          memoryPolicy: {
            skipPerRoundExtract: true,
            skipDocumentExtract: true,
            skipConversationSummary: false,
            skipNarrativeBatchExtract: true
          },
          announceTarget: { sessionId: 'p-1', scope: 'other-scope' }
        },
        bgStatus: 'running',
        startedAt: 100
      }

      writeAgentSessions(scopeRoot, [session], 'test-scope')
      const loaded = readAgentSessions(scopeRoot)

      expect(loaded).toHaveLength(1)
      const meta = loaded[0].bgMeta!
      expect(meta.parentSessionId).toBe('p-1')
      expect(meta.depth).toBe(2)
      expect(meta.memoryPolicy?.skipPerRoundExtract).toBe(true)
      expect(meta.memoryPolicy?.skipDocumentExtract).toBe(true)
      expect(meta.memoryPolicy?.skipConversationSummary).toBe(false)
      expect(meta.announceTarget?.sessionId).toBe('p-1')
      expect(meta.announceTarget?.scope).toBe('other-scope')
    })

    it('无 BG 字段的 session → 写入/读取不引入额外字段', () => {
      const scopeRoot = makeScopeRoot()
      const session: AgentSession = {
        id: 'plain-sess-1',
        scope: 'test-scope',
        messages: [],
        createdAt: 100,
        updatedAt: 200
      }

      writeAgentSessions(scopeRoot, [session], 'test-scope')
      const loaded = readAgentSessions(scopeRoot)

      expect(loaded).toHaveLength(1)
      const s = loaded[0]
      expect(s.kind).toBeUndefined()
      expect(s.bgMeta).toBeUndefined()
      expect(s.bgStatus).toBeUndefined()
      expect(s.bgResult).toBeUndefined()
      expect(s.startedAt).toBeUndefined()
      expect(s.finishedAt).toBeUndefined()
    })
  })
})
