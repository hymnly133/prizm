/**
 * 按 configId 缓存 ILLMProvider，配置变更时清空
 */

import type { ILLMProvider } from '../../adapters/interfaces'
import type { LLMConfigItem } from '../../settings/serverConfigTypes'
import { createAISDKProvider } from './bridge'

const cache = new Map<string, ILLMProvider>()

export function getProviderForConfig(config: LLMConfigItem): ILLMProvider {
  const key = config.id
  let provider = cache.get(key)
  if (!provider) {
    provider = createAISDKProvider(config)
    cache.set(key, provider)
  }
  return provider
}

export function clearProviderCache(): void {
  cache.clear()
}
