/**
 * 浏览器 Relay 状态与 Playground 测试 API
 * 供设置页「浏览器节点」Playground 测试连接与执行测试导航。
 */

import type { Router, Request, Response } from 'express'
import type { BrowserRelayServer } from '../websocket/BrowserRelayServer'
import { BrowserExecutor } from '../llm/builtinTools/browserTools'
import { createLogger } from '../logger'

const log = createLogger('BrowserRoutes')

const PLAYGROUND_SESSION_ID = '__playground__'

export function createBrowserRoutes(
  router: Router,
  getRelayServer: () => BrowserRelayServer | undefined
): void {
  /**
   * GET /api/v1/browser/relay/status
   * 返回当前客户端在 Relay 上是否有 provider 连接（用于 Playground 测试连接）
   */
  router.get('/api/v1/browser/relay/status', (req: Request, res: Response) => {
    const clientId = req.prizmClient?.clientId
    if (!clientId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const relay = getRelayServer()
    if (!relay) {
      return res.status(503).json({
        error: 'Browser relay not available (server may not be fully started)'
      })
    }
    const providerConnected = relay.hasProvider(clientId)
    res.json({ providerConnected })
  })

  /**
   * POST /api/v1/browser/test
   * Body: { action: 'navigate'|'act'|'extract'|'observe'|'close', url?: string, instruction?: string }
   * 使用 __playground__ 会话执行浏览器操作，供 Playground 测试全部 agent 可用的浏览器功能。
   */
  router.post('/api/v1/browser/test', async (req: Request, res: Response) => {
    const clientId = req.prizmClient?.clientId
    if (!clientId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const relay = getRelayServer()
    if (!relay) {
      return res.status(503).json({
        error: 'Browser relay not available (server may not be fully started)'
      })
    }

    const action = (req.body?.action as string) || 'navigate'

    // close 不需要 provider 连接
    if (action !== 'close' && !relay.hasProvider(clientId)) {
      return res.status(400).json({
        error: 'No browser provider connected. Start the browser node in the client first.'
      })
    }

    const url = typeof req.body?.url === 'string' ? req.body.url : undefined
    const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction : undefined

    try {
      const executor = new BrowserExecutor()
      const resultText = await executor.execute(
        { action, url, instruction },
        { clientId, sessionId: PLAYGROUND_SESSION_ID }
      )
      const isError = typeof resultText === 'string' && resultText.startsWith('Failed')
      res.json({ success: !isError, message: resultText })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error('[BrowserRoutes] Playground test failed:', e)
      res.status(500).json({ error: msg })
    }
  })
}
