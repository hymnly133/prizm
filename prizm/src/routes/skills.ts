/**
 * Skills CRUD API
 * 管理 .prizm-data/skills/ 中的 Agent Skills
 * 兼容 Anthropic Agent Skills 开放规范 (agentskills.io/specification)
 */

import type { Router, Request, Response } from 'express'
import { ensureStringParam } from '../scopeUtils'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import {
  loadAllSkillMetadata,
  loadSkillFull,
  getSkillFileTree,
  createSkill,
  updateSkill,
  deleteSkill,
  importSkillsFromDir,
  discoverImportableSkillSources,
  listSkillResources,
  readSkillResource
} from '../llm/skillManager'
import {
  searchRegistrySkills,
  getFeaturedSkillsAsync,
  listCollectionSkills,
  searchSkillKit,
  searchSkillsMP,
  fetchSkillPreview,
  installSkillFromRegistry
} from '../llm/skillRegistry'

const log = createLogger('Skills')

export function createSkillsRoutes(router: Router): void {
  // GET /skills - 列出所有 skill 元数据（Level 1）
  router.get('/skills', (_req: Request, res: Response) => {
    try {
      const skills = loadAllSkillMetadata()
      res.json({ skills })
    } catch (error) {
      log.error('list skills error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /skills - 创建 skill
  router.post('/skills', (req: Request, res: Response) => {
    try {
      const b = req.body
      if (!b || typeof b !== 'object') {
        return res.status(400).json({ error: 'Invalid request body' })
      }

      const name =
        typeof b.name === 'string' && b.name.trim()
          ? b.name
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, '-')
          : null
      const description = typeof b.description === 'string' ? b.description.trim() : null

      if (!name || !description) {
        return res.status(400).json({ error: 'name and description are required' })
      }

      const body = typeof b.body === 'string' ? b.body : ''

      const skill = createSkill(
        {
          name,
          description,
          license: typeof b.license === 'string' ? b.license : undefined,
          compatibility: typeof b.compatibility === 'string' ? b.compatibility : undefined,
          metadata: b.metadata && typeof b.metadata === 'object' ? b.metadata : undefined,
          allowedTools: Array.isArray(b.allowedTools) ? b.allowedTools : undefined
        },
        body
      )

      res.status(201).json(skill)
    } catch (error) {
      log.error('create skill error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /skills/:name - 获取 skill 完整内容（Level 2）+ path 与 fileTree
  router.get('/skills/:name', (req: Request, res: Response) => {
    try {
      const name = ensureStringParam(req.params.name)
      const skill = loadSkillFull(name)
      if (!skill) {
        return res.status(404).json({ error: 'Skill not found' })
      }
      const fileTree = getSkillFileTree(name)
      res.json({ ...skill, fileTree: fileTree ?? undefined })
    } catch (error) {
      log.error('get skill error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PATCH /skills/:name - 更新 skill
  router.patch('/skills/:name', (req: Request, res: Response) => {
    try {
      const name = ensureStringParam(req.params.name)
      const b = req.body ?? {}
      const updated = updateSkill(name, {
        description: typeof b.description === 'string' ? b.description : undefined,
        body: typeof b.body === 'string' ? b.body : undefined,
        enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined
      })
      if (!updated) {
        return res.status(404).json({ error: 'Skill not found' })
      }
      res.json(updated)
    } catch (error) {
      log.error('update skill error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // DELETE /skills/:name - 删除 skill
  router.delete('/skills/:name', (req: Request, res: Response) => {
    try {
      const name = ensureStringParam(req.params.name)
      const deleted = deleteSkill(name)
      if (!deleted) {
        return res.status(404).json({ error: 'Skill not found' })
      }
      res.status(204).send()
    } catch (error) {
      log.error('delete skill error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /skills/:name/resources - 列出 skill 的资源文件（Level 3）
  router.get('/skills/:name/resources', (req: Request, res: Response) => {
    try {
      const name = ensureStringParam(req.params.name)
      const resources = listSkillResources(name)
      res.json(resources)
    } catch (error) {
      log.error('list skill resources error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /skills/:name/resources/*splat - 读取 skill 资源文件（支持嵌套路径）
  router.get('/skills/:name/resources/*splat', (req: Request, res: Response) => {
    try {
      const name = ensureStringParam(req.params.name)
      const raw = (req.params as Record<string, unknown>).splat
      const resourcePath = Array.isArray(raw) ? raw.join('/') : String(raw ?? '')
      if (!resourcePath) {
        return res.status(400).json({ error: 'resource path is required' })
      }
      const content = readSkillResource(name, resourcePath)
      if (content === null) {
        return res.status(404).json({ error: 'Resource not found' })
      }
      res.type('text/plain').send(content)
    } catch (error) {
      log.error('read skill resource error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /skills/import - 导入 skills
  router.post('/skills/import', (req: Request, res: Response) => {
    try {
      const { source, path: customPath } = req.body ?? {}
      if (!source || !['claude-code', 'github'].includes(source)) {
        return res.status(400).json({ error: 'source must be "claude-code" or "github"' })
      }

      let importDir: string
      if (typeof customPath === 'string' && customPath.trim()) {
        importDir = customPath.trim()
      } else if (source === 'claude-code') {
        importDir = require('path').join(process.cwd(), '.claude', 'skills')
      } else {
        return res.status(400).json({ error: 'path is required for github source' })
      }

      const imported = importSkillsFromDir(importDir, source)
      res.json({ imported: imported.length, skills: imported })
    } catch (error) {
      log.error('import skills error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /skills/discover - 发现可导入的 skill 源
  router.get('/skills/discover', (_req: Request, res: Response) => {
    try {
      const sources = discoverImportableSkillSources()
      res.json({ sources })
    } catch (error) {
      log.error('discover skills error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // ============ Registry Routes ============

  // GET /skills/registry/search?q=<query>&page=1
  router.get('/skills/registry/search', async (req: Request, res: Response) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : ''
      const page =
        typeof req.query.page === 'string' ? Math.max(1, parseInt(req.query.page, 10) || 1) : 1
      const result = await searchRegistrySkills(q, { page })
      res.json(result)
    } catch (error) {
      log.error('registry search error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /skills/registry/featured
  router.get('/skills/registry/featured', async (_req: Request, res: Response) => {
    try {
      const skills = await getFeaturedSkillsAsync()
      res.json({ skills })
    } catch (error) {
      log.error('registry featured error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /skills/registry/skillsmp/search?q=&limit=&page=
  router.get('/skills/registry/skillsmp/search', async (req: Request, res: Response) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : ''
      const limit =
        typeof req.query.limit === 'string'
          ? Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20))
          : 20
      const page =
        typeof req.query.page === 'string' ? Math.max(1, parseInt(req.query.page, 10) || 1) : 1
      const result = await searchSkillsMP(q, { limit, page })
      res.json(result)
    } catch (error) {
      log.error('skillsmp search error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /skills/registry/skillkit/search?q=&limit=
  router.get('/skills/registry/skillkit/search', async (req: Request, res: Response) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : ''
      const limit =
        typeof req.query.limit === 'string'
          ? Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20))
          : 20
      const result = await searchSkillKit(q, { limit })
      res.json(result)
    } catch (error) {
      log.error('skillkit search error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /skills/registry/collection?owner=&repo=&path=
  router.get('/skills/registry/collection', async (req: Request, res: Response) => {
    try {
      const owner = typeof req.query.owner === 'string' ? req.query.owner : ''
      const repo = typeof req.query.repo === 'string' ? req.query.repo : ''
      const path = typeof req.query.path === 'string' ? req.query.path : 'skills'
      if (!owner || !repo) {
        return res.status(400).json({ error: 'owner and repo are required' })
      }
      const skills = await listCollectionSkills(owner, repo, path)
      res.json({ skills })
    } catch (error) {
      log.error('registry collection error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /skills/registry/preview?owner=&repo=&path=
  router.get('/skills/registry/preview', async (req: Request, res: Response) => {
    try {
      const owner = typeof req.query.owner === 'string' ? req.query.owner : ''
      const repo = typeof req.query.repo === 'string' ? req.query.repo : ''
      const skillPath = typeof req.query.path === 'string' ? req.query.path : ''
      if (!owner || !repo || !skillPath) {
        return res.status(400).json({ error: 'owner, repo, and path are required' })
      }
      const preview = await fetchSkillPreview(owner, repo, skillPath)
      if (!preview) {
        return res.status(404).json({ error: 'SKILL.md not found in repository' })
      }
      res.json(preview)
    } catch (error) {
      log.error('registry preview error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /skills/registry/install
  router.post('/skills/registry/install', async (req: Request, res: Response) => {
    try {
      const { owner, repo, skillPath, source } = req.body ?? {}
      if (typeof owner !== 'string' || typeof repo !== 'string' || typeof skillPath !== 'string') {
        return res.status(400).json({ error: 'owner, repo, and skillPath are required' })
      }
      const validSource =
        typeof source === 'string' && ['github', 'curated', 'skillkit', 'skillsmp'].includes(source)
          ? (source as 'github' | 'curated' | 'skillkit' | 'skillsmp')
          : undefined
      const skill = await installSkillFromRegistry(owner, repo, skillPath, validSource ?? 'github')
      res.status(201).json(skill)
    } catch (error) {
      log.error('registry install error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
