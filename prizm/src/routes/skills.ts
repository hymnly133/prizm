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
  createSkill,
  updateSkill,
  deleteSkill,
  importSkillsFromDir,
  discoverImportableSkillSources,
  listSkillResources,
  readSkillResource,
  activateSkill,
  deactivateSkill,
  getActiveSkills
} from '../llm/skillManager'

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

  // GET /skills/:name - 获取 skill 完整内容（Level 2）
  router.get('/skills/:name', (req: Request, res: Response) => {
    try {
      const name = ensureStringParam(req.params.name)
      const skill = loadSkillFull(name)
      if (!skill) {
        return res.status(404).json({ error: 'Skill not found' })
      }
      res.json(skill)
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

  // POST /skills/:name/activate - 手动激活 skill（会话级）
  router.post('/skills/:name/activate', (req: Request, res: Response) => {
    try {
      const name = ensureStringParam(req.params.name)
      const { scope, sessionId } = req.body ?? {}
      if (!scope || !sessionId) {
        return res.status(400).json({ error: 'scope and sessionId are required' })
      }

      const activation = activateSkill(scope, sessionId, name)
      if (!activation) {
        return res.status(404).json({ error: 'Skill not found' })
      }
      res.json(activation)
    } catch (error) {
      log.error('activate skill error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /skills/:name/deactivate - 取消激活
  router.post('/skills/:name/deactivate', (req: Request, res: Response) => {
    try {
      const name = ensureStringParam(req.params.name)
      const { scope, sessionId } = req.body ?? {}
      if (!scope || !sessionId) {
        return res.status(400).json({ error: 'scope and sessionId are required' })
      }

      const result = deactivateSkill(scope, sessionId, name)
      res.json({ deactivated: result })
    } catch (error) {
      log.error('deactivate skill error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /skills/active - 获取会话中已激活的 skills
  router.get('/skills/active', (req: Request, res: Response) => {
    try {
      const scope = typeof req.query.scope === 'string' ? req.query.scope : ''
      const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : ''
      if (!scope || !sessionId) {
        return res.status(400).json({ error: 'scope and sessionId query params are required' })
      }
      const active = getActiveSkills(scope, sessionId)
      res.json({ skills: active })
    } catch (error) {
      log.error('get active skills error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
