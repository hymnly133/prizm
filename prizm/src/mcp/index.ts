/**
 * Prizm MCP (Model Context Protocol) 服务器
 * 暴露工作区上下文（文件、文档、任务、剪贴板）给 Agent 使用
 *
 * 连接方式：
 * - Cursor: 通过 stdio-bridge（见 MCP-CONFIG.md）或 HTTP/SSE
 * - LobeChat / Claude Desktop: HTTP/SSE 直连 http://127.0.0.1:4127/mcp
 *
 * Scope：通过 URL 查询参数 ?scope=xxx 指定，未传则用 PRIZM_MCP_SCOPE 或 online
 */

import { randomUUID } from 'node:crypto'
import type { Express, Request, Response } from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { PrizmAdapters } from '../adapters/interfaces'
import type { WebSocketServer } from '../websocket/WebSocketServer'
import { ONLINE_SCOPE, scopeStore } from '../core/ScopeStore'
import { getConfig } from '../config'
import { registerFileTools } from './tools/fileTools'
import { registerTodoTools } from './tools/todoTools'
import { registerDocumentTools } from './tools/documentTools'
import { registerClipboardTools } from './tools/clipboardTools'
import { registerNotifyTools } from './tools/notifyTools'
import { registerMemoryTools } from './tools/memoryTools'

/**
 * 创建带全部工具的 MCP 服务器实例
 */
export function createMcpServerWithTools(
  adapters: PrizmAdapters,
  scope: string,
  getWsServer?: () => WebSocketServer | undefined
): McpServer {
  const server = new McpServer({ name: 'prizm', version: '0.2.0' }, { capabilities: {} })
  const scopeRoot = scopeStore.getScopeRootPath(scope)

  registerFileTools(server, scopeRoot)
  registerTodoTools(server, adapters, scope)
  registerDocumentTools(server, adapters, scope)
  registerClipboardTools(server, adapters, scope)
  registerNotifyTools(server, getWsServer)
  registerMemoryTools(server, scope)

  return server
}

const transports = new Map<string, StreamableHTTPServerTransport>()

/**
 * 挂载 MCP 路由到 Express 应用
 * 路径: POST /mcp, GET /mcp (SSE)
 * 鉴权：沿用全局 auth 中间件，客户端需传 Authorization: Bearer <api_key>
 */
export function mountMcpRoutes(
  app: Express,
  adapters: PrizmAdapters,
  getWsServer?: () => WebSocketServer | undefined
): void {
  const handler = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!
      await transport.handleRequest(req, res, req.body)
      return
    }

    if (!sessionId && req.body && isInitializeRequest(req.body)) {
      const transportRef: { t?: StreamableHTTPServerTransport } = {}
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string): void => {
          if (transportRef.t) transports.set(sid, transportRef.t)
        }
      })
      transportRef.t = transport

      // 监听 transport 关闭，清理 Map 防止内存泄漏
      transport.onclose = (): void => {
        for (const [sid, t] of transports) {
          if (t === transport) {
            transports.delete(sid)
            break
          }
        }
      }

      const scope =
        (typeof req.query.scope === 'string' ? req.query.scope.trim() : null) ||
        getConfig().mcpScope ||
        ONLINE_SCOPE
      const mcpServer = createMcpServerWithTools(adapters, scope, getWsServer)
      await mcpServer.connect(transport)
      await transport.handleRequest(req, res, req.body)
      return
    }

    res.status(400).json({ error: 'Invalid MCP request' })
  }

  app.post('/mcp', (req: Request, res: Response) => void handler(req, res))
  app.get('/mcp', (req: Request, res: Response) => void handler(req, res))
}
