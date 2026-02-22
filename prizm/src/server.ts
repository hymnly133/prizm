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
import { getSearchIndexDbPath } from './core/PathProviderCore'

const log = createLogger('Server')
import type { PrizmAdapters } from './adapters/interfaces'
import type { PrizmServerOptions } from './types'
import { getConfig } from './config'
import { ClientRegistry } from './auth/ClientRegistry'
import { createAuthMiddleware } from './auth/authMiddleware'
import { createAuthRoutes } from './routes/auth'
import { createNotifyRoutes } from './routes/notify'
import { createTodoListRoutes } from './routes/todoList'
import { createClipboardRoutes } from './routes/clipboard'
import { createDocumentsRoutes } from './routes/documents'
import { createFilesRoutes } from './routes/files'
import { createSearchRoutes } from './routes/search'
import { SearchIndexService } from './search/searchIndexService'
import { setSearchIndexForTools } from './llm/builtinTools'
import { SQLiteAdapter } from '@prizm/evermemos'
import { createAgentRoutes } from './routes/agent'
import { createMcpConfigRoutes } from './routes/mcpConfig'
import { createCommandsRoutes } from './routes/commands'
import { createSkillsRoutes } from './routes/skills'
import { createAgentRulesRoutes } from './routes/agentRules'
import { createSettingsRoutes } from './routes/settings'
import { createMemoryRoutes } from './routes/memory'
import { mountMcpRoutes } from './mcp'
import { WebSocketServer } from './websocket/WebSocketServer'
import { initEverMemService } from './llm/EverMemService'
import { initTokenUsageDb, closeTokenUsageDb } from './core/tokenUsageDb'
import { lockManager } from './core/resourceLockManager'
import { auditManager } from './core/agentAuditLog'
import { migrateToolSessionsFromBackground } from './core/migrateToolSessions'
import { getTerminalManager } from './terminal/TerminalSessionManager'
import { TerminalWebSocketServer } from './terminal/TerminalWebSocketServer'
import { createTerminalRoutes } from './routes/terminal'
import { clearAll as clearEventBus } from './core/eventBus'
import { bgSessionManager } from './core/backgroundSession'
import { cronManager } from './core/cronScheduler'
import { chatCore } from './routes/agent/chatCore'
import type { IChatService } from './core/interfaces'
import { registerPermissionCleanupHandler } from './core/toolPermission'
import {
  initResumeStore,
  closeResumeStore,
  initWorkflowRunner,
  initTaskRunner,
  shutdownTaskRunner,
  BgSessionStepExecutor,
  registerWorkflowTriggerHandlers,
  recoverStaleTaskRuns,
  recoverStaleWorkflowRuns,
  pruneTaskRuns,
  pruneRuns,
  recoverStaleTaskRunsByAge,
  recoverStaleWorkflowRunsByAge,
  readLegacyDefs,
  dropLegacyDefTable,
  registerDef
} from './core/workflowEngine'
import { startReminderService, stopReminderService } from './core/scheduleReminder'
import { resetStaleChatStatus } from './routes/agent/_shared'
import {
  registerAuditHandlers,
  registerLockHandlers,
  registerMemoryHandlers,
  registerWSBridgeHandlers,
  setWebSocketServer,
  registerSearchHandlers,
  setSearchIndex,
  registerBgSessionHandlers,
  registerScheduleHandlers
} from './core/eventBus/handlers'
import { createEmbeddingRoutes } from './routes/embedding'
import { createScheduleRoutes } from './routes/schedule'
import { createCronRoutes } from './routes/cron'
import { createWorkflowRoutes } from './routes/workflow'
import { createTaskRoutes } from './routes/task'
import { localEmbedding } from './llm/localEmbedding'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 一次性迁移：将 SQLite workflow_defs 数据写入文件系统，然后删除旧表 */
function migrateWorkflowDefsToFiles(): void {
  try {
    const legacyDefs = readLegacyDefs()
    if (legacyDefs.length === 0) return

    log.info(`Migrating ${legacyDefs.length} workflow defs from SQLite to files...`)
    for (const def of legacyDefs) {
      try {
        registerDef(def.name, def.scope, def.yamlContent, def.description, def.triggersJson)
        log.info(`  Migrated workflow def: ${def.name} (scope: ${def.scope})`)
      } catch (err) {
        log.warn(`  Failed to migrate workflow def "${def.name}":`, err)
      }
    }
    dropLegacyDefTable()
    log.info('Workflow defs migration complete')
  } catch (err) {
    log.warn('Workflow defs migration failed:', err)
  }
}

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
  let terminalWsServer: TerminalWebSocketServer | undefined = undefined
  const terminalManager = getTerminalManager()
  let isRunning = false
  let taskPruneTimer: ReturnType<typeof setInterval> | null = null

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

  // 健康检查（含 dataDir 便于排查记忆/scope 数据路径）
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'prizm-server',
      timestamp: Date.now(),
      dataDir,
      embedding: {
        state: localEmbedding.getState(),
        model: localEmbedding.getModelName(),
        dimension: localEmbedding.getDimension()
      }
    })
  })

  // 挂载路由
  const router = express.Router()
  const searchIndexDbPath = getSearchIndexDbPath(dataDir)
  const searchIndexStore = new SQLiteAdapter(searchIndexDbPath)
  const searchIndex = new SearchIndexService(searchIndexStore)
  searchIndex.setAdapters(adapters)
  setSearchIndexForTools(searchIndex)
  createNotifyRoutes(router, adapters.notification)
  createTodoListRoutes(router, adapters.todoList)
  createClipboardRoutes(router, adapters.clipboard)
  createDocumentsRoutes(router, adapters.documents, searchIndex)
  createFilesRoutes(router)
  createSearchRoutes(router, adapters, searchIndex)
  createAgentRoutes(router, adapters.agent)
  createTerminalRoutes(router, terminalManager)
  createMcpConfigRoutes(router)
  createCommandsRoutes(router)
  createSkillsRoutes(router)
  createAgentRulesRoutes(router)
  createSettingsRoutes(router)
  createMemoryRoutes(router)
  createEmbeddingRoutes(router)
  createScheduleRoutes(router)
  createCronRoutes(router)
  createWorkflowRoutes(router, adapters.agent)
  createTaskRoutes(router)
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

      return (async () => {
        try {
          // 在 listen 之前完成记忆服务初始化，避免首包请求时 EverMemService 未就绪
          resetStaleChatStatus()
          try {
            await initEverMemService()
          } catch (e) {
            log.warn('EverMemService init failed:', e)
          }
          try {
            initTokenUsageDb()
          } catch (e) {
            log.warn('Token usage DB init failed:', e)
          }
          try {
            lockManager.init()
          } catch (e) {
            log.warn('Resource lock manager init failed:', e)
          }
          try {
            auditManager.init()
          } catch (e) {
            log.warn('Audit manager init failed:', e)
          }

          return new Promise<void>((resolve, reject) => {
            server = app.listen(port, host, async () => {
              isRunning = true
              log.info(
                `Prizm server started — dataDir: ${dataDir} (scope/session memory under scopes/<id>/.prizm/memory/)`
              )
              const chatService: IChatService = { execute: chatCore }
              await bgSessionManager.init(adapters.agent, chatService)
              await cronManager.init(bgSessionManager)
              initResumeStore()
              migrateWorkflowDefsToFiles()
              try {
                if (adapters.agent) {
                  const { migrated } = await migrateToolSessionsFromBackground(adapters.agent)
                  if (migrated > 0) log.info('Tool sessions migration:', migrated)
                }
              } catch (e) {
                log.warn('Tool sessions migration failed:', e)
              }
              recoverStaleTaskRuns()
              recoverStaleWorkflowRuns()
              const stepExecutor = new BgSessionStepExecutor(bgSessionManager)
              initWorkflowRunner(stepExecutor)
              initTaskRunner(stepExecutor)
              registerWorkflowTriggerHandlers()
              startReminderService()

              // 每 24h 清理过期任务记录 + 恢复超龄僵尸记录
              taskPruneTimer = setInterval(() => {
                try {
                  pruneTaskRuns(90)
                  pruneRuns(90)
                  recoverStaleTaskRunsByAge(7)
                  recoverStaleWorkflowRunsByAge(7)
                } catch (e) {
                  log.warn('Task/workflow prune failed:', e)
                }
              }, 24 * 60 * 60_000)
              if (taskPruneTimer.unref) taskPruneTimer.unref()

              // ── EventBus handler 注册（在所有服务初始化之后） ──
              registerAuditHandlers()
              registerLockHandlers()
              registerMemoryHandlers()
              registerBgSessionHandlers()
              registerScheduleHandlers()
              registerPermissionCleanupHandler()
              setSearchIndex(searchIndex)
              registerSearchHandlers()

              if (enableWebSocket && server) {
                const terminalWsPath = '/ws/terminal'

                wsServer = new WebSocketServer(server, clientRegistry, {
                  path: websocketPath
                })
                log.info('WebSocket:', `ws://${host}:${port}${websocketPath}`)

                terminalWsServer = new TerminalWebSocketServer(
                  server,
                  clientRegistry,
                  terminalManager,
                  { path: terminalWsPath }
                )
                log.info('Terminal WebSocket:', `ws://${host}:${port}${terminalWsPath}`)

                // WebSocket 桥接：注册 EventBus → WebSocket 广播 handler
                setWebSocketServer(wsServer)
                registerWSBridgeHandlers()

                // 统一 upgrade 路由 — 两个 WSS 均为 noServer 模式，
                // 需手动根据路径分发 upgrade 请求
                server.on('upgrade', (req, socket, head) => {
                  const pathname = new URL(req.url ?? '/', 'ws://localhost').pathname
                  if (pathname === terminalWsPath && terminalWsServer) {
                    terminalWsServer.handleUpgrade(req, socket, head)
                  } else if (pathname === websocketPath && wsServer) {
                    wsServer.handleUpgrade(req, socket, head)
                  } else {
                    socket.destroy()
                  }
                })
              }

              log.info('Listening on', `http://${host}:${port}`)
              resolve()
            })
            server.on('error', (error) => {
              log.error('Server error:', error)
              reject(error)
            })
          })
        } catch (error) {
          throw error
        }
      })()
    },

    async stop(): Promise<void> {
      if (!server || !isRunning) {
        return
      }

      // 先关闭 Terminal WebSocket 和终端管理器
      if (terminalWsServer) {
        terminalWsServer.destroy()
        terminalWsServer = undefined
      }
      await terminalManager.shutdown()

      // 关闭 WebSocket 服务器
      if (wsServer) {
        wsServer.destroy()
        wsServer = undefined
      }

      // 清理 EventBus 订阅
      clearEventBus()
      setWebSocketServer(undefined)

      // 关闭 Token Usage DB
      closeTokenUsageDb()

      // 关闭后台会话管理器（先 await 以确保 interrupted 状态持久化）、锁管理器和审计管理器
      stopReminderService()
      if (taskPruneTimer) {
        clearInterval(taskPruneTimer)
        taskPruneTimer = null
      }
      shutdownTaskRunner()
      closeResumeStore()
      await cronManager.shutdown()
      await bgSessionManager.shutdown()
      lockManager.shutdown()
      auditManager.shutdown()

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
