/**
 * LLM 配置：仅填类型、Base URL、API Key；保存后自动刷新 (配置:模型) 列表，可选系统默认模型
 */
import { Button, Form, Input, TextArea, toast } from '@lobehub/ui'
import { Select } from './ui/Select'
import type { ServerConfigLLM, LLMConfigItem, LLMProviderType } from '@prizm/client-core'
import {
  buildModelSelectOptionsFromEntries,
  type ModelEntryLike
} from '../utils/modelSelectOptions'
import { useCallback, useEffect, useState } from 'react'
import type { PrizmClient } from '@prizm/client-core'
import { Key, Plus, Trash2 } from 'lucide-react'
import { LoadingPlaceholder } from './ui/LoadingPlaceholder'

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
  type ConfigRow = Pick<LLMConfigItem, 'id' | 'type' | 'baseUrl' | 'apiKey'> & {
    name?: string
    customModelList?: string
  }
  const [configs, setConfigs] = useState<ConfigRow[]>([])
  const [defaultModel, setDefaultModel] = useState<string | undefined>(undefined)
  const [configuredMap, setConfiguredMap] = useState<Record<string, boolean>>({})
  const [entries, setEntries] = useState<ModelEntryLike[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingIndex, setSavingIndex] = useState<number | null>(null)
  const [modelsRefreshing, setModelsRefreshing] = useState(false)

  const loadConfig = useCallback(async () => {
    if (!http) return
    setLoading(true)
    try {
      const res = await http.getServerConfig()
      const llm = res.llm ?? { configs: [] }
      const list = Array.isArray(llm.configs) ? llm.configs : []
      setConfigs(
        list.map((c) => ({
          id: (c as { id?: string }).id ?? genId(),
          name: (c as { name?: string }).name,
          type: (c as { type?: LLMProviderType }).type ?? 'openai_compatible',
          baseUrl: (c as { baseUrl?: string }).baseUrl,
          apiKey: (c as { apiKey?: string }).apiKey,
          customModelList: (c as { customModelList?: string }).customModelList
        }))
      )
      setDefaultModel((llm as { defaultModel?: string }).defaultModel)
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

  const loadModels = useCallback(async () => {
    if (!http) return
    setModelsRefreshing(true)
    try {
      const res = (await http.getAgentModels()) as {
        entries?: ModelEntryLike[]
        defaultModel?: string
      }
      setEntries(res.entries ?? [])
      if (res.defaultModel !== undefined) setDefaultModel(res.defaultModel)
    } catch {
      setEntries([])
    } finally {
      setModelsRefreshing(false)
    }
  }, [http])

  const load = useCallback(async () => {
    await loadConfig()
    await loadModels()
  }, [loadConfig, loadModels])

  useEffect(() => {
    void load()
  }, [load])

  const updateConfig = (index: number, patch: Partial<ConfigRow>) => {
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
      { id: newId, type: 'openai_compatible' as const, customModelList: undefined }
    ])
  }

  const removeConfig = async (index: number) => {
    const next = configs.filter((_, i) => i !== index)
    setConfigs(next)
    if (!http) return
    setSaving(true)
    try {
      await http.updateServerConfig({
        llm: {
          configs: next.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            baseUrl: c.baseUrl,
            customModelList: c.customModelList
          }))
        }
      })
      toast.success('已删除该配置')
      await loadConfig()
      await loadModels()
    } catch (e) {
      toast.error(String(e))
      setConfigs(configs)
      onLog?.(`删除配置失败: ${e}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  /** 仅保存当前卡片对应的一条配置，不触碰其他配置的 API Key */
  async function saveOneConfig(index: number) {
    if (!http) return
    const c = configs[index]
    if (!c?.id || !c?.type) return
    setSavingIndex(index)
    try {
      const updateConfig: {
        id: string
        name?: string
        type: LLMProviderType
        baseUrl?: string
        apiKey?: string
        customModelList?: string
      } = {
        id: c.id,
        type: c.type,
        name: c.name,
        baseUrl: c.baseUrl,
        customModelList: c.customModelList
      }
      if (c.apiKey?.trim()) updateConfig.apiKey = c.apiKey.trim()
      await http.updateServerConfig({
        llm: { updateConfig }
      } as unknown as Parameters<typeof http.updateServerConfig>[0])
      toast.success('该配置已保存')
      await loadConfig()
      await loadModels()
    } catch (e) {
      toast.error(String(e))
      onLog?.(`保存该配置失败: ${e}`, 'error')
    } finally {
      setSavingIndex(null)
    }
  }

  /** 仅保存系统默认模型，不发送 configs，避免误覆盖其他配置的 API Key */
  async function handleSaveDefaultOnly() {
    if (!http) return
    setSaving(true)
    try {
      await http.updateServerConfig({
        llm: {
          defaultModel: defaultModel || undefined
        }
      } as unknown as Parameters<typeof http.updateServerConfig>[0])
      toast.success('默认模型已保存')
      await loadConfig()
      await loadModels()
    } catch (e) {
      toast.error(String(e))
      onLog?.(`保存失败: ${e}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  /** 按配置名分组，用于展示「各配置提供的模型」 */
  const entriesByConfig = entries.reduce<Record<string, ModelEntryLike[]>>((acc, e) => {
    const name = e.configName || e.configId
    if (!acc[name]) acc[name] = []
    acc[name].push(e)
    return acc
  }, {})

  const resolvedDefaultLabel =
    (defaultModel && entries.find((e) => `${e.configId}:${e.modelId}` === defaultModel)?.label) ||
    undefined

  const defaultModelOptions = buildModelSelectOptionsFromEntries(entries, {
    label: '未设置',
    value: ''
  })

  if (loading) return <LoadingPlaceholder />

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>LLM 配置</h2>
        <p className="form-hint">
          每个配置单独保存，避免误覆盖其他配置的 API Key。填写类型、Base URL、API Key
          后点击该卡片「保存」；系统默认模型在下方选择后点击「保存默认模型」。
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
                <Button
                  type="primary"
                  size="small"
                  onClick={() => void saveOneConfig(i)}
                  loading={savingIndex === i}
                  disabled={savingIndex !== null}
                >
                  保存
                </Button>
                <Button
                  type="text"
                  size="small"
                  icon={<Trash2 size={14} />}
                  onClick={() => void removeConfig(i)}
                  disabled={savingIndex !== null}
                />
              </div>
              <Form layout="vertical" gap={8}>
                <Form.Item
                  label="名称"
                  extra="留空则根据类型与 Base URL 自动生成，用于区分多套配置"
                >
                  <Input
                    value={c.name ?? ''}
                    onChange={(e) => updateConfig(i, { name: e.target.value.trim() || undefined })}
                    placeholder="例如：OpenAI 官方、自建 API"
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
                    placeholder={configuredMap[c.id] ? '已配置，输入新值覆盖' : 'API Key'}
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
                <Form.Item
                  label="自定义模型列表"
                  extra="每行一个：仅填 modelId，或 modelId 显示名，或 modelId, 显示名。会与接口/预设列表合并，便于补充视觉模型等"
                >
                  <TextArea
                    value={c.customModelList ?? ''}
                    onChange={(e) =>
                      updateConfig(i, { customModelList: e.target.value || undefined })
                    }
                    placeholder={'例如：\nglm-4v\nglm-4v-plus, GLM-4V Plus（视觉）'}
                    rows={3}
                    style={{ fontFamily: 'inherit' }}
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

      {(entries.length > 0 || modelsRefreshing) && (
        <div className="settings-card" style={{ marginTop: 16 }}>
          <p className="form-hint" style={{ marginBottom: 4 }}>
            {modelsRefreshing ? '正在刷新可用模型列表…' : '系统默认模型（下游未指定时使用）'}
          </p>
          {!modelsRefreshing && (
            <p className="form-hint" style={{ marginBottom: 8, fontWeight: 500 }}>
              当前系统默认：{resolvedDefaultLabel ?? '未设置'}
            </p>
          )}
          <Select
            options={defaultModelOptions}
            value={defaultModel ?? ''}
            onChange={(v) => setDefaultModel(v || undefined)}
            style={{ maxWidth: 360 }}
            disabled={modelsRefreshing}
          />
          {entries.length > 0 && !modelsRefreshing && (
            <p className="form-hint" style={{ marginTop: 8, marginBottom: 0 }}>
              共 {entries.length} 个可用模型（按配置:模型）
            </p>
          )}
        </div>
      )}

      {!modelsRefreshing && Object.keys(entriesByConfig).length > 0 && (
        <div className="settings-card" style={{ marginTop: 16 }}>
          <p className="form-hint" style={{ marginBottom: 8 }}>
            各配置提供的模型
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(entriesByConfig).map(([configName, list]) => (
              <div key={configName}>
                <span style={{ fontWeight: 600, marginRight: 8 }}>{configName}</span>
                <span className="form-hint">{list.map((e) => e.modelId).join('、')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <Button
          type="primary"
          icon={<Key size={14} />}
          onClick={() => void handleSaveDefaultOnly()}
          loading={saving}
        >
          保存默认模型
        </Button>
        <span className="form-hint" style={{ marginLeft: 8 }}>
          仅保存上方「系统默认模型」，不修改各 LLM 配置项
        </span>
      </div>
    </div>
  )
}
