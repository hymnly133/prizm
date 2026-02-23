/**
 * 浏览器控制：直接代理 Playwright，经 relay 连接客户端浏览器。
 * 无自定义语义，仅暴露：goto / snapshot / click / fill / select_option / get_text / close。
 */

import { createLogger } from '../../logger'
import { getConfig } from '../../config'
import {
  connectPlaywrightBrowser,
  getAccessibilitySnapshot,
  executeResolvedAct,
  getPageText,
  type PlaywrightBrowserSession,
  type SnapshotElement
} from '../playwrightBrowserSession'

const log = createLogger('BrowserTools')

const BROWSER_CONNECT_TIMEOUT_MS = 35_000
const BROWSER_ACTION_TIMEOUT_MS = 60_000
const PAGE_TEXT_MAX_CHARS = 30_000

function connectTimeoutMessage(clientId: string): string {
  return `Browser relay 连接超时（${
    BROWSER_CONNECT_TIMEOUT_MS / 1000
  }s）。请先在客户端启动「浏览器节点」并确保与当前会话的 clientId 一致（当前 clientId=${clientId}）。`
}

function actionTimeoutMessage(): string {
  return `浏览器操作超时（${BROWSER_ACTION_TIMEOUT_MS / 1000}s），请重试。`
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let settled = false
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error(message))
        promise.catch((realErr: unknown) => {
          const err = realErr as Error
          log.warn(
            `[BrowserTools] 超时后原始操作报错: ${err?.name ?? 'Error'}: ${err?.message ?? realErr}`
          )
        })
      }
    }, ms)
    promise.then(
      (val) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve(val)
        }
      },
      (err) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(err)
        }
      }
    )
  })
}

const activeSessions = new Map<string, PlaywrightBrowserSession>()
/** 每会话最近一次 snapshot 结果，供 click / fill / select_option 的 ref 使用 */
const lastSnapshotBySession = new Map<string, SnapshotElement[]>()

async function getOrCreateSession(
  sessionId: string,
  clientId: string
): Promise<PlaywrightBrowserSession> {
  let session = activeSessions.get(sessionId)
  if (session) return session

  const port = process.env.PORT || getConfig().port || 4127
  const cdpUrl = `ws://127.0.0.1:${port}/api/v1/browser/relay?clientId=${clientId}&role=consumer`

  log.info(`[BrowserTools] Creating Playwright session via Relay: ${cdpUrl}`)

  session = await withTimeout(
    connectPlaywrightBrowser(cdpUrl, { timeoutMs: BROWSER_CONNECT_TIMEOUT_MS }),
    BROWSER_CONNECT_TIMEOUT_MS,
    connectTimeoutMessage(clientId)
  )
  activeSessions.set(sessionId, session)
  log.info(`[BrowserTools] Playwright session initialized for ${sessionId}`)
  return session
}

async function runBrowserAction(
  sessionId: string,
  session: PlaywrightBrowserSession,
  action: string,
  args: { url?: string; ref?: number; value?: string }
): Promise<string> {
  const { page } = session
  const { url, ref, value } = args

  switch (action) {
    case 'goto': {
      if (url === undefined || url === '') throw new Error('url is required for goto')
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      return `ok: navigated to ${url}`
    }
    case 'snapshot': {
      const elements = await getAccessibilitySnapshot(page)
      lastSnapshotBySession.set(sessionId, elements)
      return JSON.stringify(elements)
    }
    case 'click': {
      if (ref === undefined || ref === null) throw new Error('ref is required for click')
      let snapshot = lastSnapshotBySession.get(sessionId)
      if (!snapshot?.length) {
        snapshot = await getAccessibilitySnapshot(page)
        lastSnapshotBySession.set(sessionId, snapshot)
      }
      await executeResolvedAct(page, snapshot, { ref, actionType: 'click' })
      return `ok: clicked ref ${ref}`
    }
    case 'fill': {
      if (ref === undefined || ref === null) throw new Error('ref is required for fill')
      if (value === undefined) throw new Error('value is required for fill')
      let snapshotFill = lastSnapshotBySession.get(sessionId)
      if (!snapshotFill?.length) {
        snapshotFill = await getAccessibilitySnapshot(page)
        lastSnapshotBySession.set(sessionId, snapshotFill)
      }
      await executeResolvedAct(page, snapshotFill, { ref, actionType: 'type', value })
      return `ok: filled ref ${ref}`
    }
    case 'select_option': {
      if (ref === undefined || ref === null) throw new Error('ref is required for select_option')
      if (value === undefined) throw new Error('value is required for select_option')
      let snapshotSel = lastSnapshotBySession.get(sessionId)
      if (!snapshotSel?.length) {
        snapshotSel = await getAccessibilitySnapshot(page)
        lastSnapshotBySession.set(sessionId, snapshotSel)
      }
      await executeResolvedAct(page, snapshotSel, { ref, actionType: 'select', value })
      return `ok: selected ref ${ref} = ${value}`
    }
    case 'get_text': {
      const text = await getPageText(page, PAGE_TEXT_MAX_CHARS)
      return text || ''
    }
    default:
      throw new Error(`Unknown browser action: ${action}`)
  }
}

export class BrowserExecutor {
  public toolName = 'prizm_browser'

  async execute(
    args: Record<string, unknown>,
    context: { clientId?: string; sessionId?: string }
  ): Promise<string> {
    const { action, url, ref, value } = args as {
      action?: string
      url?: string
      ref?: number
      value?: string
    }
    const clientId = context.clientId ?? 'unknown'
    const sessionId = context.sessionId ?? 'default'

    try {
      if (action === 'close') {
        const session = activeSessions.get(sessionId)
        if (session) {
          await session.close()
          activeSessions.delete(sessionId)
          lastSnapshotBySession.delete(sessionId)
          return 'ok: browser session closed'
        }
        return 'ok: no active session'
      }

      const session = await getOrCreateSession(sessionId, clientId)
      return await withTimeout(
        runBrowserAction(sessionId, session, action ?? '', { url, ref, value }),
        BROWSER_ACTION_TIMEOUT_MS,
        actionTimeoutMessage()
      )
    } catch (e: unknown) {
      const err = e as Error & {
        status?: number
        response?: { status?: number; data?: unknown }
        data?: unknown
        statusCode?: number
        body?: unknown
      }
      const status = err?.status ?? err?.response?.status ?? err?.statusCode
      const body = err?.response?.data ?? err?.data ?? err?.body
      const bodyStr = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : ''
      const statusPart = status != null ? ` status=${status}` : ''
      const bodyPart = bodyStr ? ` body=${bodyStr.slice(0, 500)}` : ''
      log.error(
        `[BrowserTools] Error during action '${action}': ${err?.message}${statusPart}${bodyPart}`
      )
      return `error: ${err?.message}`
    }
  }
}
