/**
 * Session 文件夹化 + 用户/scope 级记忆 DB 拆分 - 分层级功能完整测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import matter from 'gray-matter'
import {
  getSessionDir,
  getSessionFilePath,
  getSessionSummaryPath,
  getSessionTokenUsagePath,
  getSessionActivitiesPath,
  getSessionMemoriesPath,
  getScopeMemoryDir,
  getScopeMemoryDbPath,
  getScopeMemoryVecPath,
  getUserMemoryDbPath,
  getUserMemoryVecPath,
  getAgentSessionsDir
} from './PathProviderCore'
import {
  readAgentSessions,
  writeAgentSessions,
  readSessionSummary,
  writeSessionSummary,
  readSessionTokenUsage,
  writeSessionTokenUsage,
  appendSessionTokenUsage,
  readSessionActivities,
  appendSessionActivities,
  readSessionMemories,
  appendSessionMemories,
  deleteSessionDir
} from './mdStore'
import { ScopeStore, scopeStore } from './ScopeStore'
import { DefaultAgentAdapter } from '../adapters/default'
import { resetConfig } from '../config'

describe('PathProviderCore - 分层路径函数', () => {
  let tempDir: string
  let scopeRoot: string
  const sessionId = 'sess-abc-123'

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `prizm-path-${Date.now()}`)
    scopeRoot = path.join(tempDir, 'scopes', 'online')
    fs.mkdirSync(scopeRoot, { recursive: true })
    resetConfig()
    process.env.PRIZM_DATA_DIR = tempDir
  })

  afterEach(() => {
    resetConfig()
    delete process.env.PRIZM_DATA_DIR
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('getSessionDir 返回正确目录路径', () => {
    const dir = getSessionDir(scopeRoot, sessionId)
    expect(dir).toBe(path.join(scopeRoot, '.prizm', 'agent-sessions', 'sess-abc-123'))
  })

  it('sessionId 特殊字符被安全化', () => {
    const dir = getSessionDir(scopeRoot, 'id/with:slash')
    const sessionPart = path.basename(dir)
    expect(sessionPart).toBe('id_with_slash')
  })

  it('getSessionFilePath/summary/token/activities/memories 路径正确', () => {
    expect(getSessionFilePath(scopeRoot, sessionId)).toContain('session.md')
    expect(getSessionSummaryPath(scopeRoot, sessionId)).toContain('summary.md')
    expect(getSessionTokenUsagePath(scopeRoot, sessionId)).toContain('token_usage.md')
    expect(getSessionActivitiesPath(scopeRoot, sessionId)).toContain('activities.json')
    expect(getSessionMemoriesPath(scopeRoot, sessionId)).toContain('memories.md')
  })

  it('getScopeMemoryDir/DbPath/VecPath 路径正确', () => {
    const memDir = getScopeMemoryDir(scopeRoot)
    expect(memDir).toBe(path.join(scopeRoot, '.prizm', 'memory'))
    expect(getScopeMemoryDbPath(scopeRoot)).toBe(path.join(memDir, 'scope.db'))
    expect(getScopeMemoryVecPath(scopeRoot)).toBe(path.join(memDir, 'scope_vec'))
  })

  it('getUserMemoryDbPath/VecPath 使用 dataDir', () => {
    const userDb = getUserMemoryDbPath()
    const userVec = getUserMemoryVecPath()
    expect(userDb).toContain(tempDir)
    expect(userDb).toContain('memory')
    expect(userDb).toContain('user.db')
    expect(userVec).toContain('user_vec')
  })
})

describe('mdStore - Session 文件夹读写', () => {
  let tempDir: string
  let scopeRoot: string

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `prizm-mdstore-${Date.now()}`)
    scopeRoot = path.join(tempDir, 'scopes', 'online')
    fs.mkdirSync(scopeRoot, { recursive: true })
    resetConfig()
    process.env.PRIZM_DATA_DIR = tempDir
  })

  afterEach(() => {
    resetConfig()
    delete process.env.PRIZM_DATA_DIR
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('writeAgentSessions 创建 session 目录和 session.md', () => {
    const sessions = [
      {
        id: 's1',
        title: '会话1',
        scope: 'online',
        messages: [],
        createdAt: 1000,
        updatedAt: 2000
      }
    ]
    writeAgentSessions(scopeRoot, sessions, 'online')

    const fp = getSessionFilePath(scopeRoot, 's1')
    expect(fs.existsSync(fp)).toBe(true)
    const parsed = matter(fs.readFileSync(fp, 'utf-8'))
    expect(parsed.data.id).toBe('s1')
    expect(parsed.data.title).toBe('会话1')
  })

  it('writeAgentSessions 写入 llmSummary 到 summary.md', () => {
    const sessions = [
      {
        id: 's2',
        title: '会话2',
        scope: 'online',
        messages: [],
        llmSummary: '用户询问天气',
        createdAt: 1000,
        updatedAt: 2000
      }
    ]
    writeAgentSessions(scopeRoot, sessions, 'online')

    const summary = readSessionSummary(scopeRoot, 's2')
    expect(summary).toBe('用户询问天气')
  })

  it('readAgentSessions 同时支持目录和旧平铺 .md', () => {
    const sessionsDir = getAgentSessionsDir(scopeRoot)
    fs.mkdirSync(sessionsDir, { recursive: true })

    const dirSess = path.join(sessionsDir, 'dir-session')
    fs.mkdirSync(dirSess, { recursive: true })
    fs.writeFileSync(
      path.join(dirSess, 'session.md'),
      matter.stringify('', {
        prizm_type: 'agent_session',
        id: 'dir-session',
        title: '目录会话',
        scope: 'online',
        messages: [],
        createdAt: 3000,
        updatedAt: 4000
      })
    )

    const flatPath = path.join(sessionsDir, 'flat-session.md')
    fs.writeFileSync(
      flatPath,
      matter.stringify('', {
        prizm_type: 'agent_session',
        id: 'flat-session',
        title: '平铺会话',
        scope: 'online',
        messages: [],
        createdAt: 1000,
        updatedAt: 2000
      })
    )

    const sessions = readAgentSessions(scopeRoot)
    expect(sessions).toHaveLength(2)
    const ids = sessions.map((s) => s.id).sort()
    expect(ids).toEqual(['dir-session', 'flat-session'])
  })

  it('readSessionSummary/writeSessionSummary 读写', () => {
    writeSessionSummary(scopeRoot, 'sid', '这是摘要')
    expect(readSessionSummary(scopeRoot, 'sid')).toBe('这是摘要')
    expect(readSessionSummary(scopeRoot, 'nonexistent')).toBeNull()
  })

  it('appendSessionTokenUsage 追加 token 记录', () => {
    appendSessionTokenUsage(scopeRoot, 'sid', {
      id: 'r1',
      usageScope: 'chat',
      timestamp: 1000,
      model: 'gpt-4',
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30
    })
    appendSessionTokenUsage(scopeRoot, 'sid', {
      id: 'r2',
      usageScope: 'chat',
      timestamp: 2000,
      model: 'gpt-4',
      inputTokens: 15,
      outputTokens: 25,
      totalTokens: 40
    })

    const records = readSessionTokenUsage(scopeRoot, 'sid')
    expect(records).toHaveLength(2)
    expect(records[0].inputTokens).toBe(10)
    expect(records[1].totalTokens).toBe(40)
  })

  it('appendSessionActivities 追加活动记录', () => {
    appendSessionActivities(scopeRoot, 'sid', [
      {
        toolName: 'prizm_read_note',
        action: 'read',
        itemKind: 'note',
        itemId: 'n1',
        timestamp: 1000
      }
    ])
    appendSessionActivities(scopeRoot, 'sid', [
      { toolName: 'prizm_create_note', action: 'create', itemKind: 'note', timestamp: 2000 }
    ])

    const activities = readSessionActivities(scopeRoot, 'sid')
    expect(activities).toHaveLength(2)
    expect(activities[0].toolName).toBe('prizm_read_note')
    expect(activities[1].action).toBe('create')
  })

  it('appendSessionMemories 追加记忆快照', () => {
    appendSessionMemories(scopeRoot, 'sid', '- 用户偏好深色主题')
    appendSessionMemories(scopeRoot, 'sid', '- 项目使用 TypeScript')

    const content = readSessionMemories(scopeRoot, 'sid')
    expect(content).toContain('深色主题')
    expect(content).toContain('TypeScript')
    expect(content).toContain('---')
  })

  it('writeAgentSessions 删除列表中已移除的 session 目录', () => {
    const sessions1 = [
      { id: 's1', title: 'A', scope: 'online', messages: [], createdAt: 1, updatedAt: 2 },
      { id: 's2', title: 'B', scope: 'online', messages: [], createdAt: 1, updatedAt: 2 }
    ]
    writeAgentSessions(scopeRoot, sessions1, 'online')
    expect(fs.existsSync(getSessionDir(scopeRoot, 's1'))).toBe(true)
    expect(fs.existsSync(getSessionDir(scopeRoot, 's2'))).toBe(true)

    writeAgentSessions(scopeRoot, [sessions1[0]], 'online')
    expect(fs.existsSync(getSessionDir(scopeRoot, 's1'))).toBe(true)
    expect(fs.existsSync(getSessionDir(scopeRoot, 's2'))).toBe(false)
  })

  it('deleteSessionDir 删除整个 session 目录', () => {
    writeSessionSummary(scopeRoot, 'to-delete', 'x')
    const dir = getSessionDir(scopeRoot, 'to-delete')
    expect(fs.existsSync(dir)).toBe(true)

    deleteSessionDir(scopeRoot, 'to-delete')
    expect(fs.existsSync(dir)).toBe(false)
  })
})

describe('DefaultAgentAdapter - deleteSession 删除目录与记忆', () => {
  let adapter: DefaultAgentAdapter
  let testScope: string

  beforeEach(() => {
    adapter = new DefaultAgentAdapter()
    testScope = `test-del-${Date.now()}`
  })

  afterEach(async () => {
    const list = await adapter.listSessions(testScope)
    for (const s of list) await adapter.deleteSession(testScope, s.id)
  })

  it('deleteSession 后 session 目录被删除', async () => {
    const session = await adapter.createSession(testScope)
    const root = scopeStore.getScopeRootPath(testScope)
    const sessionDir = path.join(root, '.prizm', 'agent-sessions', session.id)
    expect(fs.existsSync(sessionDir)).toBe(true)

    await adapter.deleteSession(testScope, session.id)
    expect(fs.existsSync(sessionDir)).toBe(false)
  })
})

describe('ScopeStore - deleteSessionDir', () => {
  let tempDir: string
  let store: ScopeStore

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `prizm-scope-${Date.now()}`)
    fs.mkdirSync(tempDir, { recursive: true })
    store = new ScopeStore(tempDir)
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('deleteSessionDir 删除 scope 下的 session 目录', () => {
    const scope = 'test-scope'
    const data = store.getScopeData(scope)
    data.agentSessions.push({
      id: 's1',
      title: 'T',
      scope,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    store.saveScope(scope)

    const rootPath = store.getScopeRootPath(scope)
    const sessionDir = path.join(rootPath, '.prizm', 'agent-sessions', 's1')
    expect(fs.existsSync(sessionDir)).toBe(true)

    store.deleteSessionDir(scope, 's1')
    expect(fs.existsSync(sessionDir)).toBe(false)
  })
})
