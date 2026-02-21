/**
 * Workflow Run Meta Writer
 *
 * 将运行元数据写为 .meta/runs/{runId}.md（YAML frontmatter + Markdown body），
 * 供 Agent 在工作区内直接读取历史、人类可读的运行日志。
 */

import fs from 'fs'
import path from 'path'
import {
  getWorkflowRunMetaDir,
  getWorkflowRunMetaPath
} from '../PathProviderCore'
import { createLogger } from '../../logger'
import type { WorkflowStepResult } from '@prizm/shared'

const log = createLogger('RunMetaWriter')

export interface RunMetaData {
  runId: string
  workflowName: string
  scope: string
  status: string
  triggerType?: string
  args?: Record<string, unknown>
  startedAt?: number
  finishedAt?: number
  /** Run 级错误详情/堆栈 */
  errorDetail?: string
  stepResults: Record<string, WorkflowStepResult>
}

/**
 * 将运行元数据写为 .meta/runs/{runId}.md
 * 包含 YAML frontmatter（结构化元数据）和 Markdown body（步骤输出摘要）
 */
export function writeRunMeta(scopeRoot: string, data: RunMetaData): void {
  try {
    const metaDir = getWorkflowRunMetaDir(scopeRoot, data.workflowName)
    if (!fs.existsSync(metaDir)) {
      fs.mkdirSync(metaDir, { recursive: true })
    }

    const filePath = getWorkflowRunMetaPath(scopeRoot, data.workflowName, data.runId)
    const content = buildRunMetaContent(data)
    fs.writeFileSync(filePath, content, 'utf-8')
  } catch (err) {
    log.warn('Failed to write run meta:', data.runId, err)
  }
}

/**
 * 从 .meta/runs/{runId}.md 读取运行元数据
 */
export function readRunMeta(scopeRoot: string, workflowName: string, runId: string): RunMetaData | null {
  try {
    const filePath = getWorkflowRunMetaPath(scopeRoot, workflowName, runId)
    if (!fs.existsSync(filePath)) return null

    const raw = fs.readFileSync(filePath, 'utf-8')
    return parseRunMeta(raw, workflowName)
  } catch (err) {
    log.warn('Failed to read run meta:', runId, err)
    return null
  }
}

/**
 * 列出最近 N 次运行的摘要（按文件修改时间倒序）
 */
export function listRecentRuns(scopeRoot: string, workflowName: string, limit = 5): RunMetaSummary[] {
  try {
    const metaDir = getWorkflowRunMetaDir(scopeRoot, workflowName)
    if (!fs.existsSync(metaDir)) return []

    const files = fs.readdirSync(metaDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({
        name: f,
        fullPath: path.join(metaDir, f),
        mtime: fs.statSync(path.join(metaDir, f)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)

    return files.map((f) => {
      const raw = fs.readFileSync(f.fullPath, 'utf-8')
      return extractSummary(raw, f.name.replace(/\.md$/, ''))
    }).filter((s): s is RunMetaSummary => s !== null)
  } catch (err) {
    log.warn('Failed to list recent runs:', workflowName, err)
    return []
  }
}

export interface RunMetaSummary {
  runId: string
  status: string
  startedAt?: number
  finishedAt?: number
  stepCount: number
}

// ─── 内部工具函数 ───

function buildRunMetaContent(data: RunMetaData): string {
  const fm: Record<string, unknown> = {
    runId: data.runId,
    workflowName: data.workflowName,
    status: data.status,
  }
  if (data.triggerType) fm.triggerType = data.triggerType
  if (data.args && Object.keys(data.args).length > 0) fm.args = data.args
  if (data.startedAt) fm.startedAt = data.startedAt
  if (data.finishedAt) fm.finishedAt = data.finishedAt
  if (data.errorDetail) fm.errorDetail = data.errorDetail

  const steps: Record<string, Record<string, unknown>> = {}
  for (const [stepId, result] of Object.entries(data.stepResults)) {
    const s: Record<string, unknown> = { status: result.status }
    if (result.type) s.type = result.type
    if (result.sessionId) s.sessionId = result.sessionId
    if (result.durationMs) s.durationMs = result.durationMs
    if (result.structuredData) {
      try {
        s.data = JSON.parse(result.structuredData)
      } catch {
        s.data = result.structuredData
      }
    }
    if (result.artifacts?.length) s.artifacts = result.artifacts
    if (result.error) s.error = result.error
    if (result.errorDetail) s.errorDetail = result.errorDetail
    steps[stepId] = s
  }
  if (Object.keys(steps).length > 0) fm.steps = steps

  const frontmatter = yamlStringify(fm)
  const body = buildMarkdownBody(data)

  return `---\n${frontmatter}\n---\n\n${body}`
}

/** 从 stepResult 派生单行概览（有输出/无输出 · N 个产物），不持久化到 step 字段 */
function deriveStepOverview(result: WorkflowStepResult): string {
  const hasOutput = !!(result.output?.trim() || result.structuredData?.trim())
  const count = result.artifacts?.length ?? 0
  const parts = hasOutput ? ['有输出'] : ['无输出']
  if (count > 0) parts.push(`${count} 个产物`)
  return parts.join(' · ')
}

function buildMarkdownBody(data: RunMetaData): string {
  const lines: string[] = [`# Run: ${data.workflowName}\n`]

  for (const [stepId, result] of Object.entries(data.stepResults)) {
    lines.push(`## Step: ${stepId}`)
    lines.push(`概览：${deriveStepOverview(result)}`)
    lines.push('')
    if (result.output) {
      const preview = result.output.length > 500
        ? result.output.slice(0, 500) + '...'
        : result.output
      lines.push(preview)
    } else if (result.error) {
      lines.push(`Error: ${result.error}`)
      if (result.errorDetail) {
        lines.push('')
        lines.push('```')
        lines.push(result.errorDetail)
        lines.push('```')
      }
    } else if (result.status === 'skipped') {
      lines.push('(skipped)')
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 简易 YAML 序列化（仅支持本模块使用的类型子集）
 */
function yamlStringify(obj: Record<string, unknown>, indent = 0): string {
  const prefix = '  '.repeat(indent)
  const lines: string[] = []

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue

    if (typeof value === 'string') {
      if (value.includes('\n') || value.includes(':') || value.includes('#')) {
        lines.push(`${prefix}${key}: "${value.replace(/"/g, '\\"')}"`)
      } else {
        lines.push(`${prefix}${key}: ${value}`)
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${prefix}${key}: ${value}`)
    } else if (Array.isArray(value)) {
      lines.push(`${prefix}${key}:`)
      for (const item of value) {
        lines.push(`${prefix}  - ${String(item)}`)
      }
    } else if (typeof value === 'object') {
      lines.push(`${prefix}${key}:`)
      lines.push(yamlStringify(value as Record<string, unknown>, indent + 1))
    }
  }

  return lines.join('\n')
}

/**
 * 从 frontmatter 字符串中提取元数据，包括嵌套的 steps 结构。
 *
 * 格式示例：
 * ```
 * steps:
 *   step1:
 *     status: completed
 *     sessionId: abc123
 *     durationMs: 1500
 * ```
 */
function parseRunMeta(raw: string, workflowName: string): RunMetaData | null {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) return null

  const fmStr = fmMatch[1]
  const lines = fmStr.split('\n')

  let runId = ''
  let status = ''
  let triggerType: string | undefined
  let startedAt: number | undefined
  let finishedAt: number | undefined
  let errorDetail: string | undefined
  const stepResults: Record<string, WorkflowStepResult> = {}

  let inSteps = false
  let currentStepId: string | null = null

  for (const line of lines) {
    const indent = line.search(/\S/)
    if (indent < 0) continue

    if (indent === 0) {
      inSteps = false
      currentStepId = null

      if (line === 'steps:') {
        inSteps = true
        continue
      }

      const kv = line.match(/^(\w+):\s*(.+)$/)
      if (!kv) continue
      const [, k, v] = kv
      const unquote = (s: string) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\n/g, '\n') : s)
      switch (k) {
        case 'runId': runId = v; break
        case 'status': status = v; break
        case 'triggerType': triggerType = v; break
        case 'startedAt': startedAt = Number(v) || undefined; break
        case 'finishedAt': finishedAt = Number(v) || undefined; break
        case 'errorDetail': errorDetail = unquote(v); break
      }
    } else if (inSteps && indent === 2) {
      const stepMatch = line.match(/^ {2}(\w[\w-]*):\s*$/)
      if (stepMatch) {
        currentStepId = stepMatch[1]
        stepResults[currentStepId] = { stepId: currentStepId, status: 'pending' }
      }
    } else if (inSteps && indent === 4 && currentStepId) {
      const propMatch = line.match(/^ {4}(\w+):\s*(.+)$/)
      if (!propMatch) continue
      const [, pk, pv] = propMatch
      const result = stepResults[currentStepId]
      const unquote = (s: string) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\n/g, '\n') : s)
      switch (pk) {
        case 'status': result.status = pv as WorkflowStepResult['status']; break
        case 'type': result.type = pv as WorkflowStepResult['type']; break
        case 'sessionId': result.sessionId = pv; break
        case 'durationMs': result.durationMs = Number(pv) || undefined; break
        case 'error': result.error = unquote(pv); break
        case 'errorDetail': result.errorDetail = unquote(pv); break
      }
    }
  }

  if (!runId) return null

  return {
    runId,
    workflowName,
    scope: '',
    status,
    triggerType,
    startedAt,
    finishedAt,
    errorDetail,
    stepResults
  }
}

function extractSummary(raw: string, fallbackRunId: string): RunMetaSummary | null {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) return null

  const fmStr = fmMatch[1]
  let runId = fallbackRunId
  let status = 'unknown'
  let startedAt: number | undefined
  let finishedAt: number | undefined
  let stepCount = 0

  for (const line of fmStr.split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/)
    if (!kv) continue
    const [, k, v] = kv
    switch (k) {
      case 'runId': runId = v; break
      case 'status': status = v; break
      case 'startedAt': startedAt = Number(v) || undefined; break
      case 'finishedAt': finishedAt = Number(v) || undefined; break
    }
  }

  const stepMatches = fmStr.match(/^ {2}[\w-]+:\s*$/gm)
  if (stepMatches) stepCount = stepMatches.length

  return { runId, status, startedAt, finishedAt, stepCount }
}
