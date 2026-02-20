/**
 * workflowDefStore.test.ts — 文件系统工作流定义存储
 *
 * 覆盖：
 * - registerDef 创建 / 更新（upsert）
 * - getDefById / getDefByName
 * - listDefs（按 scope 过滤、排序）
 * - deleteDef
 * - scope 隔离
 * - description / triggers 自动提取
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'

const TEST_ROOT = path.join(os.tmpdir(), `wfdef-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)

vi.mock('../PathProviderCore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../PathProviderCore')>()
  return {
    ...actual,
    getDataDir: () => TEST_ROOT,
    ensureDataDir: () => fs.mkdirSync(TEST_ROOT, { recursive: true })
  }
})

vi.mock('../ScopeStore', () => {
  const scopeRoots = new Map<string, string>()

  function ensureScopeRoot(scope: string): string {
    if (!scopeRoots.has(scope)) {
      const root = path.join(TEST_ROOT, 'scopes', scope)
      fs.mkdirSync(root, { recursive: true })
      scopeRoots.set(scope, root)
    }
    return scopeRoots.get(scope)!
  }

  return {
    scopeStore: {
      getScopeRootPath: (scope: string) => ensureScopeRoot(scope),
      getAllScopes: () => [...scopeRoots.keys()]
    }
  }
})

import * as defStore from './workflowDefStore'

const SAMPLE_YAML = `name: test-workflow
description: 测试工作流
steps:
  - id: step1
    type: agent
    prompt: 做一些事情
triggers:
  - type: cron
    filter:
      name: daily
`

const SIMPLE_YAML = `name: simple
steps:
  - id: s1
    type: agent
    prompt: hello
`

beforeEach(() => {
  fs.mkdirSync(TEST_ROOT, { recursive: true })
})

afterEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true })
})

describe('workflowDefStore — registerDef', () => {
  it('应创建新定义并写入 workflow.yaml 和 def.json', () => {
    const def = defStore.registerDef('my-workflow', 'default', SAMPLE_YAML, '测试描述')
    expect(def.id).toBeTruthy()
    expect(def.name).toBe('my-workflow')
    expect(def.scope).toBe('default')
    expect(def.yamlContent).toBe(SAMPLE_YAML)
    expect(def.description).toBe('测试描述')
    expect(def.createdAt).toBeGreaterThan(0)
    expect(def.updatedAt).toBeGreaterThan(0)
  })

  it('同 name+scope 应更新而非新建（upsert）', () => {
    const def1 = defStore.registerDef('wf', 'default', SIMPLE_YAML)
    const def2 = defStore.registerDef('wf', 'default', SAMPLE_YAML, '更新后')
    expect(def2.id).toBe(def1.id)
    expect(def2.yamlContent).toBe(SAMPLE_YAML)
    expect(def2.description).toBe('更新后')
    expect(def2.updatedAt).toBeGreaterThanOrEqual(def1.updatedAt)
    expect(def2.createdAt).toBe(def1.createdAt)
  })

  it('应保存 triggersJson', () => {
    const triggers = JSON.stringify([{ type: 'cron', filter: { name: 'x' } }])
    const def = defStore.registerDef('wf', 'default', SIMPLE_YAML, undefined, triggers)
    expect(def.triggersJson).toBe(triggers)
  })
})

describe('workflowDefStore — getDefById', () => {
  it('应返回匹配的定义', () => {
    const def = defStore.registerDef('wf-by-id', 'default', SIMPLE_YAML)
    const loaded = defStore.getDefById(def.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe(def.id)
    expect(loaded!.name).toBe('wf-by-id')
  })

  it('不存在的 ID 应返回 null', () => {
    expect(defStore.getDefById('nonexistent-id')).toBeNull()
  })
})

describe('workflowDefStore — getDefByName', () => {
  it('应按 name+scope 精确匹配', () => {
    defStore.registerDef('alpha', 'default', SIMPLE_YAML)
    defStore.registerDef('beta', 'default', SAMPLE_YAML)

    const alpha = defStore.getDefByName('alpha', 'default')
    expect(alpha).not.toBeNull()
    expect(alpha!.yamlContent).toBe(SIMPLE_YAML)

    const beta = defStore.getDefByName('beta', 'default')
    expect(beta).not.toBeNull()
    expect(beta!.yamlContent).toBe(SAMPLE_YAML)
  })

  it('不存在的 name 应返回 null', () => {
    expect(defStore.getDefByName('nonexistent', 'default')).toBeNull()
  })

  it('不同 scope 的同名 def 互不干扰', () => {
    defStore.registerDef('shared-name', 'scope-a', SIMPLE_YAML)
    defStore.registerDef('shared-name', 'scope-b', SAMPLE_YAML)

    const a = defStore.getDefByName('shared-name', 'scope-a')
    expect(a!.yamlContent).toBe(SIMPLE_YAML)

    const b = defStore.getDefByName('shared-name', 'scope-b')
    expect(b!.yamlContent).toBe(SAMPLE_YAML)
  })
})

describe('workflowDefStore — listDefs', () => {
  it('按 scope 过滤', () => {
    defStore.registerDef('wf-a', 'scope-1', SIMPLE_YAML)
    defStore.registerDef('wf-b', 'scope-1', SAMPLE_YAML)
    defStore.registerDef('wf-c', 'scope-2', SIMPLE_YAML)

    expect(defStore.listDefs('scope-1')).toHaveLength(2)
    expect(defStore.listDefs('scope-2')).toHaveLength(1)
  })

  it('无 scope 参数应列出所有', () => {
    defStore.registerDef('wf-x', 'scope-a', SIMPLE_YAML)
    defStore.registerDef('wf-y', 'scope-b', SIMPLE_YAML)

    const all = defStore.listDefs()
    expect(all.length).toBeGreaterThanOrEqual(2)
  })

  it('应按 updatedAt 降序排列', () => {
    defStore.registerDef('first', 'default', SIMPLE_YAML)
    defStore.registerDef('second', 'default', SAMPLE_YAML)

    const defs = defStore.listDefs('default')
    expect(defs[0].updatedAt).toBeGreaterThanOrEqual(defs[1].updatedAt)
  })
})

describe('workflowDefStore — deleteDef', () => {
  it('应删除定义（workflow.yaml + def.json）', () => {
    const def = defStore.registerDef('to-delete', 'default', SIMPLE_YAML)
    expect(defStore.deleteDef(def.id)).toBe(true)
    expect(defStore.getDefById(def.id)).toBeNull()
    expect(defStore.getDefByName('to-delete', 'default')).toBeNull()
  })

  it('删除不存在的 ID 应返回 false', () => {
    expect(defStore.deleteDef('nonexistent-id')).toBe(false)
  })
})

describe('workflowDefStore — description / triggers 自动提取', () => {
  it('应从 YAML 中提取 description', () => {
    const def = defStore.registerDef('auto-desc', 'default', SAMPLE_YAML)
    const loaded = defStore.getDefByName('auto-desc', 'default')
    expect(loaded!.description).toBe('测试工作流')
  })

  it('应从 YAML 中提取 triggers', () => {
    const loaded = defStore.registerDef('auto-trigger', 'default', SAMPLE_YAML)
    expect(loaded.triggersJson).toBeTruthy()
    const triggers = JSON.parse(loaded.triggersJson!)
    expect(triggers[0].type).toBe('cron')
  })

  it('无 description 时应返回 undefined', () => {
    const def = defStore.registerDef('no-desc', 'default', SIMPLE_YAML)
    const loaded = defStore.getDefByName('no-desc', 'default')
    expect(loaded!.description).toBeUndefined()
  })
})
