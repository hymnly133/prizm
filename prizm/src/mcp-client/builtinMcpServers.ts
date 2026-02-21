/**
 * 内置 MCP 服务器框架
 * 仅提供扩展点：可在此定义 BUILTIN_MCP_IDS 与 getBuiltinMcpServerDefaults()，
 * 供首次加载 agent-tools 时注入预设。当前不注入任何预设，用户完全自行配置。
 */

import type { McpServerConfig } from './types'

/** 内置 MCP 服务器 ID 白名单（可在此扩展，用于 isBuiltinMcpServer 等） */
export const BUILTIN_MCP_IDS: readonly string[] = []

/**
 * 返回内置 MCP 服务器默认配置列表
 * 当前返回空数组；若需预设，可在此返回若干 McpServerConfig，并在 agentToolsStore 首次加载时注入。
 * @param _dataDir 预留，用于将来 Filesystem 等需要数据目录的预设
 */
export function getBuiltinMcpServerDefaults(_dataDir?: string): McpServerConfig[] {
  return []
}

/** 判断是否为内置 MCP 配置（按 id 在 BUILTIN_MCP_IDS 中） */
export function isBuiltinMcpServer(id: string): boolean {
  return BUILTIN_MCP_IDS.includes(id)
}
