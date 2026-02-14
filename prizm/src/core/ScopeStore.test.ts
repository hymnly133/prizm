import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { ScopeStore, DEFAULT_SCOPE } from './ScopeStore'

describe('ScopeStore', () => {
  let tempDir: string
  let store: ScopeStore

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `prizm-test-${Date.now()}`)
    fs.mkdirSync(tempDir, { recursive: true })
    store = new ScopeStore(tempDir)
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('getScopeData 返回空数据', () => {
    const data = store.getScopeData('default')
    expect(data.notes).toEqual([])
    expect(data.groups).toEqual([])
    expect(data.todoLists).toEqual([])
    expect(data.pomodoroSessions).toEqual([])
    expect(data.clipboard).toEqual([])
    expect(data.documents).toEqual([])
    expect(data.agentSessions).toEqual([])
  })

  it('getScopeData 新建 scope 并持久化', () => {
    const data = store.getScopeData('test-scope')
    data.notes.push({
      id: '1',
      content: 'hello',
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    store.saveScope('test-scope')

    const notesPath = path.join(tempDir, 'scopes', 'test-scope', 'notes', '1.md')
    expect(fs.existsSync(notesPath)).toBe(true)
    const content = fs.readFileSync(notesPath, 'utf-8')
    expect(content).toContain('hello')
    expect(content).toContain('---')
  })

  it('ensureScope 等同于 getScopeData', () => {
    const data = store.ensureScope('demo')
    expect(data).toBeDefined()
    expect(store.getScopeData('demo')).toBe(data)
  })

  it('getAllScopes 包含 default', () => {
    const scopes = store.getAllScopes()
    expect(scopes).toContain(DEFAULT_SCOPE)
  })

  it('scope 名特殊字符被替换', () => {
    store.getScopeData('foo/bar')
    store.saveScope('foo/bar')
    const scopesDir = path.join(tempDir, 'scopes')
    const entries = fs.readdirSync(scopesDir)
    expect(entries.some((e) => e.includes('foo') && e.includes('bar'))).toBe(true)
  })

  it('agentSessions 持久化与加载', () => {
    const data = store.getScopeData('agent-scope')
    data.agentSessions.push({
      id: 's1',
      title: '测试会话',
      scope: 'agent-scope',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'hello',
          createdAt: Date.now()
        }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    store.saveScope('agent-scope')

    const store2 = new ScopeStore(tempDir)
    const loaded = store2.getScopeData('agent-scope')
    expect(loaded.agentSessions).toHaveLength(1)
    expect(loaded.agentSessions[0].id).toBe('s1')
    expect(loaded.agentSessions[0].messages).toHaveLength(1)
  })

  it('从旧版 JSON 迁移到 MD 单文件', () => {
    const scopesDir = path.join(tempDir, 'scopes')
    fs.mkdirSync(scopesDir, { recursive: true })
    const legacyFile = path.join(scopesDir, 'migrate-scope.json')
    fs.writeFileSync(
      legacyFile,
      JSON.stringify({
        notes: [{ id: 'n1', content: 'migrated', createdAt: 1, updatedAt: 1 }],
        groups: [],
        todoList: null,
        pomodoroSessions: [],
        clipboard: [],
        documents: [],
        agentSessions: []
      }),
      'utf-8'
    )

    const store2 = new ScopeStore(tempDir)
    const data = store2.getScopeData('migrate-scope')
    expect(data.notes).toHaveLength(1)
    expect(data.notes[0].content).toBe('migrated')
    expect(fs.existsSync(legacyFile)).toBe(false)
    const mdPath = path.join(scopesDir, 'migrate-scope', 'notes', 'n1.md')
    expect(fs.existsSync(mdPath)).toBe(true)
    expect(fs.readFileSync(mdPath, 'utf-8')).toContain('migrated')
  })

  it('从 JSON 目录格式迁移到 MD', () => {
    const scopesDir = path.join(tempDir, 'scopes')
    const scopeDir = path.join(scopesDir, 'json-dir-scope')
    fs.mkdirSync(scopeDir, { recursive: true })
    fs.writeFileSync(
      path.join(scopeDir, 'notes.json'),
      JSON.stringify([{ id: 'j1', content: 'from json dir', createdAt: 1, updatedAt: 1 }]),
      'utf-8'
    )
    fs.writeFileSync(path.join(scopeDir, 'groups.json'), '[]', 'utf-8')
    fs.writeFileSync(path.join(scopeDir, 'todoList.json'), 'null', 'utf-8')
    fs.writeFileSync(path.join(scopeDir, 'pomodoroSessions.json'), '[]', 'utf-8')
    fs.writeFileSync(path.join(scopeDir, 'clipboard.json'), '[]', 'utf-8')
    fs.writeFileSync(path.join(scopeDir, 'documents.json'), '[]', 'utf-8')
    fs.writeFileSync(path.join(scopeDir, 'agentSessions.json'), '[]', 'utf-8')

    const store2 = new ScopeStore(tempDir)
    const data = store2.getScopeData('json-dir-scope')
    expect(data.notes).toHaveLength(1)
    expect(data.notes[0].content).toBe('from json dir')
    expect(fs.existsSync(path.join(scopeDir, 'notes.json'))).toBe(false)
    expect(fs.existsSync(path.join(scopeDir, 'notes', 'j1.md'))).toBe(true)
  })
})
