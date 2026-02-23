/**
 * 使用 Stagehand 连接给定 CDP URL（Prizm relay），并暴露 act/observe/extract/goto/close。
 * 不启动新浏览器，仅复用已有 relay 连接。
 * 支持注入 llmClient（与 agent 同路径）；未注入时使用 model 配置由 Stagehand 自建 HTTP 客户端。
 */

import { Stagehand } from '@browserbasehq/stagehand'
import type { V3Options } from '@browserbasehq/stagehand'
import type {
  PrizmStagehandModelConfig,
  PrizmStagehandSession,
  PrizmStagehandSessionOptions
} from './types'

function toStagehandModelName(config: PrizmStagehandModelConfig): string {
  return `${config.provider}/${config.modelId}`
}

export async function createPrizmStagehandSession(
  options: PrizmStagehandSessionOptions
): Promise<PrizmStagehandSession> {
  const { cdpUrl, model, llmClient, actTimeoutMs, logger } = options
  if (!llmClient && !model) {
    throw new Error('createPrizmStagehandSession: 必须提供 model 或 llmClient 之一')
  }

  const stagehandOptions: V3Options = {
    env: 'LOCAL',
    experimental: true,
    localBrowserLaunchOptions: {
      cdpUrl,
      connectTimeoutMs: 35_000
    },
    actTimeoutMs: actTimeoutMs ?? 120_000,
    logger: logger
      ? (line: { message?: string; category?: string }) => {
          const msg = line.message ?? ''
          if (msg) logger(`[Stagehand] ${line.category ?? 'app'}: ${msg}`)
        }
      : undefined
  }

  if (llmClient) {
    stagehandOptions.llmClient = llmClient as V3Options['llmClient']
  } else {
    const m = model!
    stagehandOptions.model = {
      modelName: toStagehandModelName(m),
      apiKey: m.apiKey,
      baseURL: m.baseUrl
    }
  }

  const stagehand = new Stagehand(stagehandOptions)

  await stagehand.init()

  return {
    async goto(url: string, options) {
      const page = stagehand.context.pages()[0]
      if (page) {
        const waitUntil = options?.waitUntil ?? 'domcontentloaded'
        const timeoutMs = options?.timeoutMs ?? 60_000
        await page.goto(url, { waitUntil, timeoutMs })
      }
    },

    async act(instruction: string, options) {
      const result = await stagehand.act(instruction, options)
      return {
        success: result.success,
        message: result.message,
        actionDescription: result.actionDescription,
        actions: result.actions?.map((a) => ({
          selector: a.selector,
          description: a.description,
          method: a.method,
          arguments: a.arguments
        }))
      }
    },

    async observe(instruction?: string, options?) {
      const actions = instruction
        ? await stagehand.observe(instruction, options)
        : await stagehand.observe(options ?? {})
      return actions.map((a) => ({
        selector: a.selector,
        description: a.description,
        method: a.method,
        arguments: a.arguments
      }))
    },

    async extract(instruction?: string) {
      if (instruction === undefined || instruction === '') {
        const out = await stagehand.extract()
        const pageText =
          out && typeof out === 'object' && 'pageText' in out
            ? String((out as { pageText?: unknown }).pageText ?? '')
            : String(out ?? '')
        return { pageText }
      }
      const out = await stagehand.extract(instruction)
      if (out && typeof out === 'object' && 'extraction' in out) {
        return { extraction: String((out as { extraction?: unknown }).extraction ?? '') }
      }
      if (out && typeof out === 'object' && 'pageText' in out) {
        return { pageText: String((out as { pageText?: unknown }).pageText ?? '') }
      }
      return { extraction: String(out ?? '') }
    },

    async close() {
      await stagehand.close()
    }
  }
}
