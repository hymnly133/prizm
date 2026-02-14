/**
 * 解析 MCP JSON 配置
 * 参照 LobeChat QuickImportSection / parseMcpInput，支持多种格式
 */
import type { McpServerConfig } from '@prizm/client-core'

/** LobeChat 格式：mcpServers 为对象 { [id]: config } */
interface LobeChatMcpServers {
  [id: string]: {
    args?: string[]
    command?: string
    env?: Record<string, string>
    headers?: Record<string, string>
    url?: string
  }
}

/** LobeChat 根结构 */
interface LobeChatMcpJson {
  mcpServers?: LobeChatMcpServers
}

/** Prizm 格式：mcpServers 为数组 */
interface PrizmMcpJson {
  mcpServers?: McpServerConfig[]
}

export enum ParseMcpErrorCode {
  EmptyMcpServers = 'EmptyMcpServers',
  InvalidJson = 'InvalidJson',
  InvalidMcpStructure = 'InvalidMcpStructure',
  InvalidJsonStructure = 'InvalidJsonStructure'
}

export interface ParseMcpSuccessResult {
  servers: McpServerConfig[]
  status: 'success'
}

export interface ParseMcpErrorResult {
  errorCode: ParseMcpErrorCode
  status: 'error'
}

export interface ParseMcpNoOpResult {
  status: 'noop'
}

export type ParseMcpResult = ParseMcpSuccessResult | ParseMcpErrorResult | ParseMcpNoOpResult

function safeParseJSON<T>(value: string): T | null {
  try {
    const trimmed = value.trim()
    if (!trimmed) return null
    return JSON.parse(trimmed) as T
  } catch {
    return null
  }
}

/** 将 LobeChat 单条 config 转为 McpServerConfig */
function lobeConfigToPrizm(id: string, config: LobeChatMcpServers[string]): McpServerConfig | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null

  if (config.command && Array.isArray(config.args)) {
    return {
      id,
      name: id,
      transport: 'stdio',
      stdio: {
        command: config.command,
        args: config.args,
        env: config.env
      },
      enabled: true
    }
  }

  if (config.url && typeof config.url === 'string') {
    return {
      id,
      name: id,
      transport: 'streamable-http',
      url: config.url,
      headers: config.headers,
      enabled: true
    }
  }

  return null
}

/**
 * 解析 MCP JSON 输入，支持：
 * 1. Prizm 格式：{ mcpServers: [ { id, name, transport, ... } ] }
 * 2. LobeChat 格式：{ mcpServers: { id: { command, args } } } 或 { mcpServers: { id: { url } } }
 * 3. LobeChat 扁平格式：{ id: { command, args } } 或 { id: { url } }
 */
export function parseMcpJson(value: string): ParseMcpResult {
  const parsed = safeParseJSON<LobeChatMcpJson | PrizmMcpJson | LobeChatMcpServers>(value)

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'noop' }
  }

  // 1. Prizm 格式：mcpServers 为数组
  if ('mcpServers' in parsed && Array.isArray(parsed.mcpServers)) {
    const arr = parsed.mcpServers
    if (arr.length === 0) {
      return { errorCode: ParseMcpErrorCode.EmptyMcpServers, status: 'error' }
    }
    const servers: McpServerConfig[] = []
    for (const item of arr) {
      if (
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.transport === 'string' &&
        typeof item.enabled === 'boolean'
      ) {
        servers.push(item as McpServerConfig)
      } else {
        return { errorCode: ParseMcpErrorCode.InvalidMcpStructure, status: 'error' }
      }
    }
    return { servers, status: 'success' }
  }

  // 2. LobeChat 格式：mcpServers 为对象 { [id]: config }
  if (
    'mcpServers' in parsed &&
    parsed.mcpServers &&
    typeof parsed.mcpServers === 'object' &&
    !Array.isArray(parsed.mcpServers)
  ) {
    const keys = Object.keys(parsed.mcpServers)
    if (keys.length === 0) {
      return { errorCode: ParseMcpErrorCode.EmptyMcpServers, status: 'error' }
    }
    const servers: McpServerConfig[] = []
    for (const id of keys) {
      const cfg = lobeConfigToPrizm(id, parsed.mcpServers[id])
      if (!cfg) {
        return { errorCode: ParseMcpErrorCode.InvalidMcpStructure, status: 'error' }
      }
      servers.push(cfg)
    }
    return { servers, status: 'success' }
  }

  // 3. LobeChat 扁平格式：顶层单 key 为 id
  const topKeys = Object.keys(parsed)
  if (topKeys.length >= 1) {
    const servers: McpServerConfig[] = []
    for (const id of topKeys) {
      const cfg = (parsed as Record<string, unknown>)[id]
      if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
        const converted = lobeConfigToPrizm(id, cfg as LobeChatMcpServers[string])
        if (converted) servers.push(converted)
      }
    }
    if (servers.length > 0) {
      return { servers, status: 'success' }
    }
  }

  return { errorCode: ParseMcpErrorCode.InvalidJsonStructure, status: 'error' }
}
