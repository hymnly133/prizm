import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ServerConfigLLM, LLMConfigItem } from '../settings/serverConfigTypes'

vi.mock('../config', () => ({
  getConfig: () => ({ dataDir: '/tmp' })
}))

const mockGetEffectiveServerConfig = vi.fn()
const mockSanitizeServerConfig = vi.fn()
vi.mock('../settings/serverConfigStore', () => ({
  getEffectiveServerConfig: (dataDir: string) => mockGetEffectiveServerConfig(dataDir),
  sanitizeServerConfig: (config: unknown) => mockSanitizeServerConfig(config)
}))

const mockGetProviderForConfig = vi.fn()
vi.mock('./aiSdkBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./aiSdkBridge')>()
  return {
    ...actual,
    getProviderForConfig: (config: LLMConfigItem) => mockGetProviderForConfig(config),
    resolveModel: actual.resolveModel
  }
})

beforeEach(async () => {
  vi.clearAllMocks()
  const { resetLLMProvider } = await import('./index')
  resetLLMProvider()
})

describe('getLLMProvider', () => {
  it('无 configs 时返回 null', async () => {
    mockGetEffectiveServerConfig.mockReturnValue({ llm: { configs: [] } })
    const { getLLMProvider } = await import('./index')
    expect(getLLMProvider()).toBeNull()
  })

  it('默认配置无 apiKey 时返回 null', async () => {
    mockGetEffectiveServerConfig.mockReturnValue({
      llm: {
        configs: [{ id: 'c1', name: 'Test', type: 'openai_compatible', apiKey: '' }]
      }
    })
    const { getLLMProvider } = await import('./index')
    expect(getLLMProvider()).toBeNull()
  })

  it('有默认配置且含 apiKey 时返回 provider', async () => {
    const fakeProvider = { chat: async function* () {} }
    mockGetProviderForConfig.mockReturnValue(fakeProvider)
    mockGetEffectiveServerConfig.mockReturnValue({
      llm: {
        configs: [{ id: 'c1', name: 'OpenAI', type: 'openai_compatible', apiKey: 'sk-xxx' }]
      }
    })
    const { getLLMProvider } = await import('./index')
    expect(getLLMProvider()).toBe(fakeProvider)
    expect(mockGetProviderForConfig).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', apiKey: 'sk-xxx' })
    )
  })

  it('使用 defaultConfigId 指定的配置', async () => {
    const fakeProvider = { chat: async function* () {} }
    mockGetProviderForConfig.mockReturnValue(fakeProvider)
    mockGetEffectiveServerConfig.mockReturnValue({
      llm: {
        defaultConfigId: 'c2',
        configs: [
          { id: 'c1', name: 'A', type: 'openai_compatible', apiKey: 'key1' },
          { id: 'c2', name: 'B', type: 'openai_compatible', apiKey: 'key2' }
        ]
      }
    })
    const { getLLMProvider } = await import('./index')
    expect(getLLMProvider()).toBe(fakeProvider)
    expect(mockGetProviderForConfig).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c2', apiKey: 'key2' })
    )
  })
})

describe('getProviderForModel', () => {
  it('无 configs 时返回 null', async () => {
    mockGetEffectiveServerConfig.mockReturnValue({ llm: { configs: [] } })
    const { getProviderForModel } = await import('./index')
    expect(getProviderForModel('gpt-4o')).toBeNull()
  })

  it('仅 modelId 时使用默认配置与传入的 modelId', async () => {
    const fakeProvider = { chat: async function* () {} }
    mockGetProviderForConfig.mockReturnValue(fakeProvider)
    const defaultConfig = {
      id: 'c1',
      name: 'OpenAI',
      type: 'openai_compatible',
      apiKey: 'sk-xxx',
      defaultModel: 'gpt-4o-mini'
    }
    mockGetEffectiveServerConfig.mockReturnValue({
      llm: { configs: [defaultConfig] }
    })
    const { getProviderForModel } = await import('./index')
    const result = getProviderForModel('gpt-4o')
    expect(result).not.toBeNull()
    expect(result!.provider).toBe(fakeProvider)
    expect(result!.modelId).toBe('gpt-4o')
    expect(result!.config.id).toBe('c1')
  })

  it('configId:modelId 时使用指定配置', async () => {
    const fakeProvider = { chat: async function* () {} }
    mockGetProviderForConfig.mockReturnValue(fakeProvider)
    const c2 = { id: 'c2', name: 'Zhipu', type: 'openai_compatible', apiKey: 'zhipu-key' }
    mockGetEffectiveServerConfig.mockReturnValue({
      llm: {
        configs: [
          { id: 'c1', name: 'OpenAI', type: 'openai_compatible', apiKey: 'sk-xxx' },
          c2
        ]
      }
    })
    const { getProviderForModel } = await import('./index')
    const result = getProviderForModel('c2:glm-4-flash')
    expect(result).not.toBeNull()
    expect(result!.modelId).toBe('glm-4-flash')
    expect(result!.config.id).toBe('c2')
    expect(mockGetProviderForConfig).toHaveBeenCalledWith(expect.objectContaining({ id: 'c2' }))
  })
})

describe('getAvailableModels', () => {
  it('无 configs 时返回空列表', async () => {
    mockGetEffectiveServerConfig.mockReturnValue({ llm: { configs: [] } })
    mockSanitizeServerConfig.mockImplementation((c: { llm?: ServerConfigLLM }) => c)
    const { getAvailableModels } = await import('./index')
    const res = getAvailableModels()
    expect(res.configs).toEqual([])
    expect(res.models).toEqual([])
  })

  it('有已配置的 config 时返回脱敏 configs 与模型列表', async () => {
    mockGetEffectiveServerConfig.mockReturnValue({
      llm: {
        configs: [
          {
            id: 'c1',
            name: 'OpenAI',
            type: 'openai_compatible',
            apiKey: 'sk-xxx',
            defaultModel: 'gpt-4o-mini'
          }
        ]
      }
    })
    mockSanitizeServerConfig.mockImplementation((c: unknown) => {
      const cfg = c as { llm?: ServerConfigLLM }
      return {
        ...cfg,
        llm: cfg.llm
          ? {
              ...cfg.llm,
              configs: (cfg.llm.configs ?? []).map((x) => ({
                ...x,
                configured: true
              }))
            }
          : undefined
      }
    })
    const { getAvailableModels } = await import('./index')
    const res = getAvailableModels()
    expect(res.configs.length).toBeGreaterThan(0)
    expect(res.configs[0]).toMatchObject({ id: 'c1', name: 'OpenAI', configured: true })
    expect(res.models.some((m) => m.configId === 'c1' && m.modelId === 'gpt-4o-mini')).toBe(true)
  })
})

describe('getLLMProviderName', () => {
  it('无 configs 时返回 unknown', async () => {
    mockGetEffectiveServerConfig.mockReturnValue({ llm: { configs: [] } })
    const { getLLMProviderName } = await import('./index')
    expect(getLLMProviderName()).toBe('unknown')
  })

  it('有默认配置时返回配置 name', async () => {
    mockGetEffectiveServerConfig.mockReturnValue({
      llm: {
        configs: [{ id: 'c1', name: 'My OpenAI', type: 'openai_compatible', apiKey: 'x' }]
      }
    })
    const { getLLMProviderName } = await import('./index')
    expect(getLLMProviderName()).toBe('My OpenAI')
  })
})

describe('resetLLMProvider', () => {
  it('可调用且不抛错', async () => {
    const { resetLLMProvider } = await import('./index')
    expect(() => resetLLMProvider()).not.toThrow()
  })
})
