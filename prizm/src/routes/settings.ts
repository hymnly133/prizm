/**
 * Agent 工具设置 API
 * 统一管理内置工具（Tavily）与 MCP 服务器配置
 */

import type { Router, Request, Response } from 'express'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import {
  loadAgentTools,
  saveAgentTools,
  getTavilySettings,
  updateTavilySettings,
  getSkillsMPSettings,
  updateSkillsMPSettings,
  updateAgentLLMSettings,
  updateCommandsSettings,
  updateSkillsSettings,
  updateRulesSettings,
  updateTerminalSettings,
  getToolGroupConfig,
  updateToolGroupConfig
} from '../settings/agentToolsStore'
import {
  getUserProfile,
  updateUserProfile,
  type UserProfileEntry
} from '../settings/userProfileStore'
import {
  loadServerConfig,
  saveServerConfig,
  getEffectiveServerConfig,
  sanitizeServerConfig
} from '../settings/serverConfigStore'
import type { ServerConfig } from '../settings/serverConfigTypes'
import { getConfig, resetConfig } from '../config'
import { getAvailableModels, resetLLMProvider, clearModelCache } from '../llm'
import { getAvailableShells } from '../terminal/shellDetector'
import type {
  AgentToolsSettings,
  TavilySettings,
  SkillsMPSettings,
  AgentLLMSettings,
  CommandsSettings,
  SkillsSettings,
  RulesSettings,
  TerminalSettings,
  ToolGroupConfig
} from '../settings/types'
import { resolveGroupStates } from '../llm/builtinTools/toolGroups'

const log = createLogger('Settings')

function omit<T extends Record<string, unknown>>(obj: T, keys: string[]): T {
  const out = { ...obj }
  for (const k of keys) {
    delete (out as Record<string, unknown>)[k]
  }
  return out
}

/** 脱敏：Tavily / SkillsMP apiKey 不返回原文，仅标记 configured */
function sanitizeForGet(settings: AgentToolsSettings): AgentToolsSettings {
  const out = { ...settings }
  if (out.builtin?.tavily) {
    out.builtin = { ...out.builtin }
    out.builtin.tavily = { ...out.builtin.tavily }
    if (out.builtin.tavily.apiKey) {
      ;(out.builtin.tavily as { apiKey?: string; configured?: boolean }).apiKey = undefined
      ;(out.builtin.tavily as { configured?: boolean }).configured = true
    }
  }
  if (out.builtin?.skillsmp) {
    out.builtin = out.builtin ?? {}
    out.builtin.skillsmp = { ...out.builtin.skillsmp }
    if (out.builtin.skillsmp.apiKey) {
      ;(out.builtin.skillsmp as { apiKey?: string; configured?: boolean }).apiKey = undefined
      ;(out.builtin.skillsmp as { configured?: boolean }).configured = true
    }
  }
  return out
}

export function createSettingsRoutes(router: Router): void {
  // GET /settings/server-config - 获取服务端配置（脱敏）
  router.get('/settings/server-config', (_req: Request, res: Response) => {
    try {
      const dataDir = getConfig().dataDir
      const effective = getEffectiveServerConfig(dataDir)
      const file = loadServerConfig(dataDir)
      const merged = { ...file, ...effective }
      const withRuntime = {
        ...sanitizeServerConfig(merged),
        dataDir: dataDir
      }
      res.json(withRuntime)
    } catch (error) {
      log.error('get server-config error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PATCH /settings/server-config - 部分更新服务端配置
  router.patch('/settings/server-config', (req: Request, res: Response) => {
    try {
      const raw = req.body as Partial<ServerConfig> & {
        llm?: { configs?: Array<Record<string, unknown> & { configured?: boolean }> }
        skills?: { configured?: boolean }
      }
      if (!raw || typeof raw !== 'object') {
        return res.status(400).json({ error: 'Invalid request body' })
      }
      const patch: Partial<ServerConfig> = { ...raw }
      if (patch.llm?.configs) {
        patch.llm = {
          ...patch.llm,
          configs: patch.llm.configs.map((c) =>
            omit(c as unknown as Record<string, unknown>, ['configured'])
          ) as unknown as NonNullable<ServerConfig['llm']>['configs']
        }
      }
      if (patch.skills) {
        patch.skills = omit(patch.skills as unknown as Record<string, unknown>, [
          'configured'
        ]) as ServerConfig['skills']
      }
      const dataDir = getConfig().dataDir
      saveServerConfig(dataDir, patch)
      resetConfig()
      if (patch.llm) {
        resetLLMProvider()
        clearModelCache()
      }
      const effective = getEffectiveServerConfig(dataDir)
      const file = loadServerConfig(dataDir)
      const merged = { ...file, ...effective }
      const withRuntime = {
        ...sanitizeServerConfig(merged),
        dataDir: dataDir
      }
      res.json(withRuntime)
    } catch (error) {
      log.error('patch server-config error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /settings/agent-models - 获取当前可用的 LLM 配置与模型列表（供客户端模型选择器）
  router.get('/settings/agent-models', async (_req: Request, res: Response) => {
    try {
      const result = await getAvailableModels()
      res.json(result)
    } catch (error) {
      log.error('get agent-models error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /settings/available-shells - 获取当前系统可用的 Shell 列表
  router.get('/settings/available-shells', (_req: Request, res: Response) => {
    try {
      const shells = getAvailableShells()
      res.json({ shells })
    } catch (error) {
      log.error('get available-shells error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /settings/agent-tools - 获取 Agent 工具设置（脱敏）
  router.get('/settings/agent-tools', (_req: Request, res: Response) => {
    try {
      const settings = loadAgentTools()
      res.json(sanitizeForGet(settings))
    } catch (error) {
      log.error('get agent-tools error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PATCH /settings/agent-tools - 部分更新
  router.patch('/settings/agent-tools', (req: Request, res: Response) => {
    try {
      const patch = req.body as Partial<AgentToolsSettings>
      if (!patch || typeof patch !== 'object') {
        return res.status(400).json({ error: 'Invalid request body' })
      }

      if (patch.builtin?.tavily !== undefined) {
        updateTavilySettings(patch.builtin.tavily as Partial<TavilySettings>)
      }
      if (patch.builtin?.skillsmp !== undefined) {
        updateSkillsMPSettings(patch.builtin.skillsmp as Partial<SkillsMPSettings>)
      }
      if (patch.agent !== undefined) {
        updateAgentLLMSettings(patch.agent as Partial<AgentLLMSettings>)
      }
      if (patch.mcpServers !== undefined) {
        saveAgentTools({ mcpServers: patch.mcpServers })
      }
      if (patch.commands !== undefined) {
        updateCommandsSettings(patch.commands as Partial<CommandsSettings>)
      }
      if (patch.skills !== undefined) {
        updateSkillsSettings(patch.skills as Partial<SkillsSettings>)
      }
      if (patch.rules !== undefined) {
        updateRulesSettings(patch.rules as Partial<RulesSettings>)
      }
      if (patch.terminal !== undefined) {
        updateTerminalSettings(patch.terminal as Partial<TerminalSettings>)
      }

      const settings = loadAgentTools()
      res.json(sanitizeForGet(settings))
    } catch (error) {
      log.error('patch agent-tools error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PUT /settings/agent-tools/builtin/tavily - 直接更新 Tavily 配置（便于表单提交）
  router.put('/settings/agent-tools/builtin/tavily', (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<TavilySettings>
      if (body && typeof body === 'object') {
        updateTavilySettings(body)
      }
      const tavily = getTavilySettings()
      res.json({
        tavily: tavily
          ? {
              ...tavily,
              apiKey: tavily.apiKey ? '(已配置)' : undefined,
              configured: !!tavily.apiKey
            }
          : null
      })
    } catch (error) {
      log.error('put tavily settings error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PUT /settings/agent-tools/builtin/skillsmp - 直接更新 SkillsMP API Key
  router.put('/settings/agent-tools/builtin/skillsmp', (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<SkillsMPSettings>
      if (body && typeof body === 'object') {
        updateSkillsMPSettings(body)
      }
      const skillsmp = getSkillsMPSettings()
      res.json({
        skillsmp: skillsmp
          ? {
              ...skillsmp,
              apiKey: skillsmp.apiKey ? '(已配置)' : undefined,
              configured: !!skillsmp.apiKey
            }
          : null
      })
    } catch (error) {
      log.error('put skillsmp settings error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /settings/tool-groups - 获取工具分组定义及当前开关状态
  router.get('/settings/tool-groups', (_req: Request, res: Response) => {
    try {
      const config = getToolGroupConfig()
      const groups = resolveGroupStates(config)
      res.json({ groups })
    } catch (error) {
      log.error('get tool-groups error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PUT /settings/tool-groups - 更新工具分组开关
  router.put('/settings/tool-groups', (req: Request, res: Response) => {
    try {
      const body = req.body as ToolGroupConfig
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Invalid request body: expected { [groupId]: boolean }' })
      }
      updateToolGroupConfig(body)
      const config = getToolGroupConfig()
      const groups = resolveGroupStates(config)
      res.json({ groups })
    } catch (error) {
      log.error('put tool-groups error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /settings/user-profile - 获取当前客户端的用户画像（显示名称、希望的语气）
  router.get('/settings/user-profile', (req: Request, res: Response) => {
    try {
      const clientId = req.prizmClient?.clientId
      const profile = clientId ? getUserProfile(clientId) : null
      res.json(profile ?? { displayName: undefined, preferredTone: undefined })
    } catch (error) {
      log.error('get user-profile error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PUT /settings/user-profile - 更新当前客户端的用户画像
  router.put('/settings/user-profile', (req: Request, res: Response) => {
    try {
      const clientId = req.prizmClient?.clientId
      if (!clientId) {
        return res.status(401).json({ error: 'Authentication required' })
      }
      const body = req.body as Partial<UserProfileEntry>
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Invalid request body' })
      }
      const updated = updateUserProfile(clientId, body)
      res.json(updated)
    } catch (error) {
      log.error('put user-profile error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
