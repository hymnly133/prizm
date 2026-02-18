/**
 * Agent 自定义规则管理器
 * 支持用户级（全局）和 Scope 级（工作区）两层规则
 *
 * 存储格式：Markdown 文件 + YAML frontmatter（与 Skills/Commands 一致）
 * - 用户级：.prizm-data/rules/{id}.md
 * - Scope 级：{scopeRoot}/.prizm/rules/{id}.md
 */

import fs from 'fs'
import path from 'path'
import { createLogger } from '../logger'
import { getDataDir } from '../core/PathProviderCore'
import { scopeStore } from '../core/ScopeStore'

const log = createLogger('AgentRulesManager')

// ============ 类型定义 ============

export type RuleLevel = 'user' | 'scope'

/** 规则元数据（frontmatter 解析结果） */
export interface AgentRule {
  /** kebab-case 唯一 ID */
  id: string
  /** 显示标题 */
  title: string
  /** 规则内容（Markdown body） */
  content: string
  /** 是否启用 */
  enabled: boolean
  /** 规则层级 */
  level: RuleLevel
  /** scope 级规则所属 scope */
  scope?: string
  /** 是否始终注入（false 时仅手动引用） */
  alwaysApply: boolean
  /** 文件匹配模式（可选，兼容 Cursor .mdc 风格） */
  globs?: string[]
  /** 简述（用于列表展示） */
  description?: string
  createdAt: number
  updatedAt: number
}

/** 创建规则的输入 */
export interface CreateRuleInput {
  id: string
  title: string
  content: string
  level: RuleLevel
  scope?: string
  enabled?: boolean
  alwaysApply?: boolean
  globs?: string[]
  description?: string
}

/** 更新规则的输入 */
export interface UpdateRuleInput {
  title?: string
  content?: string
  enabled?: boolean
  alwaysApply?: boolean
  globs?: string[]
  description?: string
}

// ============ 路径工具 ============

/** 用户级规则目录：.prizm-data/rules/ */
function getUserRulesDir(): string {
  return path.join(getDataDir(), 'rules')
}

/** Scope 级规则目录：{scopeRoot}/.prizm/rules/ */
function getScopeRulesDir(scope: string): string {
  const scopeRoot = scopeStore.getScopeRootPath(scope)
  return path.join(scopeRoot, '.prizm', 'rules')
}

/** 根据 level + scope 获取规则目录 */
function getRulesDir(level: RuleLevel, scope?: string): string {
  if (level === 'scope') {
    if (!scope) throw new Error('scope is required for scope-level rules')
    return getScopeRulesDir(scope)
  }
  return getUserRulesDir()
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function getRuleFilePath(id: string, level: RuleLevel, scope?: string): string {
  return path.join(getRulesDir(level, scope), `${id}.md`)
}

// ============ frontmatter 解析/序列化 ============

interface ParsedRuleMd {
  frontmatter: Record<string, unknown>
  body: string
}

function parseFrontmatter(raw: string): ParsedRuleMd {
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

  const fm: Record<string, unknown> = {}
  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    if (!key) continue

    if (value === 'true') {
      fm[key] = true
    } else if (value === 'false') {
      fm[key] = false
    } else if (/^\d+$/.test(value)) {
      fm[key] = parseInt(value, 10)
    } else if (value.startsWith('[') && value.endsWith(']')) {
      fm[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else {
      fm[key] = value.replace(/^["']|["']$/g, '')
    }
  }

  return { frontmatter: fm, body }
}

function serializeToMd(rule: AgentRule): string {
  const lines: string[] = []
  lines.push(`id: ${rule.id}`)
  lines.push(`title: "${rule.title}"`)
  if (rule.description) lines.push(`description: "${rule.description}"`)
  lines.push(`enabled: ${rule.enabled}`)
  lines.push(`alwaysApply: ${rule.alwaysApply}`)
  if (rule.globs?.length) {
    lines.push(`globs: [${rule.globs.map((g) => `"${g}"`).join(', ')}]`)
  }
  lines.push(`createdAt: ${rule.createdAt}`)
  lines.push(`updatedAt: ${rule.updatedAt}`)

  return `---\n${lines.join('\n')}\n---\n\n${rule.content}`
}

function parseRuleFromFile(filePath: string, level: RuleLevel, scope?: string): AgentRule | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const { frontmatter: fm, body } = parseFrontmatter(raw)

    const id = typeof fm.id === 'string' ? fm.id : path.basename(filePath, '.md')
    const title = typeof fm.title === 'string' ? fm.title : id

    return {
      id,
      title,
      content: body,
      enabled: fm.enabled !== false,
      level,
      scope: level === 'scope' ? scope : undefined,
      alwaysApply: fm.alwaysApply === true,
      globs: Array.isArray(fm.globs) ? (fm.globs as string[]) : undefined,
      description: typeof fm.description === 'string' ? fm.description : undefined,
      createdAt: typeof fm.createdAt === 'number' ? fm.createdAt : Date.now(),
      updatedAt: typeof fm.updatedAt === 'number' ? fm.updatedAt : Date.now()
    }
  } catch (err) {
    log.warn('Failed to parse rule file: %s', filePath, err)
    return null
  }
}

// ============ CRUD ============

/**
 * 列出指定层级的所有规则
 */
export function listRules(level: RuleLevel, scope?: string): AgentRule[] {
  const dir = getRulesDir(level, scope)
  if (!fs.existsSync(dir)) return []

  const rules: AgentRule[] = []
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()

  for (const file of files) {
    const rule = parseRuleFromFile(path.join(dir, file), level, scope)
    if (rule) rules.push(rule)
  }

  return rules
}

/**
 * 获取单条规则
 */
export function getRule(id: string, level: RuleLevel, scope?: string): AgentRule | null {
  const filePath = getRuleFilePath(id, level, scope)
  if (!fs.existsSync(filePath)) return null
  return parseRuleFromFile(filePath, level, scope)
}

/**
 * 创建规则
 */
export function createRule(input: CreateRuleInput): AgentRule {
  const dir = getRulesDir(input.level, input.scope)
  ensureDir(dir)

  const filePath = getRuleFilePath(input.id, input.level, input.scope)
  if (fs.existsSync(filePath)) {
    throw new Error(`Rule "${input.id}" already exists at ${input.level} level`)
  }

  const now = Date.now()
  const rule: AgentRule = {
    id: input.id,
    title: input.title,
    content: input.content,
    enabled: input.enabled !== false,
    level: input.level,
    scope: input.level === 'scope' ? input.scope : undefined,
    alwaysApply: input.alwaysApply === true,
    globs: input.globs,
    description: input.description,
    createdAt: now,
    updatedAt: now
  }

  fs.writeFileSync(filePath, serializeToMd(rule), 'utf-8')
  log.info('Rule created: %s (%s level)', rule.id, rule.level)
  return rule
}

/**
 * 更新规则
 */
export function updateRule(
  id: string,
  level: RuleLevel,
  scope: string | undefined,
  updates: UpdateRuleInput
): AgentRule | null {
  const existing = getRule(id, level, scope)
  if (!existing) return null

  const updated: AgentRule = {
    ...existing,
    title: updates.title ?? existing.title,
    content: updates.content ?? existing.content,
    enabled: updates.enabled ?? existing.enabled,
    alwaysApply: updates.alwaysApply ?? existing.alwaysApply,
    globs: updates.globs !== undefined ? updates.globs : existing.globs,
    description: updates.description !== undefined ? updates.description : existing.description,
    updatedAt: Date.now()
  }

  const filePath = getRuleFilePath(id, level, scope)
  fs.writeFileSync(filePath, serializeToMd(updated), 'utf-8')
  log.info('Rule updated: %s (%s level)', id, level)
  return updated
}

/**
 * 删除规则
 */
export function deleteRule(id: string, level: RuleLevel, scope?: string): boolean {
  const filePath = getRuleFilePath(id, level, scope)
  if (!fs.existsSync(filePath)) return false

  fs.unlinkSync(filePath)
  log.info('Rule deleted: %s (%s level)', id, level)
  return true
}

// ============ 规则加载（注入 system prompt） ============

/** 粗估 token 数（中英文混合，取字符数 / 2） */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2)
}

/**
 * 加载当前 scope 下所有启用且 alwaysApply 的自定义规则
 * 合并顺序：scope 级优先，用户级其次
 * @param scope 当前 scope
 * @param maxTokens token 预算（默认 4000）
 * @returns 合并后的规则文本，null 表示无规则
 */
export function loadActiveRules(scope: string, maxTokens: number = 4000): string | null {
  const scopeRules = listRules('scope', scope).filter((r) => r.enabled && r.alwaysApply)
  const userRules = listRules('user').filter((r) => r.enabled && r.alwaysApply)

  const allRules = [...scopeRules, ...userRules]
  if (allRules.length === 0) return null

  const parts: string[] = []
  let usedTokens = 0

  for (const rule of allRules) {
    const tokens = estimateTokens(rule.content)
    if (usedTokens + tokens > maxTokens) {
      log.info('Custom rules token budget exceeded, truncating at %s (%s)', rule.id, rule.level)
      break
    }

    const label = rule.level === 'scope' ? `scope:${scope}` : 'user'
    parts.push(`<!-- custom-rule: ${rule.title} (${label}) -->\n${rule.content}`)
    usedTokens += tokens
  }

  return parts.length > 0 ? parts.join('\n\n') : null
}
