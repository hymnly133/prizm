/**
 * MCP 配置多格式导入器
 * 支持从 Cursor (.cursor/mcp.json)、Claude Code (.mcp.json)、
 * VS Code (.vscode/mcp.json) 导入 MCP 服务器配置
 */

import fs from 'fs'
import path from 'path'
import { createLogger } from '../logger'
import type { McpServerConfig } from './types'

const log = createLogger('McpConfigImporter')

/** 外部 MCP 配置的通用格式 */
interface ExternalMcpConfig {
  mcpServers?: Record<
    string,
    {
      command?: string
      args?: string[]
      env?: Record<string, string>
      url?: string
      headers?: Record<string, string>
      type?: string
      tools?: string[]
    }
  >
}

/**
 * 将外部 MCP 配置转换为 Prizm McpServerConfig 数组
 */
function convertToMcpServerConfigs(external: ExternalMcpConfig, source: string): McpServerConfig[] {
  if (!external.mcpServers || typeof external.mcpServers !== 'object') {
    return []
  }

  const configs: McpServerConfig[] = []

  for (const [name, server] of Object.entries(external.mcpServers)) {
    if (!server || typeof server !== 'object') continue

    const id = name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()

    // 判断传输类型
    if (server.command) {
      // stdio 类型
      configs.push({
        id,
        name,
        transport: 'stdio',
        stdio: {
          command: server.command,
          args: Array.isArray(server.args) ? server.args.map(String) : undefined,
          env: server.env && typeof server.env === 'object' ? server.env : undefined
        },
        enabled: true
      })
    } else if (server.url) {
      // HTTP/SSE 类型
      const type = server.type?.toLowerCase()
      const transport = type === 'sse' ? ('sse' as const) : ('streamable-http' as const)

      configs.push({
        id,
        name,
        transport,
        url: server.url,
        headers: server.headers && typeof server.headers === 'object' ? server.headers : undefined,
        enabled: true
      })
    } else {
      log.warn('Skipping MCP server "%s" from %s: no command or url', name, source)
    }
  }

  return configs
}

/**
 * 从文件导入 MCP 配置
 */
export function importMcpConfigFromFile(filePath: string): McpServerConfig[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as ExternalMcpConfig
    return convertToMcpServerConfigs(data, filePath)
  } catch (err) {
    throw new Error(`Failed to parse MCP config from ${filePath}: ${err}`)
  }
}

/**
 * 自动发现项目中的 MCP 配置文件
 */
export function discoverMcpConfigFiles(projectRoot?: string): Array<{
  source: 'cursor' | 'claude-code' | 'vscode'
  path: string
  serverCount: number
}> {
  const root = projectRoot || process.cwd()
  const results: Array<{
    source: 'cursor' | 'claude-code' | 'vscode'
    path: string
    serverCount: number
  }> = []

  const candidates: Array<{
    source: 'cursor' | 'claude-code' | 'vscode'
    relPath: string
  }> = [
    { source: 'cursor', relPath: '.cursor/mcp.json' },
    { source: 'claude-code', relPath: '.mcp.json' },
    { source: 'vscode', relPath: '.vscode/mcp.json' }
  ]

  // 也检查用户级
  const home = process.env.HOME || process.env.USERPROFILE
  if (home) {
    const userCursorMcp = path.join(home, '.cursor', 'mcp.json')
    if (fs.existsSync(userCursorMcp)) {
      try {
        const data = JSON.parse(fs.readFileSync(userCursorMcp, 'utf-8'))
        const count = data.mcpServers ? Object.keys(data.mcpServers).length : 0
        if (count > 0) {
          results.push({ source: 'cursor', path: userCursorMcp, serverCount: count })
        }
      } catch {
        // ignore
      }
    }
  }

  for (const candidate of candidates) {
    const fullPath = path.join(root, candidate.relPath)
    if (!fs.existsSync(fullPath)) continue

    try {
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
      const count = data.mcpServers ? Object.keys(data.mcpServers).length : 0
      if (count > 0) {
        results.push({ source: candidate.source, path: fullPath, serverCount: count })
      }
    } catch {
      // ignore
    }
  }

  return results
}
