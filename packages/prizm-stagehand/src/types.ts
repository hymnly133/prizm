/**
 * Prizm 侧传入的模型配置，用于映射到 Stagehand 的 ModelConfiguration。
 * 与 prizm server-config 的 LLM 配置解耦，由调用方（如 browserTools）解析后传入。
 */
export interface PrizmStagehandModelConfig {
  /** 提供商：openai_compatible -> openai, anthropic -> anthropic, google -> google */
  provider: 'openai' | 'anthropic' | 'google'
  /** 模型 ID，如 gpt-4o、claude-3-5-sonnet-20241022、gemini-2.0-flash */
  modelId: string
  apiKey: string
  /** 仅 openai_compatible 时使用 */
  baseUrl?: string
}

/** 与 Stagehand 的 LLMClient 兼容的客户端（如 PrizmStagehandLLMClient）；传入时不再使用 model 配置 */
export type PrizmStagehandLLMClientLike = {
  type: string
  modelName: string
  hasVision?: boolean
  createChatCompletion(options: unknown): Promise<{ data: unknown; usage?: unknown }>
}

export interface PrizmStagehandSessionOptions {
  /** 浏览器 CDP WebSocket URL（Prizm relay 的 consumer 地址） */
  cdpUrl: string
  /** 模型配置；与 llmClient 二选一。传 llmClient 时由调用方（如 Prizm）注入与 agent 同路径的 client */
  model?: PrizmStagehandModelConfig
  /** 可选：注入的 LLM 客户端；传入则 new Stagehand({ llmClient })，不再传 model */
  llmClient?: PrizmStagehandLLMClientLike
  /** 可选：act 超时 ms */
  actTimeoutMs?: number
  /** 可选：自定义 logger */
  logger?: (message: string) => void
}

/** 与 Stagehand Action 对齐：单步动作描述 */
export interface PrizmStagehandAction {
  selector: string
  description: string
  method?: string
  arguments?: string[]
}

export interface PrizmStagehandActResult {
  success: boolean
  message: string
  actionDescription?: string
  actions?: PrizmStagehandAction[]
}

/** act 可选参数，与 Stagehand ActOptions 对齐（不包含 model/page） */
export interface PrizmStagehandActOptions {
  variables?: Record<string, string>
  timeout?: number
}

/** observe 可选参数，与 Stagehand ObserveOptions 对齐（不包含 model/page） */
export interface PrizmStagehandObserveOptions {
  timeout?: number
  selector?: string
}

/** goto 可选参数，与 Stagehand page.goto 对齐 */
export interface PrizmStagehandGotoOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'
  timeoutMs?: number
}

export interface PrizmStagehandSession {
  /** 跳转 */
  goto(url: string, options?: PrizmStagehandGotoOptions): Promise<void>
  /** 自然语言执行单步/多步操作 */
  act(instruction: string, options?: PrizmStagehandActOptions): Promise<PrizmStagehandActResult>
  /** 观察页面可执行动作（可选 instruction） */
  observe(
    instruction?: string,
    options?: PrizmStagehandObserveOptions
  ): Promise<PrizmStagehandAction[]>
  /** 无参：返回整页文本；有 instruction 时按自然语言抽取。返回 { pageText } 或 { extraction } */
  extract(instruction?: string): Promise<{ pageText?: string; extraction?: string }>
  /** 关闭会话并释放连接 */
  close(): Promise<void>
}
