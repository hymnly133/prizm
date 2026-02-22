import { Stagehand } from '@browserbasehq/stagehand'
import { createLogger } from '../../logger'
import { getConfig } from '../../config'
import { getEffectiveServerConfig } from '../../settings/serverConfigStore'
import { resolveModel } from '../aiSdkBridge/resolveModel'

const log = createLogger('BrowserTools')

/**
 * 获取供 Stagehand observe/act/extract 使用的 LLM 配置。
 * Stagehand 需要具体模型（modelName + apiKey + baseURL）。优先 llm.browserModel，未设置时用系统默认模型。
 * 仅支持 OpenAI 兼容端点。
 */
function getStagehandModelOption():
  | { modelName: string; apiKey: string; baseURL?: string }
  | undefined {
  const config = getEffectiveServerConfig(getConfig().dataDir)
  const llm = config.llm
  if (!llm?.configs?.length) return undefined

  const modelStr = llm.browserModel?.trim() || llm.defaultModel?.trim()
  const resolved = resolveModel(modelStr, llm)
  if (!resolved?.config?.apiKey?.trim()) return undefined
  if (resolved.config.type !== 'openai_compatible') {
    log.warn(
      `[BrowserTools] Stagehand 仅支持 OpenAI 兼容端点，当前选中 LLM 为 ${resolved.config.type}，observe/act/extract 可能失败`
    )
    return undefined
  }
  return {
    modelName: resolved.modelId,
    apiKey: resolved.config.apiKey,
    baseURL: resolved.config.baseUrl?.trim() || undefined
  }
}

/** 连接/探活超时：init 或首次 CDP 往返，用于快速发现「未启动浏览器节点」等无 provider 情况。 */
const BROWSER_CONNECT_TIMEOUT_MS = 35_000
/** 实际执行超时：navigate/act/extract/observe 允许慢页、慢操作。 */
const BROWSER_ACTION_TIMEOUT_MS = 120_000
/** navigate 页面加载超时：超时后先失败，避免因 CDP 断开一直等到总超时。 */
const BROWSER_NAVIGATE_TIMEOUT_MS = 60_000

function connectTimeoutMessage(clientId: string): string {
  return `Browser relay 连接超时（${
    BROWSER_CONNECT_TIMEOUT_MS / 1000
  }s）。请先在客户端启动「浏览器节点」并确保与当前会话的 clientId 一致（当前 clientId=${clientId}）。`
}

function actionTimeoutMessage(): string {
  return `浏览器操作超时（${
    BROWSER_ACTION_TIMEOUT_MS / 1000
  }s），请重试或简化操作。若浏览器节点已断开，请重新打开「浏览器节点」后再试。`
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ])
}

// Keep track of the active browser instances per session/run
const activeStagehands = new Map<string, Stagehand>()

export class BrowserExecutor {
  public toolName = 'prizm_browser'

  async execute(args: Record<string, any>, context: any): Promise<any> {
    const { action, url, instruction } = args
    const clientId = context.clientId || 'unknown' // Needs to map from user session
    const sessionId = context.sessionId || 'default'

    try {
      // 1. Get or Create Stagehand Instance for this session
      let stagehand = activeStagehands.get(sessionId)

      if (action === 'close') {
        if (stagehand) {
          await stagehand.close()
          activeStagehands.delete(sessionId)
          return 'Browser session closed.'
        }
        return 'No active browser session to close.'
      }

      if (!stagehand) {
        const port = process.env.PORT || getConfig().port || 4127
        // Use 127.0.0.1 to avoid localhost resolving to IPv6 (::1) and ECONNREFUSED when server listens on 127.0.0.1
        const wsEndpoint = `ws://127.0.0.1:${port}/api/v1/browser/relay?clientId=${clientId}&role=consumer`

        log.info(`[BrowserTools] Connecting Stagehand to CDP via Relay: ${wsEndpoint}`)

        const initStagehand = async (): Promise<Stagehand> => {
          const modelOption = getStagehandModelOption()
          if (!modelOption) {
            log.warn(
              '[BrowserTools] 未配置 OpenAI 兼容 LLM，observe/act/extract 将需要 OPENAI_API_KEY 环境变量'
            )
          }
          const sh = new Stagehand({
            env: 'LOCAL',
            ...(modelOption && { model: modelOption }),
            localBrowserLaunchOptions: {
              cdpUrl: wsEndpoint
            }
          })
          await sh.init()
          return sh
        }

        stagehand = await withTimeout(
          initStagehand(),
          BROWSER_CONNECT_TIMEOUT_MS,
          connectTimeoutMessage(clientId)
        )
        activeStagehands.set(sessionId, stagehand)
        log.info(`[BrowserTools] Stagehand initialized for session ${sessionId}`)
      }

      // Playground sessions skip the probe step since navigate will create a page anyway
      if (sessionId !== '__playground__') {
        const probe = async (): Promise<void> => {
          const pages = stagehand!.context.pages()
          if (pages.length === 0) await stagehand!.context.newPage()
        }
        await withTimeout(probe(), BROWSER_CONNECT_TIMEOUT_MS, connectTimeoutMessage(clientId))
      }
      const runAction = async (): Promise<string> => {
        switch (action) {
          case 'navigate':
            if (!url) throw new Error('url is required for navigate action')
            const pages = stagehand!.context.pages()
            const page = pages.length > 0 ? pages[0] : await stagehand!.context.newPage()
            await page.goto(url, { timeoutMs: BROWSER_NAVIGATE_TIMEOUT_MS })
            return `Navigated to ${url}`

          case 'act':
            if (!instruction) throw new Error('instruction is required for act action')
            const actRes = await stagehand!.act(instruction)
            return `Action completed: ${instruction}. Success: ${actRes.success}`

          case 'extract':
            if (!instruction) throw new Error('instruction is required for extract action')
            const extractRes = await stagehand!.extract(instruction)
            return `Extracted data: ${JSON.stringify(extractRes)}`

          case 'observe':
            if (!instruction) throw new Error('instruction is required for observe action')
            const observations = await stagehand!.observe(instruction)
            return `Observations: ${JSON.stringify(observations)}`

          default:
            throw new Error(`Unknown browser action: ${action}`)
        }
      }

      return await withTimeout(runAction(), BROWSER_ACTION_TIMEOUT_MS, actionTimeoutMessage())
    } catch (e: any) {
      const status = e?.status ?? e?.response?.status ?? e?.statusCode
      const body = e?.response?.data ?? e?.data ?? e?.body
      const bodyStr = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : ''
      const statusPart = status != null ? ` status=${status}` : ''
      const bodyPart = bodyStr ? ` body=${bodyStr.slice(0, 500)}` : ''
      log.error(
        `[BrowserTools] Error during action '${action}': ${e?.message}${statusPart}${bodyPart}`
      )
      if (status === 400 && (action === 'observe' || action === 'extract')) {
        log.warn(
          '[BrowserTools] observe/extract 会向 LLM 发送页面截图（vision）。若当前模型不支持多模态，请换用支持 vision 的模型或兼容接口。'
        )
      }
      return `Failed to execute ${action}: ${e.message}`
    }
  }
}
