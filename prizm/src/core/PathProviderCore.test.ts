/**
 * PathProviderCore.test.ts — workflow 级路径函数
 *
 * 覆盖：
 * - getWorkflowsDir / getWorkflowWorkspaceDir / getWorkflowRunMetaDir / getWorkflowRunMetaPath
 * - ensureWorkflowWorkspace（目录创建 + 幂等性）
 * - workflowName 特殊字符清洗
 * - runId 特殊字符清洗
 * - 路径分隔符和结构正确性
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  getWorkflowsDir,
  getWorkflowWorkspaceDir,
  getWorkflowRunMetaDir,
  getWorkflowRunMetaPath,
  ensureWorkflowWorkspace,
  getWorkflowPersistentWorkspace,
  getWorkflowRunWorkspacesDir,
  getWorkflowRunWorkspace,
  ensureRunWorkspace,
  getSessionDir,
  getSessionWorkspaceDir,
  getAgentSessionsDir,
  getPrizmDir,
  workflowDirName
} from './PathProviderCore'

let tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `ppc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  fs.mkdirSync(dir, { recursive: true })
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const d of tmpDirs) {
    fs.rmSync(d, { recursive: true, force: true })
  }
  tmpDirs = []
})

describe('getWorkflowsDir', () => {
  it('应返回 {scopeRoot}/.prizm/workflows/', () => {
    const scopeRoot = '/fake/scope'
    const result = getWorkflowsDir(scopeRoot)
    expect(result).toBe(path.join('/fake/scope', '.prizm', 'workflows'))
  })

  it('不同 scopeRoot 应返回不同路径', () => {
    const a = getWorkflowsDir('/root/a')
    const b = getWorkflowsDir('/root/b')
    expect(a).not.toBe(b)
  })
})

describe('workflowDirName', () => {
  it('纯 ASCII 名称原样返回', () => {
    expect(workflowDirName('daily-report')).toBe('daily-report')
    expect(workflowDirName('test_flow-v2')).toBe('test_flow-v2')
  })

  it('中文名称使用 hash，不同名称不碰撞', () => {
    const a = workflowDirName('串行演示工作流')
    const b = workflowDirName('并行演示工作流')
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[a-f0-9]{12}$/)
    expect(b).toMatch(/^[a-f0-9]{12}$/)
  })

  it('相同名称始终返回相同结果（确定性）', () => {
    expect(workflowDirName('日报生成')).toBe(workflowDirName('日报生成'))
  })

  it('混合名称保留 ASCII 前缀 + hash', () => {
    const result = workflowDirName('test-串行')
    expect(result).toMatch(/^test--[a-f0-9]{12}$/)
  })

  it('空字符串返回 hash', () => {
    const result = workflowDirName('')
    expect(result).toMatch(/^[a-f0-9]{12}$/)
  })

  it('路径不安全字符不出现在结果中', () => {
    const result = workflowDirName('my workflow/test<>name')
    expect(result).not.toContain('/')
    expect(result).not.toContain('<')
    expect(result).not.toContain('>')
    expect(result).not.toContain(' ')
  })
})

describe('getWorkflowWorkspaceDir', () => {
  it('纯 ASCII 名称直接用作目录名', () => {
    const result = getWorkflowWorkspaceDir('/fake/scope', 'daily-report')
    expect(result).toBe(path.join('/fake/scope', '.prizm', 'workflows', 'daily-report'))
  })

  it('中文名称使用 hash 作为目录名', () => {
    const result = getWorkflowWorkspaceDir('/fake/scope', '日报生成')
    const dirName = workflowDirName('日报生成')
    expect(result).toBe(path.join('/fake/scope', '.prizm', 'workflows', dirName))
    expect(result).not.toContain('____')
  })

  it('不同中文名称映射到不同目录（无碰撞）', () => {
    const a = getWorkflowWorkspaceDir('/fake/scope', '串行演示')
    const b = getWorkflowWorkspaceDir('/fake/scope', '并行演示')
    expect(a).not.toBe(b)
  })
})

describe('getWorkflowRunMetaDir', () => {
  it('应返回 {workflowWorkspace}/.meta/runs/', () => {
    const result = getWorkflowRunMetaDir('/fake/scope', 'test-wf')
    expect(result).toBe(path.join('/fake/scope', '.prizm', 'workflows', 'test-wf', '.meta', 'runs'))
  })
})

describe('getWorkflowRunMetaPath', () => {
  it('应返回 {metaDir}/{runId}.md', () => {
    const result = getWorkflowRunMetaPath('/fake/scope', 'test-wf', 'run-001')
    expect(result).toBe(
      path.join('/fake/scope', '.prizm', 'workflows', 'test-wf', '.meta', 'runs', 'run-001.md')
    )
  })

  it('应清洗 runId 中的非法字符', () => {
    const result = getWorkflowRunMetaPath('/fake/scope', 'test-wf', 'run/with<bad>chars')
    expect(result).toContain('run_with_bad_chars.md')
  })

  it('空 runId 应回退为 unknown', () => {
    const result = getWorkflowRunMetaPath('/fake/scope', 'test-wf', '')
    expect(result).toContain('unknown.md')
  })
})

describe('ensureWorkflowWorkspace', () => {
  it('应创建 workflow 工作区、workspace/ 和 .meta/runs 目录', () => {
    const scopeRoot = makeTmpDir()
    const wsDir = ensureWorkflowWorkspace(scopeRoot, 'test-wf')

    expect(fs.existsSync(wsDir)).toBe(true)
    const persistentDir = path.join(wsDir, 'workspace')
    expect(fs.existsSync(persistentDir)).toBe(true)
    const runsDir = path.join(wsDir, '.meta', 'runs')
    expect(fs.existsSync(runsDir)).toBe(true)
  })

  it('应返回 workflow 工作区路径', () => {
    const scopeRoot = makeTmpDir()
    const wsDir = ensureWorkflowWorkspace(scopeRoot, 'my-flow')
    expect(wsDir).toBe(getWorkflowWorkspaceDir(scopeRoot, 'my-flow'))
  })

  it('多次调用应幂等', () => {
    const scopeRoot = makeTmpDir()
    ensureWorkflowWorkspace(scopeRoot, 'test-wf')
    ensureWorkflowWorkspace(scopeRoot, 'test-wf')

    const runsDir = path.join(getWorkflowWorkspaceDir(scopeRoot, 'test-wf'), '.meta', 'runs')
    expect(fs.existsSync(runsDir)).toBe(true)
  })

  it('已存在文件时不应报错', () => {
    const scopeRoot = makeTmpDir()
    const wsDir = ensureWorkflowWorkspace(scopeRoot, 'test-wf')

    fs.writeFileSync(path.join(wsDir, 'data.txt'), 'hello')

    const wsDir2 = ensureWorkflowWorkspace(scopeRoot, 'test-wf')
    expect(wsDir2).toBe(wsDir)
    expect(fs.existsSync(path.join(wsDir, 'data.txt'))).toBe(true)
  })

  it('不同 workflowName 应创建不同目录', () => {
    const scopeRoot = makeTmpDir()
    const a = ensureWorkflowWorkspace(scopeRoot, 'flow-a')
    const b = ensureWorkflowWorkspace(scopeRoot, 'flow-b')

    expect(a).not.toBe(b)
    expect(fs.existsSync(a)).toBe(true)
    expect(fs.existsSync(b)).toBe(true)
  })
})

describe('getWorkflowPersistentWorkspace', () => {
  it('应返回 {workflowWorkspace}/workspace/', () => {
    const result = getWorkflowPersistentWorkspace('/fake/scope', 'daily-report')
    expect(result).toBe(
      path.join('/fake/scope', '.prizm', 'workflows', 'daily-report', 'workspace')
    )
  })
})

describe('getWorkflowRunWorkspacesDir', () => {
  it('应返回 {workflowWorkspace}/run-workspaces/', () => {
    const result = getWorkflowRunWorkspacesDir('/fake/scope', 'daily-report')
    expect(result).toBe(
      path.join('/fake/scope', '.prizm', 'workflows', 'daily-report', 'run-workspaces')
    )
  })
})

describe('getWorkflowRunWorkspace', () => {
  it('应返回 {workflowWorkspace}/run-workspaces/{runId}/', () => {
    const result = getWorkflowRunWorkspace('/fake/scope', 'daily-report', 'run-001')
    expect(result).toBe(
      path.join('/fake/scope', '.prizm', 'workflows', 'daily-report', 'run-workspaces', 'run-001')
    )
  })

  it('应清洗 runId 中的非法字符', () => {
    const result = getWorkflowRunWorkspace('/fake/scope', 'test-wf', 'run/bad<id')
    expect(result).toContain('run_bad_id')
    expect(result).not.toContain('/')
    expect(result).not.toContain('<')
  })

  it('空 runId 应回退为 unknown', () => {
    const result = getWorkflowRunWorkspace('/fake/scope', 'test-wf', '')
    expect(result).toContain('unknown')
  })
})

describe('ensureRunWorkspace', () => {
  it('应创建持久工作空间和 run 工作空间目录', () => {
    const scopeRoot = makeTmpDir()
    ensureWorkflowWorkspace(scopeRoot, 'test-wf')
    const { persistentDir, runDir } = ensureRunWorkspace(scopeRoot, 'test-wf', 'run-001')

    expect(fs.existsSync(persistentDir)).toBe(true)
    expect(fs.existsSync(runDir)).toBe(true)
  })

  it('持久空间应在 workspace/ 子目录下', () => {
    const scopeRoot = makeTmpDir()
    ensureWorkflowWorkspace(scopeRoot, 'test-wf')
    const { persistentDir } = ensureRunWorkspace(scopeRoot, 'test-wf', 'run-001')
    expect(persistentDir).toBe(getWorkflowPersistentWorkspace(scopeRoot, 'test-wf'))
  })

  it('run 空间应在 run-workspaces/{runId}/ 下', () => {
    const scopeRoot = makeTmpDir()
    ensureWorkflowWorkspace(scopeRoot, 'test-wf')
    const { runDir } = ensureRunWorkspace(scopeRoot, 'test-wf', 'run-001')
    expect(runDir).toBe(getWorkflowRunWorkspace(scopeRoot, 'test-wf', 'run-001'))
  })

  it('多次调用应幂等', () => {
    const scopeRoot = makeTmpDir()
    ensureWorkflowWorkspace(scopeRoot, 'test-wf')

    const first = ensureRunWorkspace(scopeRoot, 'test-wf', 'run-001')
    fs.writeFileSync(path.join(first.runDir, 'data.txt'), 'hello')

    const second = ensureRunWorkspace(scopeRoot, 'test-wf', 'run-001')
    expect(second.persistentDir).toBe(first.persistentDir)
    expect(second.runDir).toBe(first.runDir)
    expect(fs.existsSync(path.join(first.runDir, 'data.txt'))).toBe(true)
  })

  it('不同 runId 应创建不同的 run 空间，共享持久空间', () => {
    const scopeRoot = makeTmpDir()
    ensureWorkflowWorkspace(scopeRoot, 'test-wf')

    const a = ensureRunWorkspace(scopeRoot, 'test-wf', 'run-a')
    const b = ensureRunWorkspace(scopeRoot, 'test-wf', 'run-b')

    expect(a.persistentDir).toBe(b.persistentDir)
    expect(a.runDir).not.toBe(b.runDir)
    expect(fs.existsSync(a.runDir)).toBe(true)
    expect(fs.existsSync(b.runDir)).toBe(true)
  })
})

describe('session 路径函数（回归测试）', () => {
  it('getAgentSessionsDir 应返回正确路径', () => {
    const result = getAgentSessionsDir('/scope')
    expect(result).toBe(path.join('/scope', '.prizm', 'agent-sessions'))
  })

  it('getSessionDir 应清洗 sessionId', () => {
    const result = getSessionDir('/scope', 'sess/bad<id')
    expect(result).toContain('sess_bad_id')
  })

  it('getSessionWorkspaceDir 应返回 workspace 子目录', () => {
    const result = getSessionWorkspaceDir('/scope', 'sess-1')
    expect(result).toBe(path.join('/scope', '.prizm', 'agent-sessions', 'sess-1', 'workspace'))
  })

  it('getPrizmDir 应返回 .prizm 目录', () => {
    expect(getPrizmDir('/root')).toBe(path.join('/root', '.prizm'))
  })
})
