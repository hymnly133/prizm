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
    expect(data.todoLists).toEqual([])
    expect(data.clipboard).toEqual([])
    expect(data.documents).toEqual([])
    expect(data.agentSessions).toEqual([])
  })

  it('getScopeData 新建 scope 并持久化', () => {
    const data = store.getScopeData('test-scope')
    data.documents.push({
      id: '1',
      title: 'hello',
      content: 'hello',
      relativePath: 'hello.md',
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    store.saveScope('test-scope')

    const scopeRoot = path.join(tempDir, 'scopes', 'test-scope')
    const docPath = path.join(scopeRoot, 'hello.md')
    expect(fs.existsSync(docPath)).toBe(true)
    const content = fs.readFileSync(docPath, 'utf-8')
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

  it('scope 名特殊字符可创建嵌套目录', () => {
    store.getScopeData('foo/bar')
    store.saveScope('foo/bar')
    const scopePath = path.join(tempDir, 'scopes', 'foo', 'bar')
    expect(fs.existsSync(scopePath)).toBe(true)
    expect(fs.existsSync(path.join(scopePath, '.prizm', 'scope.json'))).toBe(true)
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

  it('从 prizm_type 用户文件加载便签 (V3 迁移 note->document)', () => {
    const scopesDir = path.join(tempDir, 'scopes')
    const scopeDir = path.join(scopesDir, 'file-scope')
    const prizmDir = path.join(scopeDir, '.prizm')
    fs.mkdirSync(prizmDir, { recursive: true })
    fs.writeFileSync(
      path.join(prizmDir, 'scope.json'),
      JSON.stringify({ id: 'file-scope', label: 'File Scope', settings: {} }),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(scopeDir, 'n1.md'),
      '---\nprizm_type: note\nid: n1\ncreatedAt: 1\nupdatedAt: 1\n---\nmigrated',
      'utf-8'
    )
    const scopeRegistryPath = path.join(tempDir, 'scope-registry.json')
    const fileScopePath = path.resolve(tempDir, 'scopes', 'file-scope')
    fs.writeFileSync(
      scopeRegistryPath,
      JSON.stringify({
        version: 1,
        scopes: {
          default: {
            path: 'scopes/default',
            label: '默认',
            builtin: true,
            createdAt: 1
          },
          'file-scope': {
            path: fileScopePath,
            label: 'File Scope',
            builtin: false,
            createdAt: 1
          }
        }
      }),
      'utf-8'
    )
    const store2 = new ScopeStore(tempDir)
    const data = store2.getScopeData('file-scope')
    expect(data.documents).toHaveLength(1)
    expect(data.documents[0].content).toBe('migrated')
    expect(data.documents[0].id).toBe('n1')
    expect(data.documents[0].title).toBe('migrated')
    expect(fs.existsSync(path.join(scopeDir, 'n1.md'))).toBe(false)
    expect(fs.existsSync(path.join(scopeDir, 'migrated.md'))).toBe(true)
  })
})
