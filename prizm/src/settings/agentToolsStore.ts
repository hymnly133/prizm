/**
 * Agent 工具统一存储
 * 存储路径：.prizm-data/agent-tools.json
 * 支持从 mcp-servers.json 迁移
 */

import fs from 'fs'
import { createLogger } from '../logger'
import { getAgentToolsPath, getMcpServersPath, ensureDataDir } from '../core/PathProviderCore'
import type {
  AgentToolsSettings,
  TavilySettings,
  AgentLLMSettings,
  DocumentSummarySettings,
  DocumentMemorySettings,
  ConversationSummarySettings,
  ContextWindowSettings,
  CommandsSettings,
  SkillsSettings,
  RulesSettings,
  TerminalSettings,
  ToolGroupConfig
} from './types'
import type { McpServerConfig } from '../mcp-client/types'

const log = createLogger('AgentToolsStore')

function getFilePath(): string {
  return getAgentToolsPath()
}

function getLegacyFilePath(): string {
  return getMcpServersPath()
}

function migrateFromLegacy(): AgentToolsSettings | null {
  const legacyPath = getLegacyFilePath()
  if (!fs.existsSync(legacyPath)) return null
  try {
    const content = fs.readFileSync(legacyPath, 'utf-8')
    const data = JSON.parse(content) as { mcpServers?: McpServerConfig[] }
    if (!Array.isArray(data.mcpServers)) return null
    const settings: AgentToolsSettings = {
      builtin: {},
      mcpServers: data.mcpServers,
      updatedAt: Date.now()
    }
    saveRaw(settings)
    log.info('Migrated MCP config from mcp-servers.json to agent-tools.json')
    return settings
  } catch (err) {
    log.error('Failed to migrate from mcp-servers.json:', err)
    return null
  }
}

function loadRaw(): AgentToolsSettings {
  const filePath = getFilePath()
  if (!fs.existsSync(filePath)) {
    const migrated = migrateFromLegacy()
    if (migrated) return migrated
    return { builtin: {}, agent: {}, mcpServers: [], updatedAt: Date.now() }
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(content) as AgentToolsSettings
    return {
      builtin: data.builtin ?? {},
      agent: data.agent ?? {},
      mcpServers: Array.isArray(data.mcpServers) ? data.mcpServers : [],
      updatedAt: data.updatedAt ?? Date.now()
    }
  } catch (err) {
    log.error('Failed to load agent-tools.json:', err)
    return { builtin: {}, agent: {}, mcpServers: [], updatedAt: Date.now() }
  }
}

function saveRaw(data: AgentToolsSettings): void {
  ensureDataDir()
  const filePath = getFilePath()
  const toSave: AgentToolsSettings = {
    ...data,
    updatedAt: Date.now()
  }
  fs.writeFileSync(filePath, JSON.stringify(toSave, null, 2), 'utf-8')
}

// ============ 内置工具 ============

export function getTavilySettings(): TavilySettings | null {
  const s = loadRaw().builtin?.tavily
  return s ?? null
}

export function updateTavilySettings(update: Partial<TavilySettings>): void {
  const data = loadRaw()
  data.builtin = data.builtin ?? {}
  data.builtin.tavily = { ...data.builtin.tavily, ...update }
  saveRaw(data)
  log.info('Tavily settings updated')
}

// ============ MCP 服务器（兼容 configStore 接口） ============

export function listMcpServers(): McpServerConfig[] {
  return loadRaw().mcpServers ?? []
}

export function getMcpServerById(id: string): McpServerConfig | null {
  return listMcpServers().find((s) => s.id === id) ?? null
}

export function addMcpServer(config: McpServerConfig): McpServerConfig {
  const data = loadRaw()
  const servers = data.mcpServers ?? []
  if (servers.some((s) => s.id === config.id)) {
    throw new Error(`MCP server with id "${config.id}" already exists`)
  }
  data.mcpServers = [...servers, config]
  saveRaw(data)
  log.info('MCP server added:', config.id)
  return config
}

export function updateMcpServer(
  id: string,
  update: Partial<Omit<McpServerConfig, 'id'>>
): McpServerConfig {
  const data = loadRaw()
  const servers = data.mcpServers ?? []
  const idx = servers.findIndex((s) => s.id === id)
  if (idx < 0) {
    throw new Error(`MCP server not found: ${id}`)
  }
  servers[idx] = { ...servers[idx], ...update }
  data.mcpServers = servers
  saveRaw(data)
  log.info('MCP server updated:', id)
  return servers[idx]
}

export function removeMcpServer(id: string): void {
  const data = loadRaw()
  const servers = data.mcpServers ?? []
  const idx = servers.findIndex((s) => s.id === id)
  if (idx < 0) {
    throw new Error(`MCP server not found: ${id}`)
  }
  servers.splice(idx, 1)
  data.mcpServers = servers
  saveRaw(data)
  log.info('MCP server removed:', id)
}

// ============ 统一读取 ============

export function loadAgentTools(): AgentToolsSettings {
  return loadRaw()
}

export function saveAgentTools(update: Partial<AgentToolsSettings>): void {
  const data = loadRaw()
  if (update.builtin !== undefined) {
    data.builtin = { ...data.builtin, ...update.builtin }
  }
  if (update.agent !== undefined) {
    data.agent = { ...data.agent, ...update.agent }
  }
  if (update.mcpServers !== undefined) {
    data.mcpServers = update.mcpServers
  }
  saveRaw(data)
}

// ============ Agent LLM 设置 ============

export function getAgentLLMSettings(): AgentLLMSettings {
  return loadRaw().agent ?? {}
}

export function getDocumentSummarySettings(): DocumentSummarySettings | null {
  const s = loadRaw().agent?.documentSummary
  return s ?? null
}

/** 获取文档记忆设置（与 getDocumentSummarySettings 读取同一配置项） */
export function getDocumentMemorySettings(): DocumentMemorySettings | null {
  return getDocumentSummarySettings()
}

export function getConversationSummarySettings(): ConversationSummarySettings | null {
  const s = loadRaw().agent?.conversationSummary
  return s ?? null
}

export function getContextWindowSettings(): ContextWindowSettings {
  const a = loadRaw().agent?.contextWindow ?? {}
  return {
    fullContextTurns: Math.max(1, a.fullContextTurns ?? 4),
    cachedContextTurns: Math.max(1, a.cachedContextTurns ?? 3)
  }
}

export function getDynamicContextMode(): 'system' | 'user_prefix' {
  return loadRaw().agent?.promptCaching?.dynamicContextMode ?? 'system'
}

export function updateAgentLLMSettings(update: Partial<AgentLLMSettings>): void {
  const data = loadRaw()
  data.agent = { ...data.agent, ...update }
  saveRaw(data)
  log.info('Agent LLM settings updated')
}

// ============ Commands 设置 ============

export function getCommandsSettings(): CommandsSettings {
  return loadRaw().commands ?? { enabled: true }
}

export function updateCommandsSettings(update: Partial<CommandsSettings>): void {
  const data = loadRaw()
  data.commands = { ...data.commands, ...update }
  saveRaw(data)
  log.info('Commands settings updated')
}

// ============ Skills 设置 ============

export function getSkillsSettings(): SkillsSettings {
  return loadRaw().skills ?? { enabled: true, autoActivate: true, maxActiveSkills: 3 }
}

export function updateSkillsSettings(update: Partial<SkillsSettings>): void {
  const data = loadRaw()
  data.skills = { ...data.skills, ...update }
  saveRaw(data)
  log.info('Skills settings updated')
}

// ============ Rules 设置 ============

export function getRulesSettings(): RulesSettings {
  return loadRaw().rules ?? { enabled: true, maxTokens: 8000, autoDiscover: true }
}

export function updateRulesSettings(update: Partial<RulesSettings>): void {
  const data = loadRaw()
  data.rules = { ...data.rules, ...update }
  saveRaw(data)
  log.info('Rules settings updated')
}

// ============ Terminal 设置 ============

export function getTerminalSettings(): TerminalSettings {
  return loadRaw().terminal ?? {}
}

export function updateTerminalSettings(update: Partial<TerminalSettings>): void {
  const data = loadRaw()
  data.terminal = { ...data.terminal, ...update }
  saveRaw(data)
  log.info('Terminal settings updated')
}

// ============ 工具分组设置 ============

export function getToolGroupConfig(): ToolGroupConfig | undefined {
  return loadRaw().toolGroups
}

export function updateToolGroupConfig(update: ToolGroupConfig): void {
  const data = loadRaw()
  data.toolGroups = { ...data.toolGroups, ...update }
  saveRaw(data)
  log.info('Tool group config updated')
}
