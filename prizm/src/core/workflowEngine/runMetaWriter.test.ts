/**
 * runMetaWriter.test.ts — 运行元数据文件读写
 *
 * 覆盖：
 * - writeRunMeta 基本写入（frontmatter + body）
 * - writeRunMeta 带 structuredData / artifacts / args
 * - writeRunMeta 目录自动创建
 * - writeRunMeta 多次写入同一 runId（覆盖更新）
 * - readRunMeta 正常读取
 * - readRunMeta 文件不存在 → null
 * - readRunMeta 无 frontmatter → null
 * - listRecentRuns 按修改时间排序
 * - listRecentRuns 空目录 → []
 * - listRecentRuns limit 限制
 * - listRecentRuns 目录不存在 → []
 * - 步骤输出截断（output > 500 字符）
 * - 步骤 error / skipped 处理
 * - 特殊字符 workflowName 清洗
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getWorkflowRunMetaDir } from '../PathProviderCore'
import { writeRunMeta, readRunMeta, listRecentRuns } from './runMetaWriter'
import type { RunMetaData } from './runMetaWriter'
import type { WorkflowStepResult } from '@prizm/shared'

let tmpDir: string

function makeScopeRoot(): string {
  const dir = path.join(tmpDir, `scope-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function makeRunMeta(overrides: Partial<RunMetaData> = {}): RunMetaData {
  return {
    runId: `run-${Date.now()}`,
    workflowName: 'test-workflow',
    scope: 'default',
    status: 'completed',
    stepResults: {},
    ...overrides
  }
}

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `runmeta-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('writeRunMeta', () => {
  it('应写入包含 YAML frontmatter 和 Markdown body 的文件', () => {
    const scopeRoot = makeScopeRoot()
    const data = makeRunMeta({
      runId: 'run-001',
      status: 'completed',
      startedAt: 1000000,
      finishedAt: 1005000
    })
    writeRunMeta(scopeRoot, data)

    const metaDir = path.join(scopeRoot, '.prizm', 'workflows', 'test-workflow', '.meta', 'runs')
    expect(fs.existsSync(metaDir)).toBe(true)

    const filePath = path.join(metaDir, 'run-001.md')
    expect(fs.existsSync(filePath)).toBe(true)

    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toContain('---')
    expect(content).toContain('runId: run-001')
    expect(content).toContain('status: completed')
    expect(content).toContain('# Run: test-workflow')
  })

  it('应写入步骤结果到 frontmatter 和 body', () => {
    const scopeRoot = makeScopeRoot()
    const results: Record<string, WorkflowStepResult> = {
      analyze: {
        stepId: 'analyze',
        status: 'completed',
        output: '分析结果内容',
        sessionId: 'sess-1',
        durationMs: 5000
      }
    }
    writeRunMeta(scopeRoot, makeRunMeta({ runId: 'run-002', stepResults: results }))

    const filePath = path.join(scopeRoot, '.prizm', 'workflows', 'test-workflow', '.meta', 'runs', 'run-002.md')
    const content = fs.readFileSync(filePath, 'utf-8')

    expect(content).toContain('analyze:')
    expect(content).toContain('status: completed')
    expect(content).toContain('sessionId: sess-1')
    expect(content).toContain('## Step: analyze')
    expect(content).toContain('分析结果内容')
  })

  it('应写入 structuredData 到 steps frontmatter', () => {
    const scopeRoot = makeScopeRoot()
    const results: Record<string, WorkflowStepResult> = {
      step1: {
        stepId: 'step1',
        status: 'completed',
        output: 'ok',
        structuredData: '{"sentiment":"positive","confidence":0.92}',
        durationMs: 100
      }
    }
    writeRunMeta(scopeRoot, makeRunMeta({ runId: 'run-sd', stepResults: results }))

    const filePath = path.join(scopeRoot, '.prizm', 'workflows', 'test-workflow', '.meta', 'runs', 'run-sd.md')
    const content = fs.readFileSync(filePath, 'utf-8')

    expect(content).toContain('data:')
    expect(content).toContain('sentiment: positive')
    expect(content).toContain('confidence: 0.92')
  })

  it('应写入 artifacts 列表', () => {
    const scopeRoot = makeScopeRoot()
    const results: Record<string, WorkflowStepResult> = {
      step1: {
        stepId: 'step1',
        status: 'completed',
        output: 'done',
        artifacts: ['reports/report.md', 'data/output.csv'],
        durationMs: 100
      }
    }
    writeRunMeta(scopeRoot, makeRunMeta({ runId: 'run-art', stepResults: results }))

    const filePath = path.join(scopeRoot, '.prizm', 'workflows', 'test-workflow', '.meta', 'runs', 'run-art.md')
    const content = fs.readFileSync(filePath, 'utf-8')

    expect(content).toContain('artifacts:')
    expect(content).toContain('- reports/report.md')
    expect(content).toContain('- data/output.csv')
  })

  it('应写入 args', () => {
    const scopeRoot = makeScopeRoot()
    writeRunMeta(scopeRoot, makeRunMeta({
      runId: 'run-args',
      args: { topic: 'AI', count: 10 }
    }))

    const filePath = path.join(scopeRoot, '.prizm', 'workflows', 'test-workflow', '.meta', 'runs', 'run-args.md')
    const content = fs.readFileSync(filePath, 'utf-8')

    expect(content).toContain('args:')
    expect(content).toContain('topic: AI')
    expect(content).toContain('count: 10')
  })

  it('目录不存在时应自动创建', () => {
    const scopeRoot = makeScopeRoot()
    writeRunMeta(scopeRoot, makeRunMeta({ runId: 'run-autocreate' }))

    const metaDir = path.join(scopeRoot, '.prizm', 'workflows', 'test-workflow', '.meta', 'runs')
    expect(fs.existsSync(metaDir)).toBe(true)
  })

  it('多次写入同一 runId 应覆盖更新', () => {
    const scopeRoot = makeScopeRoot()
    writeRunMeta(scopeRoot, makeRunMeta({ runId: 'run-dup', status: 'running' }))
    writeRunMeta(scopeRoot, makeRunMeta({ runId: 'run-dup', status: 'completed' }))

    const filePath = path.join(scopeRoot, '.prizm', 'workflows', 'test-workflow', '.meta', 'runs', 'run-dup.md')
    const content = fs.readFileSync(filePath, 'utf-8')

    expect(content).toContain('status: completed')
    expect(content).not.toContain('status: running')
  })

  it('步骤输出超过 500 字符应截断', () => {
    const scopeRoot = makeScopeRoot()
    const longOutput = 'A'.repeat(600)
    const results: Record<string, WorkflowStepResult> = {
      step1: { stepId: 'step1', status: 'completed', output: longOutput, durationMs: 100 }
    }
    writeRunMeta(scopeRoot, makeRunMeta({ runId: 'run-trunc', stepResults: results }))

    const filePath = path.join(scopeRoot, '.prizm', 'workflows', 'test-workflow', '.meta', 'runs', 'run-trunc.md')
    const content = fs.readFileSync(filePath, 'utf-8')

    expect(content).toContain('...')
    expect(content.length).toBeLessThan(longOutput.length + 500)
  })

  it('步骤 error 应写入错误信息', () => {
    const scopeRoot = makeScopeRoot()
    const results: Record<string, WorkflowStepResult> = {
      step1: { stepId: 'step1', status: 'failed', error: '网络超时', durationMs: 100 }
    }
    writeRunMeta(scopeRoot, makeRunMeta({ runId: 'run-err', stepResults: results }))

    const filePath = path.join(scopeRoot, '.prizm', 'workflows', 'test-workflow', '.meta', 'runs', 'run-err.md')
    const content = fs.readFileSync(filePath, 'utf-8')

    expect(content).toContain('error: 网络超时')
    expect(content).toContain('Error: 网络超时')
  })

  it('skipped 步骤应写入 (skipped)', () => {
    const scopeRoot = makeScopeRoot()
    const results: Record<string, WorkflowStepResult> = {
      step1: { stepId: 'step1', status: 'skipped', durationMs: 0 }
    }
    writeRunMeta(scopeRoot, makeRunMeta({ runId: 'run-skip', stepResults: results }))

    const filePath = path.join(scopeRoot, '.prizm', 'workflows', 'test-workflow', '.meta', 'runs', 'run-skip.md')
    const content = fs.readFileSync(filePath, 'utf-8')

    expect(content).toContain('(skipped)')
  })

  it('特殊字符 workflowName 应被清洗', () => {
    const scopeRoot = makeScopeRoot()
    const workflowName = 'my workflow/test<>name'
    writeRunMeta(scopeRoot, makeRunMeta({
      runId: 'run-special',
      workflowName
    }))

    const metaDir = getWorkflowRunMetaDir(scopeRoot, workflowName)
    expect(fs.existsSync(metaDir)).toBe(true)
  })
})

describe('readRunMeta', () => {
  it('应读取已写入的运行元数据', () => {
    const scopeRoot = makeScopeRoot()
    writeRunMeta(scopeRoot, makeRunMeta({
      runId: 'run-read',
      status: 'completed',
      startedAt: 1000,
      finishedAt: 2000,
      triggerType: 'cron'
    }))

    const data = readRunMeta(scopeRoot, 'test-workflow', 'run-read')
    expect(data).not.toBeNull()
    expect(data!.runId).toBe('run-read')
    expect(data!.status).toBe('completed')
    expect(data!.startedAt).toBe(1000)
    expect(data!.finishedAt).toBe(2000)
    expect(data!.triggerType).toBe('cron')
  })

  it('文件不存在时应返回 null', () => {
    const scopeRoot = makeScopeRoot()
    const data = readRunMeta(scopeRoot, 'test-workflow', 'nonexistent')
    expect(data).toBeNull()
  })

  it('无 frontmatter 的文件应返回 null', () => {
    const scopeRoot = makeScopeRoot()
    const metaDir = path.join(scopeRoot, '.prizm', 'workflows', 'test-workflow', '.meta', 'runs')
    fs.mkdirSync(metaDir, { recursive: true })
    fs.writeFileSync(path.join(metaDir, 'bad.md'), 'no frontmatter here', 'utf-8')

    const data = readRunMeta(scopeRoot, 'test-workflow', 'bad')
    expect(data).toBeNull()
  })

  it('无 runId 的 frontmatter 应返回 null', () => {
    const scopeRoot = makeScopeRoot()
    const metaDir = path.join(scopeRoot, '.prizm', 'workflows', 'test-workflow', '.meta', 'runs')
    fs.mkdirSync(metaDir, { recursive: true })
    fs.writeFileSync(path.join(metaDir, 'no-id.md'), '---\nstatus: ok\n---\nbody', 'utf-8')

    const data = readRunMeta(scopeRoot, 'test-workflow', 'no-id')
    expect(data).toBeNull()
  })
})

describe('listRecentRuns', () => {
  it('应按修改时间倒序列出运行', async () => {
    const scopeRoot = makeScopeRoot()

    writeRunMeta(scopeRoot, makeRunMeta({ runId: 'run-a', status: 'completed' }))
    await new Promise((r) => setTimeout(r, 50))
    writeRunMeta(scopeRoot, makeRunMeta({ runId: 'run-b', status: 'failed' }))
    await new Promise((r) => setTimeout(r, 50))
    writeRunMeta(scopeRoot, makeRunMeta({ runId: 'run-c', status: 'completed' }))

    const runs = listRecentRuns(scopeRoot, 'test-workflow', 10)
    expect(runs).toHaveLength(3)
    expect(runs[0].runId).toBe('run-c')
    expect(runs[1].runId).toBe('run-b')
    expect(runs[2].runId).toBe('run-a')
  })

  it('应受 limit 限制', async () => {
    const scopeRoot = makeScopeRoot()

    writeRunMeta(scopeRoot, makeRunMeta({ runId: 'run-1', status: 'completed' }))
    await new Promise((r) => setTimeout(r, 20))
    writeRunMeta(scopeRoot, makeRunMeta({ runId: 'run-2', status: 'completed' }))
    await new Promise((r) => setTimeout(r, 20))
    writeRunMeta(scopeRoot, makeRunMeta({ runId: 'run-3', status: 'completed' }))

    const runs = listRecentRuns(scopeRoot, 'test-workflow', 2)
    expect(runs).toHaveLength(2)
  })

  it('空目录应返回空数组', () => {
    const scopeRoot = makeScopeRoot()
    const metaDir = path.join(scopeRoot, '.prizm', 'workflows', 'test-workflow', '.meta', 'runs')
    fs.mkdirSync(metaDir, { recursive: true })

    const runs = listRecentRuns(scopeRoot, 'test-workflow')
    expect(runs).toEqual([])
  })

  it('目录不存在时应返回空数组', () => {
    const scopeRoot = makeScopeRoot()
    const runs = listRecentRuns(scopeRoot, 'nonexistent-workflow')
    expect(runs).toEqual([])
  })

  it('应包含 status 和时间戳信息', () => {
    const scopeRoot = makeScopeRoot()
    writeRunMeta(scopeRoot, makeRunMeta({
      runId: 'run-info',
      status: 'completed',
      startedAt: 1000,
      finishedAt: 2000,
      stepResults: {
        s1: { stepId: 's1', status: 'completed', durationMs: 100 },
        s2: { stepId: 's2', status: 'completed', durationMs: 200 }
      }
    }))

    const runs = listRecentRuns(scopeRoot, 'test-workflow')
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('completed')
    expect(runs[0].startedAt).toBe(1000)
    expect(runs[0].finishedAt).toBe(2000)
  })

  it('默认 limit 为 5', async () => {
    const scopeRoot = makeScopeRoot()

    for (let i = 0; i < 8; i++) {
      writeRunMeta(scopeRoot, makeRunMeta({ runId: `run-${i}`, status: 'completed' }))
      await new Promise((r) => setTimeout(r, 15))
    }

    const runs = listRecentRuns(scopeRoot, 'test-workflow')
    expect(runs).toHaveLength(5)
  })
})
