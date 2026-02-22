/**
 * LLM 配置独立设置页：多配置、API Key、默认配置，带单独「保存 LLM 配置」按钮
 */
import { Button, Form, Input, Text, toast } from '@lobehub/ui'
import { Select } from './ui/Select'
import type {
  ServerConfigLLM,
  LLMConfigItem,
  LLMProviderType
} from '@prizm/client-core'
import { useCallback, useEffect, useState } from 'react'
import type { PrizmClient } from '@prizm/client-core'
import { Key, Plus, Trash2 } from 'lucide-react'

const LLM_PROVIDER_OPTIONS: { value: LLMProviderType; label: string }[] = [
  { value: 'openai_compatible', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' }
]

function genId(): string {
  return `llm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

interface LLMConfigSettingsProps {
  http: PrizmClient | null
  onLog?: (msg: string, type: 'info' | 'success' | 'error' | 'warning') => void
}

export function LLMConfigSettings({ http, onLog }: LLMConfigSettingsProps) {
  const [configs, setConfigs] = useState<(LLMConfigItem & { id: string })[]>([])
  const [defaultConfigId, setDefaultConfigId] = useState<string | undefined>(undefined)
  const [configuredMap, setConfiguredMap] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!http) return
    setLoading(true)
    try {
      const res = await http.getServerConfig()
      const llm = res.llm ?? { configs: [] }
      const list = Array.isArray(llm.configs) ? llm.configs : []
      setConfigs(
        list.map((c) => ({
          id: (c as { id?: string }).id ?? genId(),
          name: (c as { name?: string }).name ?? '新配置',
          type: (c as { type?: LLMProviderType }).type ?? 'openai_compatible',
          baseUrl: (c as { baseUrl?: string }).baseUrl,
          defaultModel: (c as { defaultModel?: string }).defaultModel,
          apiKey: (c as { apiKey?: string }).apiKey,
          configured: (c as { configured?: boolean }).configured
        }))
      )
      setDefaultConfigId(llm.defaultConfigId)
      const raw = res.llm as { configs?: { id: string; configured?: boolean }[] } | undefined
      setConfiguredMap(
        raw?.configs ? Object.fromEntries(raw.configs.map((c) => [c.id, !!c.configured])) : {}
      )
    } catch (e) {
      onLog?.(`加载 LLM 配置失败: ${e}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [http, onLog])

  useEffect(() => {
    void load()
  }, [load])

  const updateConfig = (index: number, patch: Partial<LLMConfigItem>) => {
    setConfigs((prev) => {
      const next = [...prev]
      next[index] = { ...next[index]!, ...patch }
      return next
    })
  }

  const addConfig = () => {
    const newId = genId()
    setConfigs((prev) => [
      ...prev,
      { id: newId, name: '新配置', type: 'openai_compatible' }
    ])
    setDefaultConfigId((prev) => prev || newId)
  }

  const removeConfig = (index: number) => {
    const removedId = configs[index]?.id
    setConfigs((prev) => prev.filter((_, i) => i !== index))
    setDefaultConfigId((prev) =>
      prev === removedId ? configs[index + 1]?.id ?? configs[index - 1]?.id : prev
    )
  }

  async function handleSave() {
    if (!http) return
    setSaving(true)
    try {
      const patch: ServerConfigLLM = {
        configs: configs.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          baseUrl: c.baseUrl,
          defaultModel: c.defaultModel,
          apiKey: c.apiKey
        })),
        defaultConfigId: defaultConfigId || configs[0]?.id
      }
      await http.updateServerConfig({ llm: patch })
      toast.success('LLM 配置已保存')
      onLog?.('LLM 配置已保存', 'success')
      void load()
    } catch (e) {
      toast.error(String(e))
      onLog?.(`保存 LLM 配置失败: ${e}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Text type="secondary">加载中...</Text>

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>LLM 配置</h2>
        <p className="form-hint">
          添加一个或多个 LLM 提供商（OpenAI 兼容 / Anthropic / Google），至少配置一个 API
          Key。可选设默认配置与默认模型。
        </p>
      </div>

      <div className="settings-card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {configs.map((c, i) => (
            <div
              key={c.id}
              style={{
                border: '1px solid var(--ant-color-border)',
                borderRadius: 8,
                padding: 12
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="radio"
                    name="llm-default"
                    checked={defaultConfigId === c.id}
                    onChange={() => setDefaultConfigId(c.id)}
                  />
                  <span>默认</span>
                </label>
                <Button
                  type="text"
                  size="small"
                  icon={<Trash2 size={14} />}
                  onClick={() => removeConfig(i)}
                />
              </div>
              <Form layout="vertical" gap={8}>
                <Form.Item label="名称">
                  <Input
                    value={c.name}
                    onChange={(e) =>
                      updateConfig(i, { name: e.target.value.trim() || '新配置' })
                    }
                    placeholder="例如：OpenAI 官方"
                  />
                </Form.Item>
                <Form.Item label="类型">
                  <Select
                    value={c.type}
                    onChange={(v) => updateConfig(i, { type: v as LLMProviderType })}
                    options={LLM_PROVIDER_OPTIONS}
                  />
                </Form.Item>
                <Form.Item label="API Key">
                  <Input
                    type="password"
                    value={c.apiKey ?? ''}
                    onChange={(e) => updateConfig(i, { apiKey: e.target.value || undefined })}
                    placeholder={
                      configuredMap[c.id] ? '已配置，输入新值覆盖' : 'API Key'
                    }
                  />
                </Form.Item>
                {c.type === 'openai_compatible' && (
                  <Form.Item label="Base URL">
                    <Input
                      value={c.baseUrl ?? ''}
                      onChange={(e) =>
                        updateConfig(i, { baseUrl: e.target.value.trim() || undefined })
                      }
                      placeholder="https://api.openai.com/v1"
                    />
                  </Form.Item>
                )}
                <Form.Item label="默认模型">
                  <Input
                    value={c.defaultModel ?? ''}
                    onChange={(e) =>
                      updateConfig(i, {
                        defaultModel: e.target.value.trim() || undefined
                      })
                    }
                    placeholder={
                      c.type === 'openai_compatible'
                        ? 'gpt-4o-mini'
                        : c.type === 'anthropic'
                          ? 'claude-sonnet-4-20250514'
                          : 'gemini-2.0-flash'
                    }
                  />
                </Form.Item>
              </Form>
            </div>
          ))}
          <Button type="dashed" icon={<Plus size={14} />} onClick={addConfig}>
            添加 LLM 配置
          </Button>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Button
          type="primary"
          icon={<Key size={14} />}
          onClick={() => void handleSave()}
          loading={saving}
        >
          保存 LLM 配置
        </Button>
      </div>
    </div>
  )
}
