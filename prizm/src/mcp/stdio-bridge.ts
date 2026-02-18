#!/usr/bin/env node
/**
 * Prizm MCP stdio 桥接
 * 供 Cursor 等通过 stdio 连接的客户端使用
 *
 * 用法: node dist/mcp/stdio-bridge.js
 * 或: PRIZM_URL=http://127.0.0.1:4127 PRIZM_API_KEY=xxx node dist/mcp/stdio-bridge.js
 *
 * Cursor 配置 (mcp.json):
 * {
 *   "mcpServers": {
 *     "prizm": {
 *       "command": "node",
 *       "args": ["/path/to/prizm/dist/mcp/stdio-bridge.js"],
 *       "env": {
 *         "PRIZM_URL": "http://127.0.0.1:4127",
 *         "PRIZM_API_KEY": "your-api-key",
 *         "PRIZM_SCOPE": "online"
 *       }
 *     }
 *   }
 * }
 *
 * 环境变量说明：
 * - PRIZM_URL: 服务端地址，默认 http://127.0.0.1:4127
 * - PRIZM_API_KEY: API Key，用于鉴权
 * - PRIZM_SCOPE: 操作 scope，默认 online。可选：default（默认工作区）、online（实时上下文）
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createPrizmFetcher } from './stdio-tools/fetcher.js'
import { registerTodoTools } from './stdio-tools/todoTools.js'
import { registerSearchTools } from './stdio-tools/searchTools.js'
import { registerDocumentTools } from './stdio-tools/documentTools.js'
import { registerClipboardTools } from './stdio-tools/clipboardTools.js'
import { registerMemoryTools } from './stdio-tools/memoryTools.js'
import { registerNotifyTools } from './stdio-tools/notifyTools.js'

const PRIZM_URL = process.env.PRIZM_URL || 'http://127.0.0.1:4127'
const PRIZM_API_KEY = process.env.PRIZM_API_KEY || ''
const PRIZM_SCOPE = process.env.PRIZM_SCOPE || 'online'

/**
 * Creates the MCP stdio server and registers all Prizm tools.
 * Re-exported for programmatic use; env vars PRIZM_URL, PRIZM_API_KEY, PRIZM_SCOPE are read at call time.
 */
export function createStdioServer(): McpServer {
  const server = new McpServer({ name: 'prizm', version: '0.1.0' }, { capabilities: {} })
  const fetchPrizm = createPrizmFetcher(PRIZM_URL, PRIZM_API_KEY, PRIZM_SCOPE)

  registerTodoTools(server, fetchPrizm)
  registerSearchTools(server, fetchPrizm, {
    baseUrl: PRIZM_URL,
    apiKey: PRIZM_API_KEY,
    scope: PRIZM_SCOPE
  })
  registerDocumentTools(server, fetchPrizm)
  registerClipboardTools(server, fetchPrizm)
  registerMemoryTools(server, fetchPrizm)
  registerNotifyTools(server, fetchPrizm)

  return server
}

async function main(): Promise<void> {
  const server = createStdioServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // stdio 模式下 stdout 用于 MCP 协议，日志必须输出到 stderr
  console.error('[Prizm MCP stdio] Running. Connect via stdio.')
}

main().catch((err) => {
  console.error('[Prizm MCP stdio] Fatal:', err)
  process.exit(1)
})
