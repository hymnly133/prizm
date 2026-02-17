/**
 * migrate-scope-v2 迁移脚本测试：session 文件夹化 + 记忆 DB 拆分
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import matter from 'gray-matter'
import Database from 'better-sqlite3'
import { runMigration } from './migrate-scope-v2'
import { readAgentSessions } from './mdStore'
import { getSessionDir, getSessionFilePath, getSessionSummaryPath } from './PathProviderCore'
import { resetConfig } from '../config'

describe('migrate-scope-v2', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `prizm-migrate-${Date.now()}`)
    fs.mkdirSync(tempDir, { recursive: true })
    resetConfig()
    process.env.PRIZM_DATA_DIR = tempDir
  })

  afterEach(() => {
    resetConfig()
    delete process.env.PRIZM_DATA_DIR
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('migrateSessionsToFolders: 平铺 .md 转为目录结构', () => {
    const scopesDir = path.join(tempDir, 'scopes')
    const scopeDir = path.join(scopesDir, 'online')
    const prizmDir = path.join(scopeDir, '.prizm')
    const sessionsDir = path.join(prizmDir, 'agent-sessions')
    fs.mkdirSync(sessionsDir, { recursive: true })

    fs.writeFileSync(path.join(prizmDir, 'scope.json'), '{"id":"online"}')
    const flatPath = path.join(sessionsDir, 'sess-flat-1.md')
    fs.writeFileSync(
      flatPath,
      matter.stringify('', {
        prizm_type: 'agent_session',
        id: 'sess-flat-1',
        title: '平铺会话',
        scope: 'online',
        messages: [],
        llmSummary: '摘要内容',
        createdAt: 1000,
        updatedAt: 2000
      })
    )

    runMigration(tempDir)

    expect(fs.existsSync(flatPath)).toBe(false)
    const sessionDir = getSessionDir(scopeDir, 'sess-flat-1')
    expect(fs.existsSync(sessionDir)).toBe(true)
    expect(fs.existsSync(getSessionFilePath(scopeDir, 'sess-flat-1'))).toBe(true)
    const summary = matter(fs.readFileSync(getSessionSummaryPath(scopeDir, 'sess-flat-1'), 'utf-8'))
    expect(summary.content.trim()).toBe('摘要内容')

    const sessions = readAgentSessions(scopeDir)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('sess-flat-1')
    expect(sessions[0].llmSummary).toBe('摘要内容')
  })

  it('migrateGlobalMemoryToLevels: 拆分 evermemos.db 到 user.db 和 scope.db', () => {
    const sourceDb = path.join(tempDir, 'evermemos.db')

    const db = new Database(sourceDb)
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT,
        user_id TEXT,
        group_id TEXT,
        created_at TEXT,
        updated_at TEXT,
        metadata TEXT
      )
    `)
    const insert = db.prepare(
      'INSERT INTO memories (id, type, content, user_id, group_id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    insert.run('p1', 'profile', '用户偏好', 'u1', null, '2024-01-01', '2024-01-01', '{}')
    insert.run(
      'e1',
      'episodic_memory',
      'scope 叙事',
      'u1',
      'online',
      '2024-01-01',
      '2024-01-01',
      '{}'
    )
    insert.run(
      'ev1',
      'event_log',
      'session 事件',
      'u1',
      'online:session:s1',
      '2024-01-01',
      '2024-01-01',
      '{}'
    )
    db.close()

    const scopesDir = path.join(tempDir, 'scopes')
    const onlineDir = path.join(scopesDir, 'online')
    fs.mkdirSync(onlineDir, { recursive: true })
    fs.mkdirSync(path.join(onlineDir, '.prizm'), { recursive: true })
    fs.writeFileSync(path.join(onlineDir, '.prizm', 'scope.json'), '{}')

    runMigration(tempDir)

    const userDbPath = path.join(tempDir, 'memory', 'user.db')
    expect(fs.existsSync(userDbPath)).toBe(true)
    const userDb = new Database(userDbPath, { readonly: true })
    const profileRows = userDb.prepare("SELECT * FROM memories WHERE group_id = 'user'").all()
    userDb.close()
    expect(profileRows).toHaveLength(1)
    expect((profileRows[0] as { content: string }).content).toBe('用户偏好')

    const scopeDbPath = path.join(onlineDir, '.prizm', 'memory', 'scope.db')
    expect(fs.existsSync(scopeDbPath)).toBe(true)
    const scopeDb = new Database(scopeDbPath, { readonly: true })
    const scopeRows = scopeDb.prepare('SELECT * FROM memories').all()
    scopeDb.close()
    expect(scopeRows).toHaveLength(2)
    const types = (scopeRows as { type: string }[]).map((r) => r.type)
    expect(types).toContain('episodic_memory')
    expect(types).toContain('event_log')
  })
})
