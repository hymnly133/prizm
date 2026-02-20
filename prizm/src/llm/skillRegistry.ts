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
import { getSkillsDir, createSkill, loadAllSkillMetadata } from './skillManager'
import type { SkillConfig, SkillMetadata } from './skillManager'

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
  source: 'github' | 'curated'
  htmlUrl?: string
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

// ============ Cache ============

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const cache = new Map<string, CacheEntry<unknown>>()
const CACHE_TTL_MS = 5 * 60 * 1000

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

// ============ Curated List ============

interface CuratedSkill {
  name: string
  description: string
  owner: string
  repo: string
  skillPath: string
  license?: string
  category?: string
}

const CURATED_SKILLS: CuratedSkill[] = [
  {
    name: 'code-review',
    description: 'Expert code review with quality, security, and maintainability analysis',
    owner: 'anthropics',
    repo: 'skills',
    skillPath: 'skills/code-review',
    license: 'Apache-2.0',
    category: 'Development'
  },
  {
    name: 'frontend-design',
    description: 'Frontend UI/UX design patterns and component implementation',
    owner: 'anthropics',
    repo: 'skills',
    skillPath: 'skills/frontend-design',
    license: 'Apache-2.0',
    category: 'Development'
  },
  {
    name: 'testing',
    description: 'Test-driven development with comprehensive test generation',
    owner: 'anthropics',
    repo: 'skills',
    skillPath: 'skills/testing',
    license: 'Apache-2.0',
    category: 'Development'
  },
  {
    name: 'documentation',
    description: 'Generate and maintain project documentation, READMEs, and API docs',
    owner: 'anthropics',
    repo: 'skills',
    skillPath: 'skills/documentation',
    license: 'Apache-2.0',
    category: 'Documentation'
  },
  {
    name: 'refactoring',
    description: 'Code refactoring, cleanup, and architecture improvement',
    owner: 'anthropics',
    repo: 'skills',
    skillPath: 'skills/refactoring',
    license: 'Apache-2.0',
    category: 'Development'
  },
  {
    name: 'security-review',
    description: 'Security vulnerability detection and remediation for code',
    owner: 'anthropics',
    repo: 'skills',
    skillPath: 'skills/security-review',
    license: 'Apache-2.0',
    category: 'Security'
  },
  {
    name: 'mcp-builder',
    description: 'Build Model Context Protocol servers and tools',
    owner: 'anthropics',
    repo: 'skills',
    skillPath: 'skills/mcp-builder',
    license: 'Apache-2.0',
    category: 'Tools'
  },
  {
    name: 'data-analysis',
    description: 'Data analysis, visualization, and statistical modeling',
    owner: 'anthropics',
    repo: 'skills',
    skillPath: 'skills/data-analysis',
    license: 'Apache-2.0',
    category: 'Data'
  },
  {
    name: 'pdf-processing',
    description: 'Extract text and tables from PDFs, fill forms, merge documents',
    owner: 'anthropics',
    repo: 'skills',
    skillPath: 'skills/pdf-processing',
    license: 'Apache-2.0',
    category: 'Tools'
  }
]

// ============ GitHub Search ============

async function githubFetch<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Prizm-SkillRegistry/1.0'
  }
  const token = process.env.GITHUB_TOKEN
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

    const result: RegistrySearchResult = {
      items,
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
 * Return curated/featured skills (no network required)
 */
export function getFeaturedSkills(): RegistrySkillItem[] {
  const installed = new Set(loadAllSkillMetadata().map((s) => s.name))

  return CURATED_SKILLS.map((s) => ({
    name: s.name,
    description: s.description,
    owner: s.owner,
    repo: s.repo,
    skillPath: s.skillPath,
    license: s.license,
    source: 'curated' as const,
    htmlUrl: `https://github.com/${s.owner}/${s.repo}/tree/main/${s.skillPath}`,
    installed: installed.has(s.name)
  }))
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
 * Download and install a skill from GitHub into .prizm-data/skills/
 */
export async function installSkillFromRegistry(
  owner: string,
  repo: string,
  skillPath: string
): Promise<SkillConfig> {
  const preview = await fetchSkillPreview(owner, repo, skillPath)
  if (!preview) {
    throw new Error(`Could not fetch SKILL.md from ${owner}/${repo}/${skillPath}`)
  }

  const existing = loadAllSkillMetadata()
  if (existing.some((s) => s.name === preview.name)) {
    throw new Error(`Skill "${preview.name}" already exists locally`)
  }

  const meta: SkillMetadata = {
    name: preview.name,
    description: preview.description,
    license: preview.license
  }

  const config = createSkill(meta, preview.body, 'github')

  // Also try downloading scripts/references/assets directories
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
        const token = process.env.GITHUB_TOKEN
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
