/**
 * LLM 提供商工厂与选择逻辑
 * 默认优先：XIAOMIMIMO_API_KEY > ZHIPU_API_KEY > OPENAI_API_KEY
 */

import type { ILLMProvider } from '../adapters/interfaces'
import { OpenAILikeLLMProvider } from './OpenAILikeProvider'
import { ZhipuLLMProvider } from './ZhipuProvider'
import { XiaomiMiMoLLMProvider } from './XiaomiMiMoProvider'

let _defaultProvider: ILLMProvider | null = null

/**
 * 根据环境变量选择 LLM 提供商
 * - XIAOMIMIMO_API_KEY: 小米 MiMo（默认优先）
 * - ZHIPU_API_KEY: 智谱 AI (GLM)
 * - OPENAI_API_KEY: OpenAI 或兼容 API
 */
export function getLLMProvider(): ILLMProvider {
  if (_defaultProvider) return _defaultProvider

  if (process.env.XIAOMIMIMO_API_KEY?.trim()) {
    _defaultProvider = new XiaomiMiMoLLMProvider()
  } else if (process.env.ZHIPU_API_KEY?.trim()) {
    _defaultProvider = new ZhipuLLMProvider()
  } else {
    _defaultProvider = new OpenAILikeLLMProvider()
  }

  return _defaultProvider
}

/**
 * 重置默认提供商（用于测试）
 */
export function resetLLMProvider(): void {
  _defaultProvider = null
}

/** 返回当前 LLM 提供商名称（用于 token 统计记录） */
export function getLLMProviderName(): string {
  const provider = getLLMProvider()
  if (provider instanceof XiaomiMiMoLLMProvider) return 'xiaomi'
  if (provider instanceof ZhipuLLMProvider) return 'zhipu'
  return 'openai'
}

/** 可用模型项，供客户端模型选择器使用 */
export interface AvailableModel {
  id: string
  label: string
  provider: 'xiaomi' | 'zhipu' | 'openai'
}

/** 各 Provider 支持的模型列表（参照 LobeHub 常用配置） */
const XIAOMI_MODELS: AvailableModel[] = [
  { id: 'mimo-v2-flash', label: 'MiMo v2 Flash', provider: 'xiaomi' },
  { id: 'mimo-v2', label: 'MiMo v2', provider: 'xiaomi' }
]

const ZHIPU_MODELS: AvailableModel[] = [
  { id: 'glm-4-flash', label: 'GLM-4 Flash', provider: 'zhipu' },
  { id: 'glm-4', label: 'GLM-4', provider: 'zhipu' },
  { id: 'glm-4-plus', label: 'GLM-4 Plus', provider: 'zhipu' }
]

const OPENAI_MODELS: AvailableModel[] = [
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', provider: 'openai' }
]

/**
 * 根据当前配置的 API Key 返回可用模型列表
 */
export function getAvailableModels(): { provider: string; models: AvailableModel[] } {
  if (process.env.XIAOMIMIMO_API_KEY?.trim()) {
    return { provider: 'xiaomi', models: XIAOMI_MODELS }
  }
  if (process.env.ZHIPU_API_KEY?.trim()) {
    return { provider: 'zhipu', models: ZHIPU_MODELS }
  }
  return { provider: 'openai', models: OPENAI_MODELS }
}

export { OpenAILikeLLMProvider } from './OpenAILikeProvider'
export { ZhipuLLMProvider } from './ZhipuProvider'
export { XiaomiMiMoLLMProvider } from './XiaomiMiMoProvider'
