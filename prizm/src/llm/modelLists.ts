/**
 * 各提供商类型的预设模型列表（供 getAvailableModels 使用）
 */

export interface ModelOption {
  id: string
  label: string
}

export const OPENAI_COMPATIBLE_MODELS: ModelOption[] = [
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { id: 'gpt-4o-nano', label: 'GPT-4o Nano' },
  { id: 'o1-mini', label: 'o1 Mini' },
  { id: 'o1', label: 'o1' },
  { id: 'glm-4-flash', label: 'GLM-4 Flash' },
  { id: 'glm-4', label: 'GLM-4' },
  { id: 'glm-4-plus', label: 'GLM-4 Plus' },
  { id: 'mimo-v2-flash', label: 'MiMo v2 Flash' },
  { id: 'mimo-v2', label: 'MiMo v2' }
]

export const ANTHROPIC_MODELS: ModelOption[] = [
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
  { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus' }
]

export const GOOGLE_MODELS: ModelOption[] = [
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' }
]

export function getPresetModelsForType(type: string): ModelOption[] {
  switch (type) {
    case 'openai_compatible':
      return OPENAI_COMPATIBLE_MODELS
    case 'anthropic':
      return ANTHROPIC_MODELS
    case 'google':
      return GOOGLE_MODELS
    default:
      return OPENAI_COMPATIBLE_MODELS
  }
}
