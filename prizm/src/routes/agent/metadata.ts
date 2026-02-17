/**
 * Agent 元数据路由 - 工具元数据、scope 上下文、系统提示词、scope 引用项、命令、能力
 */

import type { Router, Request, Response } from 'express'
import { toErrorResponse } from '../../errors'
import { hasScopeAccess } from '../../scopeUtils'
import { buildScopeContextSummary } from '../../llm/scopeContext'
import { buildSystemPrompt } from '../../llm/systemPrompt'
import { listRefItems } from '../../llm/scopeItemRegistry'
import { listAtReferences, registerBuiltinAtReferences } from '../../llm/atReferenceRegistry'
import { registerBuiltinSlashCommands } from '../../llm/slashCommands'
import { loadAllSkillMetadata } from '../../llm/skillManager'
import { listDiscoveredRules } from '../../llm/rulesLoader'
import { loadAllCustomCommands } from '../../llm/customCommandLoader'
import { listSlashCommands } from '../../llm/slashCommandRegistry'
import { getAllToolMetadata } from '../../llm/toolMetadata'
import { log, getScopeFromQuery } from './_shared'

export function registerMetadataRoutes(router: Router): void {
  // GET /agent/tools/metadata
  router.get('/agent/tools/metadata', async (_req: Request, res: Response) => {
    try {
      const metadata = getAllToolMetadata()
      res.json({ tools: metadata })
    } catch (error) {
      log.error('get tool metadata error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/debug/scope-context
  router.get('/agent/debug/scope-context', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const summary = await buildScopeContextSummary(scope)
      res.json({ summary, scope })
    } catch (error) {
      log.error('get scope context error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/system-prompt
  router.get('/agent/system-prompt', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const sessionId =
        typeof req.query.sessionId === 'string' && req.query.sessionId.trim()
          ? req.query.sessionId.trim()
          : undefined
      const systemPrompt = await buildSystemPrompt({
        scope,
        sessionId,
        includeScopeContext: true
      })
      res.json({ systemPrompt, scope, sessionId: sessionId ?? null })
    } catch (error) {
      log.error('get system prompt error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/scope-items
  router.get('/agent/scope-items', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      registerBuiltinAtReferences()
      const refTypes = listAtReferences().map((d) => ({
        key: d.key,
        label: d.label,
        aliases: d.aliases ?? []
      }))
      const items = listRefItems(scope)
      res.json({ refTypes, items })
    } catch (error) {
      log.error('get scope-items error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/slash-commands
  router.get('/agent/slash-commands', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      registerBuiltinSlashCommands()
      const commands = listSlashCommands().map((c) => ({
        name: c.name,
        aliases: c.aliases ?? [],
        description: c.description,
        builtin: c.builtin,
        mode: c.mode ?? 'action'
      }))
      res.json({ commands })
    } catch (error) {
      log.error('get slash-commands error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/capabilities
  router.get('/agent/capabilities', async (_req: Request, res: Response) => {
    try {
      registerBuiltinSlashCommands()
      const slashCommands = listSlashCommands().map((c) => ({
        name: c.name,
        aliases: c.aliases ?? [],
        description: c.description,
        builtin: c.builtin,
        mode: c.mode ?? 'action'
      }))
      const customCommands = loadAllCustomCommands().map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        mode: c.mode,
        source: c.source,
        enabled: c.enabled
      }))
      const skills = loadAllSkillMetadata().map((s) => ({
        name: s.name,
        description: s.description,
        enabled: s.enabled,
        source: s.source
      }))
      const rules = listDiscoveredRules()
      const metadata = getAllToolMetadata()
      res.json({
        builtinTools: metadata,
        slashCommands,
        customCommands,
        skills,
        rules
      })
    } catch (error) {
      log.error('get capabilities error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
