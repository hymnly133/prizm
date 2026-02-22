/**
 * Skill Registry — GitHub-based skill search and install
 *
 * Provides:
 * - searchRegistrySkills()  — GitHub Code Search for SKILL.md repos
 * - getFeaturedSkills()     — curated list of known skill repos
 * - fetchSkillPreview()     — download a single SKILL.md for preview
 * - installSkillFromRegistry() — download + install into .prizm-data/skills/
 */

import fs from 'fs'
import path from 'path'
import { createLogger } from '../logger'
import { getConfig } from '../config'
import { getEffectiveServerConfig } from '../settings/serverConfigStore'
import { getSkillsMPSettings } from '../settings/agentToolsStore'
import { createSkill, getInstalledRegistryKeys, loadAllSkillMetadata } from './skillManager'
import type { SkillConfig, SkillMetadata } from './skillManager'
import { getRegistryKey } from './skillRegistryKey'
import { ConflictError } from '../errors'

const log = createLogger('SkillRegistry')

// ============ Types ============

export interface RegistrySkillItem {
  name: string
  description: string
  owner: string
  repo: string
  /** Path within the repo (e.g. "skills/code-review") */
  skillPath: string
  stars?: number
  license?: string
  source: 'github' | 'curated' | 'skillkit' | 'skillsmp'
  htmlUrl?: string
  /** Set by server when returning featured/collection list */
  installed?: boolean
  /** SkillKit relevance score 0–100 (only when source === 'skillkit') */
  score?: number
  /** 来源唯一键，用于区分同名不同源；服务端构造列表时填充 */
  registryKey?: string
}

/** 为条目计算 registryKey */
function itemRegistryKey(item: {
  source: string
  owner: string
  repo: string
  skillPath: string
}): string {
  return getRegistryKey({
    source: item.source,
    owner: item.owner,
    repo: item.repo,
    skillPath: item.skillPath
  })
}

/** 已安装判断：优先按 registryKey，无 key 或旧数据时按 name 回退 */
function markInstalled(
  list: RegistrySkillItem[],
  installedKeys: Set<string>,
  installedNames: Set<string>
): RegistrySkillItem[] {
  return list.map((s) => {
    const key = itemRegistryKey(s)
    const byKey = installedKeys.has(key)
    const byName = installedNames.has(s.name)
    return {
      ...s,
      registryKey: key,
      installed: byKey || byName
    }
  })
}

export interface RegistrySearchResult {
  items: RegistrySkillItem[]
  totalCount: number
  query: string
}

interface GitHubSearchCodeItem {
  name: string
  path: string
  html_url: string
  repository: {
    full_name: string
    owner: { login: string }
    name: string
    description: string | null
    stargazers_count: number
    license: { spdx_id: string } | null
  }
}

interface GitHubSearchResponse {
  total_count: number
  items: GitHubSearchCodeItem[]
}

/** GitHub API: Get repository contents (list directory) */
interface GitHubContentsItem {
  name: string
  path: string
  sha: string
  size: number
  url: string
  html_url: string
  type: 'dir' | 'file'
}

/** SkillKit REST API search response (skillkit.sh/api) */
interface SkillKitSearchSkill {
  name: string
  description: string
  source: string
  tags?: string[]
  score?: number
}
interface SkillKitSearchResponse {
  skills: SkillKitSearchSkill[]
  total: number
  query: string
  limit: number
}

/** SkillsMP API 搜索单项（兼容多种返回结构） */
interface SkillsMPSkillItem {
  name?: string
  description?: string
  repo?: string
  full_name?: string
  path?: string
  skill_path?: string
  repository?: { full_name?: string; name?: string; owner?: { login?: string } }
  html_url?: string
}
interface SkillsMPSearchResponse {
  data?: { skills?: SkillsMPSkillItem[]; total?: number }
  skills?: SkillsMPSkillItem[]
  total?: number
}

// ============ Cache ============

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const cache = new Map<string, CacheEntry<unknown>>()
const CACHE_TTL_MS = 5 * 60 * 1000

function getSkillKitApiBase(): string {
  if (typeof process === 'undefined') return 'https://skillkit.sh/api'
  const url =
    getEffectiveServerConfig(getConfig().dataDir).skills?.skillKitApiUrl?.trim() ||
    process.env?.PRIZM_SKILLKIT_API_URL?.trim()
  return url || 'https://skillkit.sh/api'
}

function getGitHubToken(): string | undefined {
  if (typeof process === 'undefined') return undefined
  return (
    getEffectiveServerConfig(getConfig().dataDir).skills?.githubToken?.trim() ||
    process.env.GITHUB_TOKEN?.trim()
  )
}

function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.data as T
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

// ============ GitHub API ============

async function githubFetch<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Prizm-SkillRegistry/1.0'
  }
  const token = getGitHubToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`GitHub API ${response.status}: ${text.slice(0, 200)}`)
  }

  return response.json() as Promise<T>
}

/**
 * Search GitHub for public repos containing SKILL.md files
 */
export async function searchRegistrySkills(
  query: string,
  options?: { page?: number; perPage?: number }
): Promise<RegistrySearchResult> {
  const q = query.trim()
  if (!q) {
    return { items: [], totalCount: 0, query: '' }
  }

  const cacheKey = `search:${q}:${options?.page ?? 1}`
  const cached = getCached<RegistrySearchResult>(cacheKey)
  if (cached) return cached

  const perPage = Math.min(options?.perPage ?? 20, 30)
  const page = options?.page ?? 1

  const searchQuery = encodeURIComponent(`${q} filename:SKILL.md`)
  const url = `https://api.github.com/search/code?q=${searchQuery}&per_page=${perPage}&page=${page}`

  try {
    const data = await githubFetch<GitHubSearchResponse>(url)

    const items: RegistrySkillItem[] = data.items.map((item) => {
      const skillDir = item.path.replace(/\/SKILL\.md$/, '') || item.repository.name
      const name = skillDir.split('/').pop() || item.repository.name
      return {
        name,
        description: item.repository.description || `Skill from ${item.repository.full_name}`,
        owner: item.repository.owner.login,
        repo: item.repository.name,
        skillPath: skillDir,
        stars: item.repository.stargazers_count,
        license: item.repository.license?.spdx_id,
        source: 'github' as const,
        htmlUrl: item.html_url
      }
    })

    const installedKeys = getInstalledRegistryKeys()
    const installedNames = new Set(loadAllSkillMetadata().map((s) => s.name))
    const itemsWithInstalled = markInstalled(items, installedKeys, installedNames)

    const result: RegistrySearchResult = {
      items: itemsWithInstalled,
      totalCount: data.total_count,
      query: q
    }

    setCache(cacheKey, result)
    return result
  } catch (err) {
    log.error('GitHub search failed: %s', err)
    throw err
  }
}

/**
 * Fetch featured skills by listing a collection repo path via GitHub API and parsing each SKILL.md.
 * Default collection: anthropics/skills, path=skills.
 */
export async function fetchFeaturedSkillsFromCollection(
  owner: string = 'anthropics',
  repo: string = 'skills',
  path: string = 'skills'
): Promise<RegistrySkillItem[]> {
  const cacheKey = `collection:${owner}/${repo}/${path}`
  const cached = getCached<RegistrySkillItem[]>(cacheKey)
  if (cached) return cached

  const branches = ['main', 'master']
  let contents: GitHubContentsItem[] = []

  for (const branch of branches) {
    try {
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`
      const data = await githubFetch<GitHubContentsItem[]>(url)
      if (!Array.isArray(data)) continue
      contents = data
      break
    } catch {
      continue
    }
  }

  if (contents.length === 0) return []

  const dirs = contents.filter((item) => item.type === 'dir')
  const items: RegistrySkillItem[] = []

  for (const dir of dirs) {
    const skillPath = path ? `${path}/${dir.name}` : dir.name
    const preview = await fetchSkillPreview(owner, repo, skillPath)
    if (!preview) continue
    items.push({
      name: preview.name,
      description: preview.description,
      owner,
      repo,
      skillPath,
      license: preview.license,
      source: 'curated',
      htmlUrl: `https://github.com/${owner}/${repo}/tree/main/${skillPath}`
    })
  }

  setCache(cacheKey, items)
  return items
}

/**
 * Return featured skills (dynamic fetch from default collection repo, with cache).
 */
export async function getFeaturedSkillsAsync(): Promise<RegistrySkillItem[]> {
  const cacheKey = 'featured:list'
  const raw = getCached<RegistrySkillItem[]>(cacheKey)
  const installedKeys = getInstalledRegistryKeys()
  const installedNames = new Set(loadAllSkillMetadata().map((s) => s.name))
  const addInstalled = (list: RegistrySkillItem[]): RegistrySkillItem[] =>
    markInstalled(list, installedKeys, installedNames)

  if (raw) return addInstalled(raw)

  try {
    const list = await fetchFeaturedSkillsFromCollection('anthropics', 'skills', 'skills')
    setCache(cacheKey, list)
    return addInstalled(list)
  } catch (err) {
    log.error('Featured skills fetch failed: %s', err)
    return []
  }
}

/**
 * List all skills in a collection repo (owner/repo/path). Uses same fetch+cache as featured.
 */
export async function listCollectionSkills(
  owner: string,
  repo: string,
  path: string = 'skills'
): Promise<RegistrySkillItem[]> {
  const list = await fetchFeaturedSkillsFromCollection(owner, repo, path)
  const installedKeys = getInstalledRegistryKeys()
  const installedNames = new Set(loadAllSkillMetadata().map((s) => s.name))
  return markInstalled(list, installedKeys, installedNames)
}

// ============ SkillKit (built-in source) ============

/**
 * Search SkillKit marketplace (hosted API at skillkit.sh/api). Returns items compatible with
 * install via existing installSkillFromRegistry(owner, repo, skillPath).
 */
export async function searchSkillKit(
  query: string,
  options?: { limit?: number }
): Promise<RegistrySearchResult> {
  const q = query.trim()
  const limit = Math.min(options?.limit ?? 20, 50)
  const cacheKey = `skillkit:${q}:${limit}`
  const cached = getCached<RegistrySearchResult>(cacheKey)
  if (cached) return cached

  const url = `${getSkillKitApiBase().replace(/\/+$/, '')}/search?q=${encodeURIComponent(
    q
  )}&limit=${limit}`
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Prizm-SkillRegistry/1.0' },
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) {
      log.warn(
        'SkillKit API unavailable (status %s): %s. Set PRIZM_SKILLKIT_API_URL to a running skillkit serve (e.g. http://localhost:3737) or skip.',
        response.status,
        (await response.text().catch(() => '')).slice(0, 120)
      )
      return { items: [], totalCount: 0, query: q }
    }
    const data = (await response.json()) as SkillKitSearchResponse

    const items: RegistrySkillItem[] = (data.skills ?? []).map((skill) => {
      const parts = (skill.source || '').split('/').filter(Boolean)
      const owner = parts[0] || 'unknown'
      const repo = parts[1] || 'skills'
      const skillPath = parts.length >= 2 ? `skills/${skill.name}` : skill.name
      const htmlUrl =
        parts.length >= 2 ? `https://github.com/${owner}/${repo}/tree/main/${skillPath}` : undefined
      return {
        name: skill.name,
        description: skill.description || '',
        owner,
        repo,
        skillPath,
        source: 'skillkit' as const,
        htmlUrl,
        score: skill.score
      }
    })

    const installedKeys = getInstalledRegistryKeys()
    const installedNames = new Set(loadAllSkillMetadata().map((s) => s.name))
    const itemsWithInstalled = markInstalled(items, installedKeys, installedNames)

    const result: RegistrySearchResult = {
      items: itemsWithInstalled,
      totalCount: typeof data.total === 'number' ? data.total : items.length,
      query: data.query ?? q
    }
    setCache(cacheKey, result)
    return result
  } catch (err) {
    log.warn(
      'SkillKit search failed (network or timeout): %s. Set PRIZM_SKILLKIT_API_URL to http://localhost:3737 after running "npx skillkit serve".',
      err
    )
    return { items: [], totalCount: 0, query: q }
  }
}

// ============ SkillsMP (built-in source, requires API Key) ============

const SKILLSMP_API_BASE = 'https://skillsmp.com'

/**
 * Search SkillsMP marketplace. Requires API Key in settings (Agent 工具设置 → SkillsMP).
 */
export async function searchSkillsMP(
  query: string,
  options?: { limit?: number; page?: number }
): Promise<RegistrySearchResult> {
  const q = query.trim()
  const limit = Math.min(options?.limit ?? 20, 100)
  const page = Math.max(1, options?.page ?? 1)
  const settings = getSkillsMPSettings()
  const apiKey = settings?.apiKey?.trim()
  if (!apiKey) {
    log.warn('SkillsMP API Key not configured; skip search')
    return { items: [], totalCount: 0, query: q }
  }

  const cacheKey = `skillsmp:${q}:${page}:${limit}`
  const cached = getCached<RegistrySearchResult>(cacheKey)
  if (cached) return cached

  const url = `${SKILLSMP_API_BASE}/api/v1/skills/search?q=${encodeURIComponent(
    q
  )}&page=${page}&limit=${limit}`
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'Prizm-SkillRegistry/1.0'
      },
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      log.warn('SkillsMP API error %s: %s', response.status, text.slice(0, 150))
      return { items: [], totalCount: 0, query: q }
    }
    const data = (await response.json()) as SkillsMPSearchResponse
    const rawSkills = data.data?.skills ?? data.skills ?? []
    const total = data.data?.total ?? data.total ?? rawSkills.length

    const items: RegistrySkillItem[] = rawSkills
      .map((skill) => {
        const name = skill.name ?? skill.path ?? skill.skill_path ?? 'unknown'
        const description = skill.description ?? ''
        let owner = 'unknown'
        let repo = 'skills'
        let skillPath = name
        const repoFull = skill.repository?.full_name ?? skill.full_name ?? skill.repo
        if (repoFull && typeof repoFull === 'string') {
          const parts = repoFull.split('/').filter(Boolean)
          if (parts.length >= 2) {
            owner = parts[0]
            repo = parts[1]
            skillPath = skill.path ?? skill.skill_path ?? `skills/${name}`
          }
        }
        const htmlUrl =
          skill.html_url ??
          (owner !== 'unknown'
            ? `https://github.com/${owner}/${repo}/tree/main/${skillPath}`
            : undefined)
        return {
          name,
          description,
          owner,
          repo,
          skillPath,
          source: 'skillsmp' as const,
          htmlUrl
        }
      })
      .filter((s) => s.name !== 'unknown')

    const installedKeys = getInstalledRegistryKeys()
    const installedNames = new Set(loadAllSkillMetadata().map((s) => s.name))
    const itemsWithInstalled = markInstalled(items, installedKeys, installedNames)

    const result: RegistrySearchResult = { items: itemsWithInstalled, totalCount: total, query: q }
    setCache(cacheKey, result)
    return result
  } catch (err) {
    log.warn('SkillsMP search failed: %s', err)
    return { items: [], totalCount: 0, query: q }
  }
}

/**
 * Download a SKILL.md from GitHub for preview (without installing)
 */
export async function fetchSkillPreview(
  owner: string,
  repo: string,
  skillPath: string
): Promise<{ name: string; description: string; body: string; license?: string } | null> {
  const cacheKey = `preview:${owner}/${repo}/${skillPath}`
  const cached = getCached<{ name: string; description: string; body: string; license?: string }>(
    cacheKey
  )
  if (cached) return cached

  const branches = ['main', 'master']
  for (const branch of branches) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${skillPath}/SKILL.md`
    try {
      const response = await fetch(rawUrl, {
        headers: { 'User-Agent': 'Prizm-SkillRegistry/1.0' },
        signal: AbortSignal.timeout(10000)
      })
      if (!response.ok) continue

      const content = await response.text()
      const parsed = parseSkillMdLight(content)
      if (!parsed) continue

      const result = {
        name: parsed.name,
        description: parsed.description,
        body: parsed.body,
        license: parsed.license
      }
      setCache(cacheKey, result)
      return result
    } catch {
      continue
    }
  }

  return null
}

/**
 * Download and install a skill from registry into .prizm-data/skills/.
 * @param source 安装来源，用于持久化 origin 与已安装判断（默认 'github'）
 */
export async function installSkillFromRegistry(
  owner: string,
  repo: string,
  skillPath: string,
  source: 'github' | 'curated' | 'skillkit' | 'skillsmp' = 'github'
): Promise<SkillConfig> {
  const preview = await fetchSkillPreview(owner, repo, skillPath)
  if (!preview) {
    throw new Error(`Could not fetch SKILL.md from ${owner}/${repo}/${skillPath}`)
  }

  const registryKey = getRegistryKey({ source, owner, repo, skillPath })
  const installedKeys = getInstalledRegistryKeys()
  const existing = loadAllSkillMetadata()

  if (installedKeys.has(registryKey)) {
    const installed = existing.find((s) => s.origin && getRegistryKey(s.origin) === registryKey)
    if (installed) {
      log.info('Skill already installed from registry: %s', registryKey)
      return installed
    }
  }

  const sameName = existing.find((s) => s.name === preview.name)
  if (sameName) {
    const from =
      sameName.origin != null
        ? `${sameName.origin.source}:${sameName.origin.owner}/${sameName.origin.repo}:${sameName.origin.skillPath}`
        : '本地'
    throw new ConflictError(
      `已存在同名 skill「${preview.name}」（来自 ${from}）。如需安装另一来源，请先删除或重命名现有 skill。`
    )
  }

  const meta: SkillMetadata = {
    name: preview.name,
    description: preview.description,
    license: preview.license
  }
  const origin = { source, owner, repo, skillPath }
  const config = createSkill(meta, preview.body, source, origin)

  await downloadSkillResources(owner, repo, skillPath, config.path)

  log.info('Installed skill from registry: %s/%s/%s -> %s', owner, repo, skillPath, preview.name)
  return config
}

// ============ Helpers ============

/**
 * Lightweight SKILL.md parser (extracts name, description, body, license)
 */
function parseSkillMdLight(
  raw: string
): { name: string; description: string; body: string; license?: string } | null {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('---')) {
    return null
  }

  const endIdx = trimmed.indexOf('---', 3)
  if (endIdx < 0) return null

  const yamlBlock = trimmed.slice(3, endIdx).trim()
  const body = trimmed.slice(endIdx + 3).trim()

  let name = ''
  let description = ''
  let license = ''

  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line
      .slice(colonIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '')

    if (key === 'name') name = value
    else if (key === 'description') description = value
    else if (key === 'license') license = value
  }

  if (!name || !description) return null
  return { name, description, body, license: license || undefined }
}

/**
 * Best-effort download of scripts/ references/ assets/ from GitHub
 */
async function downloadSkillResources(
  owner: string,
  repo: string,
  skillPath: string,
  localSkillDir: string
): Promise<void> {
  const branches = ['main', 'master']

  for (const subDir of ['scripts', 'references', 'assets']) {
    for (const branch of branches) {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${skillPath}/${subDir}?ref=${branch}`
      try {
        const token = getGitHubToken()
        const headers: Record<string, string> = {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Prizm-SkillRegistry/1.0'
        }
        if (token) headers.Authorization = `Bearer ${token}`

        const resp = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(10000) })
        if (!resp.ok) continue

        const files = (await resp.json()) as Array<{
          name: string
          download_url: string | null
          type: string
        }>

        if (!Array.isArray(files)) continue

        const destDir = path.join(localSkillDir, subDir)
        fs.mkdirSync(destDir, { recursive: true })

        for (const file of files) {
          if (file.type !== 'file' || !file.download_url) continue
          try {
            const fileResp = await fetch(file.download_url, {
              signal: AbortSignal.timeout(10000)
            })
            if (fileResp.ok) {
              const content = await fileResp.text()
              fs.writeFileSync(path.join(destDir, file.name), content, 'utf-8')
            }
          } catch {
            log.warn('Failed to download resource: %s/%s', subDir, file.name)
          }
        }
        break
      } catch {
        continue
      }
    }
  }
}
