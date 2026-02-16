/**
 * Skill 管理器
 * 兼容 Anthropic Agent Skills 开放规范 (agentskills.io/specification)
 * 支持 SKILL.md 解析、渐进式加载、关键词匹配自动激活
 */

import fs from 'fs'
import path from 'path'
import { createLogger } from '../logger'
import { getDataDir } from '../core/PathProviderCore'

const log = createLogger('SkillManager')

// ============ 类型定义 ============

/** SKILL.md frontmatter 解析结果 */
export interface SkillMetadata {
  /** 唯一名称，小写+连字符，1-64 字符 */
  name: string
  /** 描述，1-1024 字符 */
  description: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  /** 预批准的工具列表（空格分隔） */
  allowedTools?: string[]
}

/** 运行时 skill 配置（Level 1 + 管理元数据） */
export interface SkillConfig extends SkillMetadata {
  /** SKILL.md 所在目录绝对路径 */
  path: string
  /** 是否启用 */
  enabled: boolean
  /** 来源标记 */
  source?: 'prizm' | 'claude-code' | 'github'
}

/** 会话级激活状态（Level 2 已加载） */
export interface SkillActivation {
  skillName: string
  /** SKILL.md body 内容（核心指令） */
  instructions: string
  activatedAt: number
  /** 是否自动激活 */
  autoActivated: boolean
}

/** skill 完整内容（含 body） */
export interface SkillFullContent extends SkillConfig {
  /** SKILL.md body */
  body: string
}

// ============ 解析 ============

interface ParsedSkillMd {
  frontmatter: Record<string, unknown>
  body: string
}

function parseSkillMdFrontmatter(raw: string): ParsedSkillMd {
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
  let currentKey = ''
  let currentIndent = 0
  let mapValue: Record<string, string> | null = null

  for (const line of yamlBlock.split('\n')) {
    const stripped = line.trimEnd()
    const lineIndent = stripped.length - stripped.trimStart().length

    // 嵌套 map 值 (metadata: 下的 key: value)
    if (mapValue && lineIndent > currentIndent && stripped.includes(':')) {
      const colonIdx = stripped.indexOf(':')
      const k = stripped.slice(0, colonIdx).trim()
      const v = stripped
        .slice(colonIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
      if (k) mapValue[k] = v
      continue
    } else if (mapValue) {
      frontmatter[currentKey] = mapValue
      mapValue = null
    }

    const colonIdx = stripped.indexOf(':')
    if (colonIdx < 0) continue
    const key = stripped.slice(0, colonIdx).trim()
    const value = stripped.slice(colonIdx + 1).trim()

    if (!key) continue
    currentKey = key
    currentIndent = lineIndent

    if (!value) {
      // 可能是 map 开始
      mapValue = {}
      continue
    }

    // 解析值
    if (value.startsWith('[') && value.endsWith(']')) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else if (value === 'true') {
      frontmatter[key] = true
    } else if (value === 'false') {
      frontmatter[key] = false
    } else {
      frontmatter[key] = value.replace(/^["']|["']$/g, '')
    }
  }

  if (mapValue) {
    frontmatter[currentKey] = mapValue
  }

  return { frontmatter, body }
}

function extractMetadata(frontmatter: Record<string, unknown>): SkillMetadata | null {
  const name = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : ''
  const description =
    typeof frontmatter.description === 'string' ? frontmatter.description.trim() : ''

  if (!name || !description) return null

  let allowedTools: string[] | undefined
  const at = frontmatter['allowed-tools']
  if (Array.isArray(at)) {
    allowedTools = at as string[]
  } else if (typeof at === 'string') {
    allowedTools = at.split(/\s+/).filter(Boolean)
  }

  let metadata: Record<string, string> | undefined
  if (
    frontmatter.metadata &&
    typeof frontmatter.metadata === 'object' &&
    !Array.isArray(frontmatter.metadata)
  ) {
    metadata = frontmatter.metadata as Record<string, string>
  }

  return {
    name,
    description,
    license: typeof frontmatter.license === 'string' ? frontmatter.license : undefined,
    compatibility:
      typeof frontmatter.compatibility === 'string' ? frontmatter.compatibility : undefined,
    metadata,
    allowedTools
  }
}

// ============ 存储 ============

/** 获取 skills 存储目录 */
export function getSkillsDir(): string {
  return path.join(getDataDir(), 'skills')
}

function ensureSkillsDir(): void {
  const dir = getSkillsDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// ============ Level 1: 元数据加载 ============

/**
 * 加载所有 skill 的元数据（Level 1）
 * 仅读取 SKILL.md 的 frontmatter，不加载 body
 */
export function loadAllSkillMetadata(): SkillConfig[] {
  const dir = getSkillsDir()
  if (!fs.existsSync(dir)) return []

  const skills: SkillConfig[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillMdPath = path.join(dir, entry.name, 'SKILL.md')
    if (!fs.existsSync(skillMdPath)) continue

    try {
      const raw = fs.readFileSync(skillMdPath, 'utf-8')
      const { frontmatter } = parseSkillMdFrontmatter(raw)
      const meta = extractMetadata(frontmatter)
      if (!meta) {
        log.warn('Skill "%s" missing required name/description, skipped', entry.name)
        continue
      }

      skills.push({
        ...meta,
        path: path.join(dir, entry.name),
        enabled: true,
        source: 'prizm'
      })
    } catch (err) {
      log.error('Failed to load skill metadata: %s', entry.name, err)
    }
  }

  return skills
}

// ============ Level 2: 完整内容加载 ============

/**
 * 加载单个 skill 的完整内容（Level 2）
 */
export function loadSkillFull(name: string): SkillFullContent | null {
  const skillDir = path.join(getSkillsDir(), name)
  const skillMdPath = path.join(skillDir, 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) return null

  try {
    const raw = fs.readFileSync(skillMdPath, 'utf-8')
    const { frontmatter, body } = parseSkillMdFrontmatter(raw)
    const meta = extractMetadata(frontmatter)
    if (!meta) return null

    return {
      ...meta,
      path: skillDir,
      enabled: true,
      source: 'prizm',
      body
    }
  } catch (err) {
    log.error('Failed to load skill full content: %s', name, err)
    return null
  }
}

// ============ Level 3: 资源按需加载 ============

/**
 * 列出 skill 的资源文件（scripts/references/assets）
 */
export function listSkillResources(name: string): {
  scripts: string[]
  references: string[]
  assets: string[]
} {
  const skillDir = path.join(getSkillsDir(), name)
  const result = { scripts: [] as string[], references: [] as string[], assets: [] as string[] }

  for (const sub of ['scripts', 'references', 'assets'] as const) {
    const subDir = path.join(skillDir, sub)
    if (fs.existsSync(subDir)) {
      result[sub] = fs.readdirSync(subDir).filter((f) => !f.startsWith('.'))
    }
  }

  return result
}

/**
 * 读取 skill 的资源文件内容
 */
export function readSkillResource(name: string, resourcePath: string): string | null {
  const skillDir = path.join(getSkillsDir(), name)
  const fullPath = path.resolve(skillDir, resourcePath)
  // 安全检查：防止路径遍历
  if (!fullPath.startsWith(skillDir)) return null
  if (!fs.existsSync(fullPath)) return null
  return fs.readFileSync(fullPath, 'utf-8')
}

// ============ CRUD ============

/**
 * 创建 skill（写入 SKILL.md + 可选目录结构）
 */
export function createSkill(
  meta: SkillMetadata,
  body: string,
  source?: SkillConfig['source']
): SkillConfig {
  ensureSkillsDir()
  const skillDir = path.join(getSkillsDir(), meta.name)
  if (fs.existsSync(skillDir)) {
    throw new Error(`Skill "${meta.name}" already exists`)
  }

  fs.mkdirSync(skillDir, { recursive: true })

  // 构建 SKILL.md
  const fmLines = [`name: ${meta.name}`, `description: ${meta.description}`]
  if (meta.license) fmLines.push(`license: ${meta.license}`)
  if (meta.compatibility) fmLines.push(`compatibility: ${meta.compatibility}`)
  if (meta.metadata && Object.keys(meta.metadata).length > 0) {
    fmLines.push('metadata:')
    for (const [k, v] of Object.entries(meta.metadata)) {
      fmLines.push(`  ${k}: "${v}"`)
    }
  }
  if (meta.allowedTools?.length) {
    fmLines.push(`allowed-tools: ${meta.allowedTools.join(' ')}`)
  }

  const content = `---\n${fmLines.join('\n')}\n---\n\n${body}`
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8')

  log.info('Skill created: %s', meta.name)
  return {
    ...meta,
    path: skillDir,
    enabled: true,
    source: source ?? 'prizm'
  }
}

/**
 * 更新 skill
 */
export function updateSkill(
  name: string,
  updates: { description?: string; body?: string; enabled?: boolean }
): SkillFullContent | null {
  const skill = loadSkillFull(name)
  if (!skill) return null

  const desc = updates.description ?? skill.description
  const body = updates.body ?? skill.body

  const fmLines = [`name: ${skill.name}`, `description: ${desc}`]
  if (skill.license) fmLines.push(`license: ${skill.license}`)
  if (skill.compatibility) fmLines.push(`compatibility: ${skill.compatibility}`)
  if (skill.metadata && Object.keys(skill.metadata).length > 0) {
    fmLines.push('metadata:')
    for (const [k, v] of Object.entries(skill.metadata)) {
      fmLines.push(`  ${k}: "${v}"`)
    }
  }
  if (skill.allowedTools?.length) {
    fmLines.push(`allowed-tools: ${skill.allowedTools.join(' ')}`)
  }

  const content = `---\n${fmLines.join('\n')}\n---\n\n${body}`
  fs.writeFileSync(path.join(skill.path, 'SKILL.md'), content, 'utf-8')

  log.info('Skill updated: %s', name)
  return { ...skill, description: desc, body }
}

/**
 * 删除 skill
 */
export function deleteSkill(name: string): boolean {
  const skillDir = path.join(getSkillsDir(), name)
  if (!fs.existsSync(skillDir)) return false

  fs.rmSync(skillDir, { recursive: true, force: true })
  log.info('Skill deleted: %s', name)
  return true
}

/**
 * 从外部目录导入 skills
 */
export function importSkillsFromDir(dir: string, source: SkillConfig['source']): SkillConfig[] {
  if (!fs.existsSync(dir)) return []

  const imported: SkillConfig[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  ensureSkillsDir()

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillMdPath = path.join(dir, entry.name, 'SKILL.md')
    if (!fs.existsSync(skillMdPath)) continue

    try {
      const destDir = path.join(getSkillsDir(), entry.name)
      if (fs.existsSync(destDir)) {
        log.info('Skill "%s" already exists, skipping import', entry.name)
        continue
      }

      // 复制整个 skill 目录
      copyDirRecursive(path.join(dir, entry.name), destDir)

      const raw = fs.readFileSync(path.join(destDir, 'SKILL.md'), 'utf-8')
      const { frontmatter } = parseSkillMdFrontmatter(raw)
      const meta = extractMetadata(frontmatter)
      if (!meta) continue

      imported.push({
        ...meta,
        path: destDir,
        enabled: true,
        source
      })
    } catch (err) {
      log.error('Failed to import skill: %s', entry.name, err)
    }
  }

  log.info('Imported %d skills from %s (%s)', imported.length, dir, source)
  return imported
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// ============ 会话级激活管理 ============

/** 会话 → 激活 skills 映射 */
const sessionActivations = new Map<string, SkillActivation[]>()

function sessionKey(scope: string, sessionId: string): string {
  return `${scope}:${sessionId}`
}

/**
 * 手动激活 skill
 */
export function activateSkill(
  scope: string,
  sessionId: string,
  skillName: string,
  maxActive: number = 3
): SkillActivation | null {
  const skill = loadSkillFull(skillName)
  if (!skill) return null

  const key = sessionKey(scope, sessionId)
  let activations = sessionActivations.get(key) ?? []

  // 检查是否已激活
  if (activations.some((a) => a.skillName === skillName)) {
    return activations.find((a) => a.skillName === skillName)!
  }

  // 检查数量限制
  if (activations.length >= maxActive) {
    // 移除最早激活的
    activations = activations.slice(1)
  }

  const activation: SkillActivation = {
    skillName,
    instructions: skill.body,
    activatedAt: Date.now(),
    autoActivated: false
  }

  activations.push(activation)
  sessionActivations.set(key, activations)
  log.info('Skill activated: %s (session: %s)', skillName, sessionId)
  return activation
}

/**
 * 取消激活 skill
 */
export function deactivateSkill(scope: string, sessionId: string, skillName: string): boolean {
  const key = sessionKey(scope, sessionId)
  const activations = sessionActivations.get(key)
  if (!activations) return false

  const idx = activations.findIndex((a) => a.skillName === skillName)
  if (idx < 0) return false

  activations.splice(idx, 1)
  if (activations.length === 0) {
    sessionActivations.delete(key)
  }
  log.info('Skill deactivated: %s (session: %s)', skillName, sessionId)
  return true
}

/**
 * 获取会话中已激活的 skills
 */
export function getActiveSkills(scope: string, sessionId: string): SkillActivation[] {
  return sessionActivations.get(sessionKey(scope, sessionId)) ?? []
}

// ============ 自动激活：关键词匹配 ============

/**
 * 基于用户消息自动激活匹配的 skills
 * 使用轻量关键词匹配（TF-IDF 风格），不调用 LLM
 */
export function autoActivateSkills(
  scope: string,
  sessionId: string,
  userMessage: string,
  maxActive: number = 3
): SkillActivation[] {
  const allSkills = loadAllSkillMetadata()
  if (allSkills.length === 0) return []

  const key = sessionKey(scope, sessionId)
  const currentActivations = sessionActivations.get(key) ?? []
  const alreadyActive = new Set(currentActivations.map((a) => a.skillName))

  // 简单关键词匹配评分
  const msgTokens = tokenize(userMessage)
  if (msgTokens.length === 0) return []

  const candidates: Array<{ skill: SkillConfig; score: number }> = []

  for (const skill of allSkills) {
    if (!skill.enabled || alreadyActive.has(skill.name)) continue

    const descTokens = tokenize(skill.description)
    if (descTokens.length === 0) continue

    // 计算关键词重合率
    const overlap = msgTokens.filter((t) => descTokens.includes(t)).length
    const score = overlap / Math.sqrt(descTokens.length)

    if (score > 0.3) {
      candidates.push({ skill, score })
    }
  }

  if (candidates.length === 0) return []

  // 按分数排序，取前 N 个（不超过 maxActive - 当前数量）
  candidates.sort((a, b) => b.score - a.score)
  const slotsLeft = Math.max(0, maxActive - currentActivations.length)
  const toActivate = candidates.slice(0, slotsLeft)

  const newActivations: SkillActivation[] = []
  for (const { skill } of toActivate) {
    const full = loadSkillFull(skill.name)
    if (!full) continue

    const activation: SkillActivation = {
      skillName: skill.name,
      instructions: full.body,
      activatedAt: Date.now(),
      autoActivated: true
    }
    newActivations.push(activation)
  }

  if (newActivations.length > 0) {
    const updated = [...currentActivations, ...newActivations]
    sessionActivations.set(key, updated)
    log.info(
      'Auto-activated %d skills: %s (session: %s)',
      newActivations.length,
      newActivations.map((a) => a.skillName).join(', '),
      sessionId
    )
  }

  return newActivations
}

/** 简易中英文分词 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
}

/**
 * 发现可导入的 skill 目录
 */
export function discoverImportableSkillSources(projectRoot?: string): Array<{
  source: SkillConfig['source']
  path: string
  count: number
}> {
  const results: Array<{
    source: SkillConfig['source']
    path: string
    count: number
  }> = []

  const roots = projectRoot ? [projectRoot] : []
  const cwd = process.cwd()
  if (cwd !== projectRoot) roots.push(cwd)

  // 也检查用户级
  const home = process.env.HOME || process.env.USERPROFILE
  if (home) {
    const userClaudeSkills = path.join(home, '.claude', 'skills')
    if (fs.existsSync(userClaudeSkills)) {
      const count = fs
        .readdirSync(userClaudeSkills, { withFileTypes: true })
        .filter(
          (e) => e.isDirectory() && fs.existsSync(path.join(userClaudeSkills, e.name, 'SKILL.md'))
        ).length
      if (count > 0) {
        results.push({ source: 'claude-code', path: userClaudeSkills, count })
      }
    }
  }

  for (const root of roots) {
    const claudeSkills = path.join(root, '.claude', 'skills')
    if (fs.existsSync(claudeSkills)) {
      const count = fs
        .readdirSync(claudeSkills, { withFileTypes: true })
        .filter(
          (e) => e.isDirectory() && fs.existsSync(path.join(claudeSkills, e.name, 'SKILL.md'))
        ).length
      if (count > 0) {
        results.push({ source: 'claude-code', path: claudeSkills, count })
      }
    }
  }

  return results
}
