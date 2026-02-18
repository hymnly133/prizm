/**
 * Agent 自定义规则 CRUD API
 * 支持用户级（全局）和 Scope 级（工作区）两层规则管理
 * 支持自动扫描项目规则（CLAUDE.md / .cursor/rules 等）的列表和启用/禁用
 *
 * 路由：
 * - GET    /agent-rules              列出规则（query: level, scope）
 * - POST   /agent-rules              创建规则
 * - GET    /agent-rules/:id          获取规则详情（query: level, scope）
 * - PATCH  /agent-rules/:id          更新规则（query: level, scope）
 * - DELETE /agent-rules/:id          删除规则（query: level, scope）
 * - GET    /agent-rules/discovered   列出自动扫描发现的项目规则
 * - PATCH  /agent-rules/discovered/toggle  切换已发现规则的启用状态
 */

import type { Router, Request, Response } from 'express'
import { ensureStringParam } from '../scopeUtils'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  type RuleLevel,
  type CreateRuleInput,
  type UpdateRuleInput
} from '../llm/agentRulesManager'

const log = createLogger('AgentRules')

function extractLevel(req: Request): RuleLevel {
  const raw = (req.query.level as string) ?? (req.body?.level as string) ?? 'user'
  return raw === 'scope' ? 'scope' : 'user'
}

function extractScope(req: Request): string | undefined {
  return (req.query.scope as string) ?? (req.body?.scope as string) ?? undefined
}

export function createAgentRulesRoutes(router: Router): void {
  // GET /agent-rules - 列出规则
  router.get('/agent-rules', (req: Request, res: Response) => {
    try {
      const level = extractLevel(req)
      const scope = extractScope(req)
      const rules = listRules(level, scope)
      res.json({ rules })
    } catch (error) {
      log.error('list agent-rules error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /agent-rules - 创建规则
  router.post('/agent-rules', (req: Request, res: Response) => {
    try {
      const b = req.body
      if (!b || typeof b !== 'object') {
        return res.status(400).json({ error: 'Invalid request body' })
      }

      const id =
        typeof b.id === 'string' && b.id.trim()
          ? b.id
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9_-]/g, '-')
          : null
      if (!id) {
        return res.status(400).json({ error: 'id is required (kebab-case)' })
      }

      const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim() : null
      if (!title) {
        return res.status(400).json({ error: 'title is required' })
      }

      const level: RuleLevel = b.level === 'scope' ? 'scope' : 'user'
      const scope = typeof b.scope === 'string' ? b.scope : undefined

      if (level === 'scope' && !scope) {
        return res.status(400).json({ error: 'scope is required for scope-level rules' })
      }

      const input: CreateRuleInput = {
        id,
        title,
        content: typeof b.content === 'string' ? b.content : '',
        level,
        scope,
        enabled: b.enabled !== false,
        alwaysApply: b.alwaysApply === true,
        globs: Array.isArray(b.globs)
          ? b.globs.filter((s: unknown) => typeof s === 'string')
          : undefined,
        description: typeof b.description === 'string' ? b.description.trim() : undefined
      }

      const rule = createRule(input)
      res.status(201).json(rule)
    } catch (error) {
      log.error('create agent-rule error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent-rules/:id - 获取规则详情
  router.get('/agent-rules/:id', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const level = extractLevel(req)
      const scope = extractScope(req)

      const rule = getRule(id, level, scope)
      if (!rule) {
        return res.status(404).json({ error: 'Rule not found' })
      }
      res.json(rule)
    } catch (error) {
      log.error('get agent-rule error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PATCH /agent-rules/:id - 更新规则
  router.patch('/agent-rules/:id', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const level = extractLevel(req)
      const scope = extractScope(req)
      const b = req.body ?? {}

      const updates: UpdateRuleInput = {}
      if (typeof b.title === 'string') updates.title = b.title.trim()
      if (typeof b.content === 'string') updates.content = b.content
      if (typeof b.enabled === 'boolean') updates.enabled = b.enabled
      if (typeof b.alwaysApply === 'boolean') updates.alwaysApply = b.alwaysApply
      if (b.globs !== undefined) {
        updates.globs = Array.isArray(b.globs)
          ? b.globs.filter((s: unknown) => typeof s === 'string')
          : undefined
      }
      if (b.description !== undefined) {
        updates.description = typeof b.description === 'string' ? b.description.trim() : undefined
      }

      const updated = updateRule(id, level, scope, updates)
      if (!updated) {
        return res.status(404).json({ error: 'Rule not found' })
      }
      res.json(updated)
    } catch (error) {
      log.error('update agent-rule error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // DELETE /agent-rules/:id - 删除规则
  router.delete('/agent-rules/:id', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const level = extractLevel(req)
      const scope = extractScope(req)

      const deleted = deleteRule(id, level, scope)
      if (!deleted) {
        return res.status(404).json({ error: 'Rule not found' })
      }
      res.status(204).send()
    } catch (error) {
      log.error('delete agent-rule error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
