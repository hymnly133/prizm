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
  updateAgentLLMSettings
} from '../settings/agentToolsStore'
import { getAvailableModels } from '../llm'
import type { AgentToolsSettings, TavilySettings, AgentLLMSettings } from '../settings/types'

const log = createLogger('Settings')

/** 脱敏：Tavily apiKey 不返回原文，仅标记 configured */
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
  return out
}

export function createSettingsRoutes(router: Router): void {
  // GET /settings/agent-models - 获取当前可用的 LLM 模型列表（供客户端模型选择器）
  router.get('/settings/agent-models', (_req: Request, res: Response) => {
    try {
      const { provider, models } = getAvailableModels()
      res.json({ provider, models })
    } catch (error) {
      log.error('get agent-models error:', error)
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
      if (patch.agent !== undefined) {
        updateAgentLLMSettings(patch.agent as Partial<AgentLLMSettings>)
      }
      if (patch.mcpServers !== undefined) {
        saveAgentTools({ mcpServers: patch.mcpServers })
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
}
