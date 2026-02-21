/**
 * Skill 管理器
 * 兼容 Anthropic Agent Skills 开放规范 (agentskills.io/specification)
 * 支持 SKILL.md 解析、渐进式加载、关键词匹配自动激活
 */

import fs from 'fs'
import path from 'path'
import { createLogger } from '../logger'
import { getDataDir } from '../core/PathProviderCore'
import { getRegistryKey, type SkillOrigin } from './skillRegistryKey'

const log = createLogger('SkillManager')

// ============ 类型定义 ============

/** 从 registry 安装时的来源（用于已安装判断与冲突提示） */
export type { SkillOrigin } from './skillRegistryKey'

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
  /** 从 registry 安装时的来源，仅安装时写入 */
  origin?: SkillOrigin
}

/** 运行时 skill 配置（Level 1 + 管理元数据） */
export interface SkillConfig extends SkillMetadata {
  /** SKILL.md 所在目录绝对路径 */
  path: string
  /** 是否启用 */
  enabled: boolean
  /** 来源标记（含 registry 安装来源） */
  source?: 'prizm' | 'claude-code' | 'github' | 'curated' | 'skillkit' | 'skillsmp'
}

/** skill 完整内容（含 body） */
export interface SkillFullContent extends SkillConfig {
  /** SKILL.md body */
  body: string
}

/** 技能目录文件树（相对技能根）：叶子为 "file"，子树为嵌套对象 */
export type SkillFileTree = Record<string, 'file' | SkillFileTree>

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

  let origin: SkillOrigin | undefined
  const o = frontmatter.origin
  if (
    o &&
    typeof o === 'object' &&
    !Array.isArray(o) &&
    typeof (o as Record<string, unknown>).source === 'string' &&
    typeof (o as Record<string, unknown>).owner === 'string' &&
    typeof (o as Record<string, unknown>).repo === 'string' &&
    typeof (o as Record<string, unknown>).skillPath === 'string'
  ) {
    const ro = o as Record<string, string>
    if (['github', 'curated', 'skillkit', 'skillsmp'].includes(ro.source)) {
      origin = {
        source: ro.source as SkillOrigin['source'],
        owner: ro.owner,
        repo: ro.repo,
        skillPath: ro.skillPath
      }
    }
  }

  return {
    name,
    description,
    license: typeof frontmatter.license === 'string' ? frontmatter.license : undefined,
    compatibility:
      typeof frontmatter.compatibility === 'string' ? frontmatter.compatibility : undefined,
    metadata,
    allowedTools,
    origin
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
        source: meta.origin ? meta.origin.source : 'prizm'
      })
    } catch (err) {
      log.error('Failed to load skill metadata: %s', entry.name, err)
    }
  }

  return skills
}

/**
 * 已安装 skill 的 registryKey 集合（仅含带 origin 的项），供 skillRegistry 做精确已安装判断。
 */
export function getInstalledRegistryKeys(): Set<string> {
  const skills = loadAllSkillMetadata()
  const keys = new Set<string>()
  for (const s of skills) {
    if (s.origin) {
      keys.add(getRegistryKey(s.origin))
    }
  }
  return keys
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
      source: meta.origin ? meta.origin.source : 'prizm',
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

/**
 * 列出技能目录的文件树（相对技能根），含 SKILL.md 与 scripts/references/assets 及嵌套内容。
 * 路径安全：仅解析技能目录内路径。
 */
export function getSkillFileTree(name: string): SkillFileTree | null {
  const skillDir = path.join(getSkillsDir(), name)
  const skillDirResolved = path.resolve(skillDir)
  if (!fs.existsSync(skillDirResolved)) return null
  const skillMdPath = path.join(skillDirResolved, 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) return null

  function walk(dir: string): SkillFileTree {
    const tree: SkillFileTree = {}
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      const resolved = path.resolve(fullPath)
      if (!resolved.startsWith(skillDirResolved)) continue
      if (entry.isFile()) {
        const rel = path.relative(skillDirResolved, resolved)
        if (!rel.startsWith('..') && rel !== '') tree[entry.name] = 'file'
      } else if (entry.isDirectory()) {
        tree[entry.name] = walk(fullPath)
      }
    }
    return tree
  }

  const root: SkillFileTree = {}
  if (fs.existsSync(skillMdPath)) root['SKILL.md'] = 'file'
  const entries = fs.readdirSync(skillDirResolved, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'SKILL.md') continue
    const fullPath = path.join(skillDirResolved, entry.name)
    const resolved = path.resolve(fullPath)
    if (!resolved.startsWith(skillDirResolved)) continue
    if (entry.isFile()) root[entry.name] = 'file'
    else if (entry.isDirectory()) root[entry.name] = walk(fullPath)
  }
  return root
}

// ============ CRUD ============

/**
 * 构建 frontmatter 的 origin 行（多行）
 */
function formatOriginInFrontmatter(origin: SkillOrigin): string[] {
  return [
    'origin:',
    `  source: ${origin.source}`,
    `  owner: ${origin.owner}`,
    `  repo: ${origin.repo}`,
    `  skillPath: ${origin.skillPath}`
  ]
}

/**
 * 创建 skill（写入 SKILL.md + 可选目录结构）
 */
export function createSkill(
  meta: SkillMetadata,
  body: string,
  source?: SkillConfig['source'],
  origin?: SkillOrigin
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
  const writtenOrigin = origin ?? meta.origin
  if (writtenOrigin) {
    fmLines.push(...formatOriginInFrontmatter(writtenOrigin))
  }

  const content = `---\n${fmLines.join('\n')}\n---\n\n${body}`
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8')

  log.info('Skill created: %s', meta.name)
  return {
    ...meta,
    origin: writtenOrigin,
    path: skillDir,
    enabled: true,
    source: source ?? writtenOrigin?.source ?? 'prizm'
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
  if (skill.origin) {
    fmLines.push(...formatOriginInFrontmatter(skill.origin))
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

/**
 * 根据会话允许列表返回仅元数据（Level 1 发现用），供渐进式发现：系统提示只注入 name+description，
 * 模型需要完整说明时通过工具 prizm_get_skill_instructions(skill_name) 按需加载。
 * - allowedSkills 为空/未设置：返回所有已启用 skill 的 name + description
 * - allowedSkills 非空：只返回名单内的 skill
 */
export function getSkillsMetadataForDiscovery(
  _scope: string,
  allowedSkills: string[] | undefined
): Array<{ name: string; description: string }> {
  const all = loadAllSkillMetadata()
  const enabled = all.filter((s) => s.enabled)
  if (!allowedSkills || allowedSkills.length === 0) {
    return enabled.map((s) => ({ name: s.name, description: s.description }))
  }
  const set = new Set(allowedSkills)
  return enabled.filter((s) => set.has(s.name)).map((s) => ({ name: s.name, description: s.description }))
}

/**
 * 根据会话允许列表返回要注入的 skills（单一数据源，仅用 allowedSkills）
 * - allowedSkills 为空/未设置：返回所有已启用 skill 的 name + instructions
 * - allowedSkills 非空：只返回名单内的 skill
 */
export function getSkillsToInject(
  _scope: string,
  allowedSkills: string[] | undefined
): Array<{ name: string; instructions: string }> {
  const all = loadAllSkillMetadata()
  const enabled = all.filter((s) => s.enabled)
  if (!allowedSkills || allowedSkills.length === 0) {
    return enabled
      .map((s) => {
        const full = loadSkillFull(s.name)
        return full ? { name: full.name, instructions: full.body } : null
      })
      .filter((x): x is { name: string; instructions: string } => x != null)
  }
  const set = new Set(allowedSkills)
  return enabled
    .filter((s) => set.has(s.name))
    .map((s) => {
      const full = loadSkillFull(s.name)
      return full ? { name: full.name, instructions: full.body } : null
    })
    .filter((x): x is { name: string; instructions: string } => x != null)
}

// ============ 导入发现 ============

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
