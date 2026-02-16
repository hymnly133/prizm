/**
 * 多格式规则加载器
 * 自动发现并加载项目中各种 AI Agent 工具的规则文件
 * 支持: AGENTS.md, CLAUDE.md, GEMINI.md, .cursor/rules/*.mdc,
 *       .clinerules/*.md, .windsurfrules, .roo/rules/*.md,
 *       CONVENTIONS.md, .github/copilot-instructions.md
 */

import fs from 'fs'
import path from 'path'
import { createLogger } from '../logger'

const log = createLogger('RulesLoader')

/** 已加载的规则 */
export interface LoadedRule {
  /** 来源文件路径 */
  source: string
  /** 来源工具标识 */
  tool: string
  /** 规则内容 */
  content: string
  /** 优先级（越小越高） */
  priority: number
  /** 条件（仅 Cursor .mdc 格式） */
  condition?: {
    alwaysApply?: boolean
    globs?: string[]
    description?: string
  }
}

/** 规则设置 */
export interface RulesSettings {
  enabled: boolean
  maxTokens: number
  autoDiscover: boolean
  enabledSources?: string[]
}

/** 规则源定义 */
interface RuleSource {
  priority: number
  tool: string
  /** 相对于项目根目录的路径 */
  paths: string[]
  /** 是否为目录（需要遍历 .md/.mdc 文件） */
  isDir?: boolean
  /** 文件扩展名过滤 */
  extensions?: string[]
}

/** 规则源优先级列表 */
const RULE_SOURCES: RuleSource[] = [
  {
    priority: 1,
    tool: 'agents-md',
    paths: ['AGENTS.md']
  },
  {
    priority: 2,
    tool: 'claude-code',
    paths: ['CLAUDE.md']
  },
  {
    priority: 3,
    tool: 'gemini-cli',
    paths: ['GEMINI.md']
  },
  {
    priority: 4,
    tool: 'cursor',
    paths: ['.cursor/rules'],
    isDir: true,
    extensions: ['.mdc', '.md']
  },
  {
    priority: 5,
    tool: 'cline',
    paths: ['.clinerules'],
    isDir: true,
    extensions: ['.md', '.txt']
  },
  {
    priority: 6,
    tool: 'windsurf',
    paths: ['.windsurfrules']
  },
  {
    priority: 7,
    tool: 'roo-code',
    paths: ['.roo/rules'],
    isDir: true,
    extensions: ['.md', '.txt']
  },
  {
    priority: 8,
    tool: 'aider',
    paths: ['CONVENTIONS.md']
  },
  {
    priority: 9,
    tool: 'copilot',
    paths: ['.github/copilot-instructions.md']
  }
]

/** 缓存 */
let cachedRules: LoadedRule[] | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 30_000

/** 粗估 token 数（中英文混合，取字符数 / 2） */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2)
}

/**
 * 解析 Cursor .mdc 文件的 frontmatter（提取 alwaysApply, globs, description）
 */
function parseMdcFrontmatter(raw: string): { condition: LoadedRule['condition']; body: string } {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('---')) {
    return { condition: undefined, body: raw.trim() }
  }

  const endIdx = trimmed.indexOf('---', 3)
  if (endIdx < 0) {
    return { condition: undefined, body: raw.trim() }
  }

  const yamlBlock = trimmed.slice(3, endIdx).trim()
  const body = trimmed.slice(endIdx + 3).trim()
  const condition: LoadedRule['condition'] = {}

  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()

    if (key === 'alwaysApply') {
      condition.alwaysApply = value === 'true'
    } else if (key === 'globs') {
      // globs: ["*.ts", "*.tsx"]
      if (value.startsWith('[')) {
        condition.globs = value
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      }
    } else if (key === 'description') {
      condition.description = value.replace(/^["']|["']$/g, '')
    }
  }

  return { condition: Object.keys(condition).length > 0 ? condition : undefined, body }
}

/**
 * 解析 GEMINI.md 的 @file.md 导入
 */
function resolveGeminiImports(content: string, baseDir: string): string {
  return content.replace(/^@(.+\.md)$/gm, (_match, filePath: string) => {
    const resolved = path.resolve(baseDir, filePath.trim())
    if (fs.existsSync(resolved)) {
      try {
        return fs.readFileSync(resolved, 'utf-8')
      } catch {
        return `<!-- Failed to import: ${filePath} -->`
      }
    }
    return `<!-- Not found: ${filePath} -->`
  })
}

/**
 * 从项目根目录发现并加载所有规则
 */
function discoverRules(projectRoot?: string): LoadedRule[] {
  const root = projectRoot || process.cwd()
  const rules: LoadedRule[] = []

  for (const source of RULE_SOURCES) {
    for (const relPath of source.paths) {
      const fullPath = path.join(root, relPath)

      if (source.isDir) {
        // 目录型：遍历文件
        if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) continue

        const files = fs.readdirSync(fullPath).sort()
        for (const file of files) {
          const ext = path.extname(file).toLowerCase()
          if (source.extensions && !source.extensions.includes(ext)) continue

          const filePath = path.join(fullPath, file)
          try {
            let content = fs.readFileSync(filePath, 'utf-8').trim()
            if (!content) continue

            let condition: LoadedRule['condition']
            if (ext === '.mdc') {
              const parsed = parseMdcFrontmatter(content)
              condition = parsed.condition
              content = parsed.body
              // 仅加载 alwaysApply=true 的规则（其他规则需要按文件匹配）
              if (condition && condition.alwaysApply === false && !condition.globs) {
                continue
              }
            }

            rules.push({
              source: filePath,
              tool: source.tool,
              content,
              priority: source.priority,
              condition
            })
          } catch (err) {
            log.warn('Failed to read rule file: %s', filePath, err)
          }
        }
      } else {
        // 单文件型
        if (!fs.existsSync(fullPath)) continue

        try {
          let content = fs.readFileSync(fullPath, 'utf-8').trim()
          if (!content) continue

          // GEMINI.md 特殊处理：解析 @import
          if (source.tool === 'gemini-cli') {
            content = resolveGeminiImports(content, path.dirname(fullPath))
          }

          rules.push({
            source: fullPath,
            tool: source.tool,
            content,
            priority: source.priority
          })
        } catch (err) {
          log.warn('Failed to read rule file: %s', fullPath, err)
        }
      }
    }
  }

  return rules
}

/**
 * 加载并合并规则（带 token 预算控制）
 * @param projectRoot 项目根目录（默认 cwd）
 * @param maxTokens token 预算（默认 8000）
 * @returns 合并后的规则文本，null 表示无规则
 */
export function loadRules(projectRoot?: string, maxTokens: number = 8000): string | null {
  const now = Date.now()
  if (cachedRules && now - cacheTimestamp < CACHE_TTL_MS) {
    // 使用缓存
    return mergeRules(cachedRules, maxTokens)
  }

  const rules = discoverRules(projectRoot)
  cachedRules = rules
  cacheTimestamp = now

  if (rules.length === 0) return null

  log.info(
    'Discovered %d rule files from: %s',
    rules.length,
    [...new Set(rules.map((r) => r.tool))].join(', ')
  )

  return mergeRules(rules, maxTokens)
}

function mergeRules(rules: LoadedRule[], maxTokens: number): string | null {
  if (rules.length === 0) return null

  // 按优先级排序
  const sorted = [...rules].sort((a, b) => a.priority - b.priority)

  const parts: string[] = []
  let usedTokens = 0

  for (const rule of sorted) {
    const tokens = estimateTokens(rule.content)
    if (usedTokens + tokens > maxTokens) {
      log.info('Rules token budget exceeded, truncating at %s (%s)', rule.source, rule.tool)
      break
    }

    parts.push(`<!-- ${rule.tool}: ${path.basename(rule.source)} -->\n${rule.content}`)
    usedTokens += tokens
  }

  return parts.length > 0 ? parts.join('\n\n') : null
}

/**
 * 清除规则缓存（用于配置变更后刷新）
 */
export function clearRulesCache(): void {
  cachedRules = null
  cacheTimestamp = 0
}

/**
 * 列出已发现的规则（供 API/UI 展示）
 */
export function listDiscoveredRules(projectRoot?: string): Array<{
  source: string
  tool: string
  priority: number
  tokens: number
}> {
  const rules = discoverRules(projectRoot)
  return rules.map((r) => ({
    source: r.source,
    tool: r.tool,
    priority: r.priority,
    tokens: estimateTokens(r.content)
  }))
}
