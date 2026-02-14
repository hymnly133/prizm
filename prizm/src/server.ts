/**
 * Prizm Server - HTTP API Server
 */

import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import express, { type Express } from 'express'
import compression from 'compression'
import cors from 'cors'
import type { Server } from 'http'
import { createLogger } from './logger'

const log = createLogger('Server')
import type { PrizmAdapters } from './adapters/interfaces'
import type { PrizmServerOptions } from './types'
import { getConfig } from './config'
import { ClientRegistry } from './auth/ClientRegistry'
import { createAuthMiddleware } from './auth/authMiddleware'
import { createAuthRoutes } from './routes/auth'
import { createNotesRoutes } from './routes/notes'
import { createNotifyRoutes } from './routes/notify'
import { createTodoListRoutes } from './routes/todoList'
import { createPomodoroRoutes } from './routes/pomodoro'
import { createClipboardRoutes } from './routes/clipboard'
import { createDocumentsRoutes } from './routes/documents'
import { createSearchRoutes } from './routes/search'
import { createAgentRoutes } from './routes/agent'
import { createMcpConfigRoutes } from './routes/mcpConfig'
import { createSettingsRoutes } from './routes/settings'
import { mountMcpRoutes } from './mcp'
import { WebSocketServer } from './websocket/WebSocketServer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface PrizmServer {
  /**
   * 启动服务器
   */
  start(): Promise<void>

  /**
   * 停止服务器
   */
  stop(): Promise<void>

  /**
   * 服务器是否正在运行
   */
  isRunning(): boolean

  /**
   * 获取服务器地址
   */
  getAddress(): string | null

  /**
   * WebSocket 服务器实例（如果启用）
   */
  websocket?: WebSocketServer
}

/**
 * 创建 Prizm 服务器
 */
export function createPrizmServer(
  adapters: PrizmAdapters,
  options: PrizmServerOptions = {}
): PrizmServer {
  const cfg = getConfig()
  const {
    port = cfg.port,
    host = cfg.host,
    dataDir = cfg.dataDir,
    enableCors = cfg.enableCors,
    authEnabled = cfg.authEnabled,
    enableWebSocket = cfg.enableWebSocket,
    websocketPath = cfg.websocketPath
  } = options

  const app: Express = express()
  let server: Server | null = null
  let wsServer: WebSocketServer | undefined = undefined
  let isRunning = false

  const clientRegistry = new ClientRegistry(dataDir)

  // 中间件：compression 提供 res.flush()，SSE 需在每块后调用以实时推送
  app.use(
    compression({
      filter: (req, res) => {
        // Agent chat 为 SSE 流，强制走 compression 以获取 res.flush()
        if (req.originalUrl?.includes('/agent/') && req.originalUrl?.includes('/chat')) return true
        return compression.filter(req, res)
      }
    })
  )
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  if (enableCors) {
    app.use(cors())
  }

  // 鉴权中间件（/health、/panel、/auth/register 豁免）
  const authMiddleware = createAuthMiddleware({ clientRegistry, authEnabled })
  app.use(authMiddleware)

  // 设置 WebSocket 服务器引用到请求对象
  app.use((req, _res, next) => {
    req.prizmServer = wsServer
    next()
  })

  // 健康检查
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'prizm-server',
      timestamp: Date.now()
    })
  })

  // 挂载路由
  const router = express.Router()
  createNotesRoutes(router, adapters.notes)
  createNotifyRoutes(router, adapters.notification)
  createTodoListRoutes(router, adapters.todoList)
  createPomodoroRoutes(router, adapters.pomodoro)
  createClipboardRoutes(router, adapters.clipboard)
  createDocumentsRoutes(router, adapters.documents)
  createSearchRoutes(router, adapters)
  createAgentRoutes(router, adapters.agent)
  createMcpConfigRoutes(router)
  createSettingsRoutes(router)
  app.use('/', router)

  // MCP 端点：供 Cursor、LobeChat 等 Agent 连接（wsServer 在 start 后注入）
  mountMcpRoutes(app, adapters, () => wsServer)

  // Auth 路由单独挂载（避免与 router 路径冲突）
  const authRouter = express.Router()
  createAuthRoutes(authRouter, clientRegistry)
  app.use('/auth', authRouter)

  // 根路径重定向到 Dashboard
  app.get('/', (_req, res) => {
    res.redirect('/dashboard/')
  })

  // Dashboard 静态资源（panel 目录构建输出）
  const dashboardDistPath = path.join(__dirname, '../panel/dist')
  if (fs.existsSync(dashboardDistPath)) {
    app.use('/dashboard', express.static(dashboardDistPath))
    // SPA fallback
    app.get('/dashboard/*splat', (_req, res) => {
      res.sendFile(path.join(dashboardDistPath, 'index.html'))
    })
  }

  // 404 处理
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  // 错误处理
  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      log.error('Error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  )

  return {
    async start(): Promise<void> {
      if (isRunning) {
        log.warn('Server is already running')
        return
      }

      return new Promise((resolve, reject) => {
        try {
          server = app.listen(port, host, () => {
            isRunning = true

            // 初始化 WebSocket 服务器（如果启用）
            if (enableWebSocket && server) {
              wsServer = new WebSocketServer(server, clientRegistry, {
                path: websocketPath
              })
              log.info('WebSocket:', `ws://${host}:${port}${websocketPath}`)
            }

            log.info('Listening on', `http://${host}:${port}`)
            resolve()
          })

          server.on('error', (error) => {
            log.error('Server error:', error)
            reject(error)
          })
        } catch (error) {
          reject(error)
        }
      })
    },

    async stop(): Promise<void> {
      if (!server || !isRunning) {
        return
      }

      // 先关闭 WebSocket 服务器
      if (wsServer) {
        wsServer.destroy()
        wsServer = undefined
      }

      return new Promise((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            log.error('Error stopping server:', error)
            reject(error)
          } else {
            isRunning = false
            server = null
            log.info('Server stopped')
            resolve()
          }
        })
      })
    },

    isRunning(): boolean {
      return isRunning
    },

    getAddress(): string | null {
      if (!server || !isRunning) {
        return null
      }
      return `http://${host}:${port}`
    },

    websocket: wsServer
  }
}
