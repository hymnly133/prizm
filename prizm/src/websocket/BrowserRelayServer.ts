import type http from 'http'
import { WebSocketServer as WSServer, type WebSocket } from 'ws'
import { createLogger } from '../logger'
import type { ClientRegistry } from '../auth/ClientRegistry'

const log = createLogger('BrowserRelay')

interface QueuedMessage {
  data: WebSocket.RawData
  isBinary: boolean
}

interface RelaySession {
  providerWs: WebSocket | null
  consumerWs: WebSocket | null
  messageQueue: QueuedMessage[]
}

export interface BrowserRelayServerOptions {
  clientRegistry?: ClientRegistry
  authEnabled?: boolean
}

export class BrowserRelayServer {
  private wss: WSServer
  private sessions = new Map<string, RelaySession>()
  private clientRegistry: ClientRegistry | undefined
  private authEnabled: boolean

  constructor(options: BrowserRelayServerOptions = {}) {
    this.wss = new WSServer({ noServer: true })
    this.clientRegistry = options.clientRegistry
    this.authEnabled = options.authEnabled ?? true

    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      this.handleConnection(ws, req)
    })
  }

  public handleUpgrade(
    req: http.IncomingMessage,
    socket: import('stream').Duplex,
    head: Buffer
  ): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req)
    })
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage) {
    const url = new URL(req.url ?? '/', 'ws://localhost')
    const urlClientId = url.searchParams.get('clientId') || 'unknown'
    const role = url.searchParams.get('role') // 'provider' (Electron) or 'consumer' (Playwright)
    const apiKey = url.searchParams.get('apiKey') ?? null

    if (role !== 'provider' && role !== 'consumer') {
      ws.close(1008, 'Invalid role')
      return
    }

    // 会话使用的 clientId：有鉴权时 provider 以 API Key 为准归一化，consumer 必须与 API Key 所属一致
    let effectiveClientId = urlClientId

    if (this.authEnabled && this.clientRegistry) {
      const hasKey = apiKey != null && apiKey.trim().length > 0
      if (!hasKey) {
        const isLoopback =
          req.socket.remoteAddress === '127.0.0.1' ||
          req.socket.remoteAddress === '::1' ||
          req.socket.remoteAddress === '::ffff:127.0.0.1'
        if (role === 'consumer' && isLoopback) {
          // 本机 consumer（如 Playwright）可不带 apiKey
        } else {
          log.warn('[BrowserRelay] Rejected: API key required')
          ws.close(4001, 'API key is required')
          return
        }
      } else {
        const result = this.clientRegistry.validate(apiKey.trim())
        if (!result) {
          log.warn('[BrowserRelay] Rejected: Invalid API key')
          ws.close(4003, 'Invalid API key')
          return
        }
        if (role === 'provider') {
          effectiveClientId = result.clientId
          if (effectiveClientId !== urlClientId) {
            log.info(
              `[BrowserRelay] Provider clientId normalized: ${urlClientId} -> ${effectiveClientId} (from API key)`
            )
          }
        } else {
          if (result.clientId !== urlClientId) {
            log.warn('[BrowserRelay] Rejected: consumer clientId does not match API key owner')
            ws.close(4003, 'clientId does not match API key')
            return
          }
        }
      }
    }
    log.info(`[BrowserRelay] New ${role} connection for clientId: ${effectiveClientId}`)

    if (!this.sessions.has(effectiveClientId)) {
      this.sessions.set(effectiveClientId, { providerWs: null, consumerWs: null, messageQueue: [] })
    }

    const session = this.sessions.get(effectiveClientId)!

    if (role === 'provider') {
      // Electron Node connecting
      if (session.providerWs) {
        session.providerWs.close(1000, 'Replaced by new provider')
      }
      session.providerWs = ws

      // Drain queue if there are any pending consumer messages
      if (session.messageQueue.length > 0) {
        log.info(
          `[BrowserRelay] Draining ${session.messageQueue.length} queued messages to provider for clientId: ${effectiveClientId}`
        )
        session.messageQueue.forEach((msg) => ws.send(msg.data, { binary: msg.isBinary }))
        session.messageQueue = []
      }

      ws.on('message', (data, isBinary) => {
        const byteLen = Buffer.isBuffer(data)
          ? data.length
          : Array.isArray(data)
          ? (data as Buffer[]).reduce((s, b) => s + (Buffer.isBuffer(b) ? b.length : 0), 0)
          : (data as ArrayBuffer).byteLength
        log.debug(
          `[BrowserRelay] provider->consumer clientId=${effectiveClientId} bytes=${byteLen}`
        )
        if (session.consumerWs?.readyState === ws.OPEN) {
          session.consumerWs.send(data, { binary: isBinary })
        }
      })

      ws.on('close', (code, reason) => {
        log.info(
          `[BrowserRelay] Provider disconnected clientId=${effectiveClientId} code=${code} reason=${
            reason?.toString() || 'none'
          }`
        )
        session.providerWs = null
        if (session.consumerWs) {
          session.consumerWs.close(1001, 'Provider disconnected')
        }
        if (!session.providerWs && !session.consumerWs) {
          this.sessions.delete(effectiveClientId)
        }
      })
    } else if (role === 'consumer') {
      // Playwright connecting
      if (session.consumerWs) {
        session.consumerWs.close(1000, 'Replaced by new consumer')
      }
      session.consumerWs = ws

      ws.on('message', (data, isBinary) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
        const size = buf.length
        const preview =
          size > 0
            ? buf
                .slice(0, Math.min(120, size))
                .toString('utf8')
                .replace(/[^\x20-\x7e]/g, '.')
            : 'n/a'
        log.debug(
          `[BrowserRelay] consumer->provider clientId=${effectiveClientId} bytes=${size} preview=${preview.slice(
            0,
            60
          )}`
        )
        if (session.providerWs?.readyState === ws.OPEN) {
          session.providerWs.send(data, { binary: isBinary })
        } else {
          log.warn(
            `[BrowserRelay] Received consumer message but provider is not connected for clientId: ${effectiveClientId}. Queuing.`
          )
          session.messageQueue.push({ data, isBinary })
        }
      })

      ws.on('close', (code, reason) => {
        log.info(
          `[BrowserRelay] Consumer disconnected clientId=${effectiveClientId} code=${code} reason=${
            reason?.toString() || 'none'
          }`
        )
        session.consumerWs = null
        if (!session.providerWs && !session.consumerWs) {
          this.sessions.delete(effectiveClientId)
        }
      })
    }

    ws.on('error', (err) => {
      log.error(`[BrowserRelay] ${role} connection error for clientId: ${effectiveClientId}`, err)
    })
  }

  /**
   * 当前是否有该 clientId 的 provider（Electron 节点）已连接
   */
  public hasProvider(clientId: string): boolean {
    const session = this.sessions.get(clientId)
    const OPEN = 1
    return session != null && session.providerWs != null && session.providerWs.readyState === OPEN
  }

  /**
   * 返回给 Playwright 调用的本地代理入口
   * @param port 当前 Prizm Server 的运行端口
   * @param clientId 目标客户端 ID
   */
  public getPlaywrightEndpoint(port: number | string, clientId: string): string {
    return `ws://localhost:${port}/api/v1/browser/relay?clientId=${clientId}&role=consumer`
  }

  public destroy(): void {
    this.sessions.forEach((session) => {
      session.providerWs?.close(1001, 'Server shutting down')
      session.consumerWs?.close(1001, 'Server shutting down')
    })
    this.sessions.clear()
    this.wss.close()
  }
}
