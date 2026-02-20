/**
 * BG Session — System Preamble 构建逻辑
 *
 * 将 BgTriggerPayload 和 BgSessionMeta 拼接为 chatCore 需要的 systemPreamble。
 */

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
    sections.push('## 上下文数据\n```json\n' + JSON.stringify(payload.context, null, 2) + '\n```')
  }
  if (meta.workspaceDir) {
    sections.push(
      '## 工作区\n' +
        `你的文件操作默认在工作流工作区中进行：\`${meta.workspaceDir}\`\n` +
        '使用 `prizm_file` 的相对路径即可读写工作区内的文件。\n' +
        '`.meta/runs/` 目录包含历史运行记录，可以读取了解之前的执行情况。'
    )
    injectRecentRunHistory(sections, meta.workspaceDir)
  }
  const isWorkflow = meta.label?.startsWith('workflow:')
  const resultSuffix = isWorkflow
    ? '你的 output 将自动传递给下一步骤。'
    : ''

  if (payload.expectedOutputFormat) {
    sections.push(
      '## 输出格式要求\n' +
        payload.expectedOutputFormat +
        `\n\n**重要**：任务完成后你必须调用 \`prizm_set_result\` 工具提交结果。${resultSuffix}`
    )
  } else {
    sections.push(`**重要**：任务完成后你必须调用 \`prizm_set_result\` 工具提交结果。${resultSuffix}`)
  }
  if (meta.label) {
    sections.push(`任务标签：${meta.label}`)
  }

  return sections.join('\n\n')
}

/**
 * 构建结构化输入参数区块，让 LLM 清晰了解可用的输入参数及其值。
 */
function buildInputParamsSection(inputParams: {
  schema: Record<string, { type?: string; description?: string }>
  values: Record<string, unknown>
}): string {
  const lines: string[] = ['<input_params>', '## 本次任务输入参数']
  const entries = Object.entries(inputParams.schema)

  if (entries.length > 0) {
    lines.push('| 参数 | 类型 | 说明 | 值 |')
    lines.push('|------|------|------|------|')
    for (const [name, def] of entries) {
      const value = inputParams.values[name]
      const valueStr = value === undefined ? '(未提供)'
        : typeof value === 'string' ? value
        : JSON.stringify(value)
      lines.push(`| ${name} | ${def.type ?? 'string'} | ${def.description ?? ''} | ${valueStr} |`)
    }
  }

  lines.push('')
  lines.push('请基于以上输入参数完成任务。')
  lines.push('</input_params>')
  return lines.join('\n')
}

function injectRecentRunHistory(sections: string[], workspaceDir: string): void {
  try {
    const fs = require('fs') as typeof import('fs')
    const pathMod = require('path') as typeof import('path')
    const runsDir = pathMod.join(workspaceDir, '.meta', 'runs')
    if (!fs.existsSync(runsDir)) return

    const files = fs
      .readdirSync(runsDir)
      .filter((f: string) => f.endsWith('.md'))
      .map((f: string) => ({
        name: f,
        fullPath: pathMod.join(runsDir, f),
        mtime: fs.statSync(pathMod.join(runsDir, f)).mtimeMs
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
