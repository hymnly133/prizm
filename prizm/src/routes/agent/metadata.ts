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
import { loadAllSkillMetadata, getActiveSkills } from '../../llm/skillManager'
import { loadRules, listDiscoveredRules } from '../../llm/rulesLoader'
import { loadActiveRules } from '../../llm/agentRulesManager'
import { loadAllCustomCommands } from '../../llm/customCommandLoader'
import { listSlashCommands } from '../../llm/slashCommandRegistry'
import { getAllToolMetadata } from '../../llm/toolMetadata'
import { getBuiltinTools } from '../../llm/builtinTools'
import { listAllUserProfiles, isMemoryEnabled } from '../../llm/EverMemService'
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

  // GET /agent/system-prompt — 尽可能还原真实发送给 LLM 的完整 system 内容
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

      // 加载 Skills（与 chat.ts 同逻辑）
      const activeSkills = sessionId ? getActiveSkills(scope, sessionId) : []
      const activeSkillInstructions =
        activeSkills.length > 0
          ? activeSkills.map((a) => ({ name: a.skillName, instructions: a.instructions }))
          : undefined

      // 加载 Rules
      let rulesContent: string | undefined
      try {
        rulesContent = loadRules() || undefined
      } catch {
        /* ignore */
      }
      let customRulesContent: string | undefined
      try {
        customRulesContent = loadActiveRules(scope) || undefined
      } catch {
        /* ignore */
      }

      const systemPrompt = await buildSystemPrompt({
        scope,
        sessionId,
        includeScopeContext: true,
        activeSkillInstructions,
        rulesContent,
        customRulesContent
      })

      // 加载用户画像（chat.ts 在 system prompt 之后单独注入）
      let profileSection = ''
      if (isMemoryEnabled()) {
        try {
          const profileMem = await listAllUserProfiles()
          if (profileMem.length > 0) {
            profileSection =
              '【用户画像 — 只读，由系统自动维护】\n' +
              profileMem.map((m) => `- ${m.memory}`).join('\n') +
              '\n\n严格遵守以上画像中的称呼和偏好。画像由记忆系统自动更新，不要为此创建文档。'
          }
        } catch {
          /* ignore */
        }
      }

      // 工具列表摘要（tools 参数通过 function calling 接口单独传递，不在 system message 中）
      const tools = getBuiltinTools()
      const toolsSummary =
        `## 工具列表（共 ${tools.length} 个，通过 function calling 接口传递）\n` +
        tools
          .map((t) => {
            const fn = t.function
            const params = fn.parameters as { required?: string[] } | undefined
            const required = params?.required ?? []
            return `- \`${fn.name}\`${required.length ? `(${required.join(', ')})` : ''}: ${
              fn.description?.slice(0, 60) ?? ''
            }…`
          })
          .join('\n')

      // 拼接完整预览
      const sections = [systemPrompt]
      if (profileSection) sections.push(profileSection)
      sections.push(toolsSummary)
      const fullPreview = sections.join('\n\n---\n\n')

      res.json({ systemPrompt: fullPreview, scope, sessionId: sessionId ?? null })
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
