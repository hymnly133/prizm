/**
 * 自定义命令加载器
 * 从 .prizm-data/commands/ 加载 Markdown 命令文件
 * 兼容 Cursor (.cursor/commands/*.md) 和 Claude Code (.claude/commands/*.md) 格式
 */

import fs from 'fs'
import path from 'path'
import { createLogger } from '../logger'
import { getDataDir } from '../core/PathProviderCore'

const log = createLogger('CustomCommandLoader')

/** 自定义命令配置 */
export interface CustomCommandConfig {
  /** 命令 ID（文件名去 .md） */
  id: string
  /** 显示名 */
  name: string
  /** 描述 */
  description?: string
  /** 命令模式：prompt 注入 LLM 上下文，action 直接返回 */
  mode: 'prompt' | 'action'
  /** 别名列表 */
  aliases?: string[]
  /** 允许的工具列表（兼容 Claude Code allowed-tools） */
  allowedTools?: string[]
  /** Markdown 模板内容（不含 frontmatter） */
  content: string
  /** 来源标记 */
  source?: 'prizm' | 'cursor' | 'claude-code'
  /** 是否启用 */
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/** frontmatter 解析结果 */
interface ParsedMarkdown {
  frontmatter: Record<string, unknown>
  body: string
}

/**
 * 解析 Markdown 文件的 YAML frontmatter
 * 支持 --- 分隔的 YAML 头部
 */
function parseMarkdownWithFrontmatter(raw: string): ParsedMarkdown {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: raw.trim() }
  }

  const endIdx = trimmed.indexOf('---', 3)
  if (endIdx < 0) {
    return { frontmatter: {}, body: raw.trim() }
  }

  const yamlBlock = trimmed.slice(3, endIdx).trim()
  const body = trimmed.slice(endIdx + 3).trim()

  const frontmatter: Record<string, unknown> = {}
  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    const key = line.slice(0, colonIdx).trim()
    let value: unknown = line.slice(colonIdx + 1).trim()

    if (!key) continue

    // 解析数组值 [a, b, c] 或 "a b c"（空格分隔，用于 allowed-tools）
    const strVal = value as string
    if (strVal.startsWith('[') && strVal.endsWith(']')) {
      value = strVal
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else if (strVal === 'true') {
      value = true
    } else if (strVal === 'false') {
      value = false
    } else if (/^\d+$/.test(strVal)) {
      value = parseInt(strVal, 10)
    } else {
      // 去掉引号
      value = strVal.replace(/^["']|["']$/g, '')
    }

    frontmatter[key] = value
  }

  return { frontmatter, body }
}

/**
 * 替换模板变量
 * 支持: $ARGUMENTS, $1, $2, ..., {{args}}
 */
export function replaceTemplateVariables(template: string, args: string[]): string {
  let result = template

  // $ARGUMENTS / {{args}} → 所有参数拼接
  const allArgs = args.join(' ')
  result = result.replace(/\$ARGUMENTS/g, allArgs)
  result = result.replace(/\{\{args\}\}/g, allArgs)

  // $1, $2, ... → 位置参数
  for (let i = 0; i < args.length; i++) {
    result = result.replace(new RegExp(`\\$${i + 1}`, 'g'), args[i])
  }
  // 清理未替换的位置参数占位符
  result = result.replace(/\$\d+/g, '')

  return result
}

/** 获取命令存储目录 */
export function getCommandsDir(): string {
  return path.join(getDataDir(), 'commands')
}

/** 确保命令目录存在 */
function ensureCommandsDir(): void {
  const dir = getCommandsDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * 从 Markdown 文件解析为 CustomCommandConfig
 */
function parseCommandFile(
  filePath: string,
  source: CustomCommandConfig['source'] = 'prizm'
): CustomCommandConfig | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const fileName = path.basename(filePath, '.md')
    const { frontmatter, body } = parseMarkdownWithFrontmatter(raw)
    const stat = fs.statSync(filePath)

    const name =
      typeof frontmatter.name === 'string' && frontmatter.name.trim()
        ? frontmatter.name.trim()
        : fileName

    const description =
      typeof frontmatter.description === 'string' ? frontmatter.description : undefined

    const mode = frontmatter.mode === 'action' ? 'action' : 'prompt'

    const aliases = Array.isArray(frontmatter.aliases)
      ? (frontmatter.aliases as string[]).filter((s) => typeof s === 'string')
      : undefined

    // allowed-tools: 空格分隔的字符串或数组
    let allowedTools: string[] | undefined
    if (Array.isArray(frontmatter['allowed-tools'])) {
      allowedTools = frontmatter['allowed-tools'] as string[]
    } else if (typeof frontmatter['allowed-tools'] === 'string') {
      allowedTools = (frontmatter['allowed-tools'] as string).split(/\s+/).filter(Boolean)
    }

    const enabled = frontmatter.enabled !== false

    return {
      id: fileName,
      name,
      description,
      mode,
      aliases,
      allowedTools,
      content: body,
      source,
      enabled,
      createdAt: stat.birthtimeMs || stat.ctimeMs,
      updatedAt: stat.mtimeMs
    }
  } catch (err) {
    log.error('Failed to parse command file:', filePath, err)
    return null
  }
}

/**
 * 加载所有自定义命令
 */
export function loadAllCustomCommands(): CustomCommandConfig[] {
  const dir = getCommandsDir()
  if (!fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
  const commands: CustomCommandConfig[] = []

  for (const file of files) {
    const cmd = parseCommandFile(path.join(dir, file), 'prizm')
    if (cmd) commands.push(cmd)
  }

  return commands
}

/**
 * 获取单个命令
 */
export function getCustomCommand(id: string): CustomCommandConfig | null {
  const filePath = path.join(getCommandsDir(), `${id}.md`)
  if (!fs.existsSync(filePath)) return null
  return parseCommandFile(filePath, 'prizm')
}

/**
 * 保存命令到文件
 */
export function saveCustomCommand(config: CustomCommandConfig): void {
  ensureCommandsDir()
  const filePath = path.join(getCommandsDir(), `${config.id}.md`)

  const fmLines: string[] = []
  if (config.name !== config.id) fmLines.push(`name: ${config.name}`)
  if (config.description) fmLines.push(`description: ${config.description}`)
  if (config.mode !== 'prompt') fmLines.push(`mode: ${config.mode}`)
  if (config.aliases?.length) {
    fmLines.push(`aliases: [${config.aliases.join(', ')}]`)
  }
  if (config.allowedTools?.length) {
    fmLines.push(`allowed-tools: ${config.allowedTools.join(' ')}`)
  }
  if (!config.enabled) fmLines.push(`enabled: false`)

  let content = ''
  if (fmLines.length > 0) {
    content = `---\n${fmLines.join('\n')}\n---\n\n${config.content}`
  } else {
    content = config.content
  }

  fs.writeFileSync(filePath, content, 'utf-8')
  log.info('Custom command saved:', config.id)
}

/**
 * 删除命令文件
 */
export function deleteCustomCommand(id: string): boolean {
  const filePath = path.join(getCommandsDir(), `${id}.md`)
  if (!fs.existsSync(filePath)) return false
  fs.unlinkSync(filePath)
  log.info('Custom command deleted:', id)
  return true
}

/**
 * 从外部目录导入命令文件
 */
export function importCommandsFromDir(
  dir: string,
  source: CustomCommandConfig['source']
): CustomCommandConfig[] {
  if (!fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
  const imported: CustomCommandConfig[] = []

  ensureCommandsDir()

  for (const file of files) {
    const srcPath = path.join(dir, file)
    const cmd = parseCommandFile(srcPath, source)
    if (!cmd) continue

    cmd.source = source
    saveCustomCommand(cmd)
    imported.push(cmd)
  }

  log.info('Imported %d commands from %s (%s)', imported.length, dir, source)
  return imported
}

/**
 * 自动发现可导入的命令目录
 */
export function discoverImportableSources(projectRoot?: string): Array<{
  source: CustomCommandConfig['source']
  path: string
  count: number
}> {
  const results: Array<{
    source: CustomCommandConfig['source']
    path: string
    count: number
  }> = []

  const roots = projectRoot ? [projectRoot] : []
  // 也检查 cwd
  const cwd = process.cwd()
  if (cwd !== projectRoot) roots.push(cwd)

  for (const root of roots) {
    // Cursor commands
    const cursorDir = path.join(root, '.cursor', 'commands')
    if (fs.existsSync(cursorDir)) {
      const count = fs.readdirSync(cursorDir).filter((f) => f.endsWith('.md')).length
      if (count > 0) results.push({ source: 'cursor', path: cursorDir, count })
    }

    // Claude Code commands
    const claudeDir = path.join(root, '.claude', 'commands')
    if (fs.existsSync(claudeDir)) {
      const count = fs.readdirSync(claudeDir).filter((f) => f.endsWith('.md')).length
      if (count > 0) results.push({ source: 'claude-code', path: claudeDir, count })
    }
  }

  return results
}
