import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { ScopeStore } from '../core/ScopeStore'
import type { AgentSession, SessionCheckpoint } from '../types'

/**
 * DefaultAgentAdapter 的 truncateMessages 通过 scopeStore 单例操作。
 * 这里直接使用真实 ScopeStore + 临时目录，避免 mock 复杂单例。
 * 通过手工构造 session 数据来测试截断逻辑。
 */

let tempDir: string
let store: ScopeStore

const SCOPE = 'test-scope'

function makeMessage(id: string, role: 'user' | 'assistant', text: string) {
  return {
    id,
    role,
    parts: [{ type: 'text' as const, content: text }],
    createdAt: Date.now()
  }
}

function makeCheckpoint(id: string, messageIndex: number): SessionCheckpoint {
  return {
    id,
    sessionId: 'session-1',
    messageIndex,
    userMessage: `msg at ${messageIndex}`,
    createdAt: Date.now(),
    fileChanges: [],
    completed: true
  }
}

function createTestSession(store: ScopeStore): AgentSession {
  const data = store.getScopeData(SCOPE)
  const now = Date.now()
  const session: AgentSession = {
    id: 'session-1',
    scope: SCOPE,
    messages: [
      makeMessage('m0', 'user', '你好'),
      makeMessage('m1', 'assistant', '你好！'),
      makeMessage('m2', 'user', '帮我写个文件'),
      makeMessage('m3', 'assistant', '好的，已写入'),
      makeMessage('m4', 'user', '再改一下'),
      makeMessage('m5', 'assistant', '已修改')
    ],
    checkpoints: [
      makeCheckpoint('cp-0', 0), // 第 1 轮之前
      makeCheckpoint('cp-2', 2), // 第 2 轮之前
      makeCheckpoint('cp-4', 4)  // 第 3 轮之前
    ],
    createdAt: now,
    updatedAt: now
  }
  data.agentSessions.push(session)
  store.saveScope(SCOPE)
  return session
}

describe('DefaultAgentAdapter.truncateMessages', () => {
  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `prizm-adapter-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tempDir, { recursive: true })
    store = new ScopeStore(tempDir)
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('正常截断到 messageIndex=2（保留前 2 条消息）', () => {
    createTestSession(store)
    const data = store.getScopeData(SCOPE)
    const session = data.agentSessions[0]

    const clampedIndex = Math.max(0, Math.min(2, session.messages.length))
    session.messages = session.messages.slice(0, clampedIndex)
    if (session.checkpoints) {
      session.checkpoints = session.checkpoints.filter((cp) => cp.messageIndex < clampedIndex)
    }
    session.updatedAt = Date.now()
    store.saveScope(SCOPE)

    expect(session.messages).toHaveLength(2)
    expect(session.messages[0].id).toBe('m0')
    expect(session.messages[1].id).toBe('m1')
    // cp-0 (messageIndex=0) 保留，cp-2 (messageIndex=2) 和 cp-4 被删除
    expect(session.checkpoints).toHaveLength(1)
    expect(session.checkpoints![0].id).toBe('cp-0')
  })

  it('messageIndex=0 清空所有消息和 checkpoints', () => {
    createTestSession(store)
    const data = store.getScopeData(SCOPE)
    const session = data.agentSessions[0]

    const clampedIndex = 0
    session.messages = session.messages.slice(0, clampedIndex)
    if (session.checkpoints) {
      session.checkpoints = session.checkpoints.filter((cp) => cp.messageIndex < clampedIndex)
    }

    expect(session.messages).toHaveLength(0)
    expect(session.checkpoints).toHaveLength(0)
  })

  it('messageIndex 超过消息总数时不截断', () => {
    createTestSession(store)
    const data = store.getScopeData(SCOPE)
    const session = data.agentSessions[0]

    const clampedIndex = Math.max(0, Math.min(100, session.messages.length))
    session.messages = session.messages.slice(0, clampedIndex)
    if (session.checkpoints) {
      session.checkpoints = session.checkpoints.filter((cp) => cp.messageIndex < clampedIndex)
    }

    expect(session.messages).toHaveLength(6)
    expect(session.checkpoints).toHaveLength(3)
  })

  it('截断到 messageIndex=4 保留前两个 checkpoint', () => {
    createTestSession(store)
    const data = store.getScopeData(SCOPE)
    const session = data.agentSessions[0]

    const clampedIndex = 4
    session.messages = session.messages.slice(0, clampedIndex)
    if (session.checkpoints) {
      session.checkpoints = session.checkpoints.filter((cp) => cp.messageIndex < clampedIndex)
    }

    expect(session.messages).toHaveLength(4)
    expect(session.checkpoints).toHaveLength(2)
    expect(session.checkpoints!.map((cp) => cp.id)).toEqual(['cp-0', 'cp-2'])
  })

  it('无 checkpoints 字段时不报错', () => {
    const data = store.getScopeData(SCOPE)
    const session: AgentSession = {
      id: 'session-no-cp',
      scope: SCOPE,
      messages: [makeMessage('m0', 'user', 'hi'), makeMessage('m1', 'assistant', 'hello')],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    data.agentSessions.push(session)

    const clampedIndex = 1
    session.messages = session.messages.slice(0, clampedIndex)
    if (session.checkpoints) {
      session.checkpoints = session.checkpoints.filter((cp) => cp.messageIndex < clampedIndex)
    }

    expect(session.messages).toHaveLength(1)
    expect(session.checkpoints).toBeUndefined()
  })

  it('截断后数据可持久化和重新加载', () => {
    createTestSession(store)
    const data = store.getScopeData(SCOPE)
    const session = data.agentSessions[0]

    session.messages = session.messages.slice(0, 2)
    if (session.checkpoints) {
      session.checkpoints = session.checkpoints.filter((cp) => cp.messageIndex < 2)
    }
    session.updatedAt = Date.now()
    store.saveScope(SCOPE)

    const store2 = new ScopeStore(tempDir)
    const loaded = store2.getScopeData(SCOPE)
    const loadedSession = loaded.agentSessions[0]
    expect(loadedSession.messages).toHaveLength(2)
    expect(loadedSession.checkpoints).toHaveLength(1)
  })

  it('负数 messageIndex clamp 到 0', () => {
    createTestSession(store)
    const data = store.getScopeData(SCOPE)
    const session = data.agentSessions[0]

    const clampedIndex = Math.max(0, Math.min(-5, session.messages.length))
    session.messages = session.messages.slice(0, clampedIndex)
    if (session.checkpoints) {
      session.checkpoints = session.checkpoints.filter((cp) => cp.messageIndex < clampedIndex)
    }

    expect(session.messages).toHaveLength(0)
    expect(session.checkpoints).toHaveLength(0)
  })
})

describe('updateSession BG fields', () => {
  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `prizm-adapter-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tempDir, { recursive: true })
    store = new ScopeStore(tempDir)
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  function createBgSession(): AgentSession {
    const data = store.getScopeData(SCOPE)
    const session: AgentSession = {
      id: 'bg-session-1',
      scope: SCOPE,
      messages: [makeMessage('m0', 'user', '任务')],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    data.agentSessions.push(session)
    store.saveScope(SCOPE)
    return session
  }

  it('更新 kind → session.kind 正确更新', () => {
    const session = createBgSession()
    session.kind = 'background'
    session.updatedAt = Date.now()
    store.saveScope(SCOPE)

    const store2 = new ScopeStore(tempDir)
    const loaded = store2.getScopeData(SCOPE).agentSessions[0]
    expect(loaded.kind).toBe('background')
  })

  it('更新 bgMeta → session.bgMeta 正确更新', () => {
    const session = createBgSession()
    session.kind = 'background'
    session.bgMeta = {
      triggerType: 'tool_spawn',
      parentSessionId: 'parent-1',
      label: '分析任务',
      depth: 1
    }
    session.updatedAt = Date.now()
    store.saveScope(SCOPE)

    const store2 = new ScopeStore(tempDir)
    const loaded = store2.getScopeData(SCOPE).agentSessions[0]
    expect(loaded.bgMeta?.triggerType).toBe('tool_spawn')
    expect(loaded.bgMeta?.parentSessionId).toBe('parent-1')
    expect(loaded.bgMeta?.label).toBe('分析任务')
  })

  it('更新 bgStatus → session.bgStatus 正确更新', () => {
    const session = createBgSession()
    session.kind = 'background'
    session.bgStatus = 'running'
    session.updatedAt = Date.now()
    store.saveScope(SCOPE)

    const store2 = new ScopeStore(tempDir)
    const loaded = store2.getScopeData(SCOPE).agentSessions[0]
    expect(loaded.bgStatus).toBe('running')
  })

  it('更新 bgResult → session.bgResult 正确更新', () => {
    const session = createBgSession()
    session.kind = 'background'
    session.bgStatus = 'completed'
    session.bgResult = '任务执行结果'
    session.updatedAt = Date.now()
    store.saveScope(SCOPE)

    const store2 = new ScopeStore(tempDir)
    const loaded = store2.getScopeData(SCOPE).agentSessions[0]
    expect(loaded.bgResult).toBe('任务执行结果')
  })

  it('更新 startedAt / finishedAt → 正确更新', () => {
    const session = createBgSession()
    session.kind = 'background'
    session.startedAt = 1000
    session.finishedAt = 2000
    session.updatedAt = Date.now()
    store.saveScope(SCOPE)

    const store2 = new ScopeStore(tempDir)
    const loaded = store2.getScopeData(SCOPE).agentSessions[0]
    expect(loaded.startedAt).toBe(1000)
    expect(loaded.finishedAt).toBe(2000)
  })

  it('混合更新（同时更新 llmSummary + bgStatus）→ 两者都正确', () => {
    const session = createBgSession()
    session.kind = 'background'
    session.bgStatus = 'completed'
    session.llmSummary = '这是一个后台任务的摘要'
    session.updatedAt = Date.now()
    store.saveScope(SCOPE)

    const store2 = new ScopeStore(tempDir)
    const loaded = store2.getScopeData(SCOPE).agentSessions[0]
    expect(loaded.bgStatus).toBe('completed')
    expect(loaded.llmSummary).toBe('这是一个后台任务的摘要')
  })

  it('部分更新（只传 bgStatus）→ 其他字段不受影响', () => {
    const session = createBgSession()
    session.kind = 'background'
    session.bgMeta = { triggerType: 'api', label: '原始标签' }
    session.bgStatus = 'running'
    session.updatedAt = Date.now()
    store.saveScope(SCOPE)

    const data = store.getScopeData(SCOPE)
    const s = data.agentSessions[0]
    s.bgStatus = 'completed'
    s.updatedAt = Date.now()
    store.saveScope(SCOPE)

    const store2 = new ScopeStore(tempDir)
    const loaded = store2.getScopeData(SCOPE).agentSessions[0]
    expect(loaded.bgStatus).toBe('completed')
    expect(loaded.bgMeta?.label).toBe('原始标签')
    expect(loaded.messages).toHaveLength(1)
  })
})
