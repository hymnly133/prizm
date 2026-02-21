/**
 * BG Session — System Preamble 构建逻辑
 *
 * 将 BgTriggerPayload 和 BgSessionMeta 拼接为 chatCore 需要的 systemPreamble。
 */

import fs from 'fs'
import path from 'path'
import type { BgSessionMeta } from '@prizm/shared'
import type { BgTriggerPayload } from './types'

/**
 * 构建 BG session 的 system preamble，包含指令、上下文、工作区信息等。
 */
export function buildBgSystemPreamble(payload: BgTriggerPayload, meta: BgSessionMeta): string {
  const sections: string[] = []

  if (payload.systemInstructions) {
    sections.push(payload.systemInstructions)
  }
  if (payload.inputParams) {
    sections.push(buildInputParamsSection(payload.inputParams))
  }
  if (payload.context && Object.keys(payload.context).length > 0) {
    const prevStructured = payload.context.previousStepStructured
    if (
      prevStructured &&
      typeof prevStructured === 'object' &&
      !Array.isArray(prevStructured) &&
      Object.keys(prevStructured as Record<string, unknown>).length > 0
    ) {
      sections.push(buildPreviousStepStructuredSection(prevStructured as Record<string, unknown>))
    }
    const rest = { ...payload.context }
    delete rest.previousStepStructured
    if (Object.keys(rest).length > 0) {
      sections.push('## 上下文数据\n```json\n' + JSON.stringify(rest, null, 2) + '\n```')
    }
  }
  const isWorkflow = meta.label?.startsWith('workflow:')
  if (meta.workspaceDir && !isWorkflow) {
    // 非 workflow 的 BG Session：单工作区说明
    sections.push(
      '## 工作区\n' +
        `你的文件操作默认在以下工作区中进行：\`${meta.workspaceDir}\`\n` +
        '使用 `prizm_file` 的相对路径即可读写工作区内的文件。'
    )
  }
  if (isWorkflow) {
    // workflow 来源的 BG Session：工作区详情由 runner systemInstructions 提供，
    // 此处仅注入运行历史（从 workflow 根目录读取）
    const historyRoot = resolveWorkflowRootForHistory(meta)
    if (historyRoot) {
      injectRecentRunHistory(sections, historyRoot)
    }
  } else if (meta.workspaceDir) {
    injectRecentRunHistory(sections, meta.workspaceDir)
  }
  const resultSuffix = isWorkflow ? ' 你的 output 将自动传递给下一步骤；调用后对话即结束。' : ''
  const formatNote = payload.expectedOutputFormat
    ? `；结果需满足：${payload.expectedOutputFormat}`
    : ''
  const directSubmitNote = isWorkflow ? ' 直接调用工具提交，勿在正文中先输出完整结果。' : ''
  sections.push(
    `请通过 \`prizm_set_result\` 提交结果${formatNote}。${resultSuffix}${directSubmitNote}`
  )
  if (meta.label) {
    sections.push(`任务标签：${meta.label}`)
  }

  return sections.join('\n\n')
}

/**
 * 前序步骤 structured_data 区块（表格形式，精简正交）
 */
function buildPreviousStepStructuredSection(parsed: Record<string, unknown>): string {
  const lines: string[] = ['## 前序步骤 structured_data']
  const entries = Object.entries(parsed)
  if (entries.length === 0) return lines.join('\n')
  lines.push('| 字段 | 值 |')
  lines.push('|------|------|')
  for (const [k, v] of entries) {
    const valueStr = v === undefined ? '(未提供)' : typeof v === 'string' ? v : JSON.stringify(v)
    const truncated = valueStr.length > 500 ? valueStr.slice(0, 500) + '…' : valueStr
    lines.push(`| ${k} | ${truncated} |`)
  }
  return lines.join('\n')
}

/**
 * 构建结构化输入参数区块，让 LLM 清晰了解可用的输入参数及其值。
 */
function buildInputParamsSection(inputParams: {
  schema: Record<string, { type?: string; description?: string; optional?: boolean }>
  values: Record<string, unknown>
}): string {
  const lines: string[] = ['<input_params>', '## 本次任务输入参数']
  const entries = Object.entries(inputParams.schema)

  if (entries.length > 0) {
    lines.push('| 参数 | 类型 | 说明 | 值 |')
    lines.push('|------|------|------|------|')
    for (const [name, def] of entries) {
      const value = inputParams.values[name]
      const valueStr =
        value === undefined ? '(未提供)' : typeof value === 'string' ? value : JSON.stringify(value)
      const desc = (def.description ?? '') + (def.optional ? '（可选）' : '')
      lines.push(`| ${name} | ${def.type ?? 'string'} | ${desc} | ${valueStr} |`)
    }
  }

  lines.push('')
  lines.push('请基于以上输入参数完成任务。')
  lines.push('</input_params>')
  return lines.join('\n')
}

/**
 * 从 meta 中推断 workflow 根目录（工作流工作区或 workspaceDir 的上级），用于读取运行历史。
 * 运行历史存储在 {workflowRoot}/.meta/runs/，而非运行工作区内。
 */
function resolveWorkflowRootForHistory(meta: BgSessionMeta): string | null {
  if (meta.persistentWorkspaceDir) {
    return path.dirname(meta.persistentWorkspaceDir)
  }
  return meta.workspaceDir ?? null
}

function injectRecentRunHistory(sections: string[], workspaceDir: string): void {
  try {
    const runsDir = path.join(workspaceDir, '.meta', 'runs')
    if (!fs.existsSync(runsDir)) return

    const files = fs
      .readdirSync(runsDir)
      .filter((f: string) => f.endsWith('.md'))
      .map((f: string) => ({
        name: f,
        fullPath: path.join(runsDir, f),
        mtime: fs.statSync(path.join(runsDir, f)).mtimeMs
      }))
      .sort((a: { mtime: number }, b: { mtime: number }) => b.mtime - a.mtime)
      .slice(0, 3)

    if (files.length === 0) return

    const summaries: string[] = ['## 最近运行历史']
    for (const file of files) {
      const raw = fs.readFileSync(file.fullPath, 'utf-8')
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/)
      if (!fmMatch) continue

      let runId = file.name.replace(/\.md$/, '')
      let status = 'unknown'
      for (const line of fmMatch[1].split('\n')) {
        const kv = line.match(/^(\w+):\s*(.+)$/)
        if (!kv) continue
        if (kv[1] === 'runId') runId = kv[2]
        if (kv[1] === 'status') status = kv[2]
      }
      summaries.push(`- ${runId}: ${status}`)
    }
    sections.push(summaries.join('\n'))
  } catch {
    // non-critical, skip silently
  }
}
