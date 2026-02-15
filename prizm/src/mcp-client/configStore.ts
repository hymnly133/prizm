/**
 * MCP 服务器配置持久化
 * 存储路径：.prizm-data/mcp-servers.json
 */

import fs from 'fs'
import { createLogger } from '../logger'
import { getMcpServersPath, ensureDataDir } from '../core/PathProviderCore'
import type { McpServerConfig, McpServersFile } from './types'

const log = createLogger('McpConfig')

function getFilePath(): string {
  return getMcpServersPath()
}

function loadRaw(): McpServersFile {
  const filePath = getFilePath()
  if (!fs.existsSync(filePath)) {
    return { mcpServers: [] }
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(content) as McpServersFile
    if (!Array.isArray(data.mcpServers)) {
      return { mcpServers: [] }
    }
    return data
  } catch (err) {
    log.error('Failed to load MCP config:', err)
    return { mcpServers: [] }
  }
}

function save(data: McpServersFile): void {
  ensureDataDir()
  const filePath = getFilePath()
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

export function listMcpServers(): McpServerConfig[] {
  return loadRaw().mcpServers
}

export function getMcpServerById(id: string): McpServerConfig | null {
  return listMcpServers().find((s) => s.id === id) ?? null
}

export function addMcpServer(config: McpServerConfig): McpServerConfig {
  const data = loadRaw()
  if (data.mcpServers.some((s) => s.id === config.id)) {
    throw new Error(`MCP server with id "${config.id}" already exists`)
  }
  data.mcpServers.push(config)
  save(data)
  log.info('MCP server added:', config.id)
  return config
}

export function updateMcpServer(
  id: string,
  update: Partial<Omit<McpServerConfig, 'id'>>
): McpServerConfig {
  const data = loadRaw()
  const idx = data.mcpServers.findIndex((s) => s.id === id)
  if (idx < 0) {
    throw new Error(`MCP server not found: ${id}`)
  }
  data.mcpServers[idx] = { ...data.mcpServers[idx], ...update }
  save(data)
  log.info('MCP server updated:', id)
  return data.mcpServers[idx]
}

export function removeMcpServer(id: string): void {
  const data = loadRaw()
  const idx = data.mcpServers.findIndex((s) => s.id === id)
  if (idx < 0) {
    throw new Error(`MCP server not found: ${id}`)
  }
  data.mcpServers.splice(idx, 1)
  save(data)
  log.info('MCP server removed:', id)
}
