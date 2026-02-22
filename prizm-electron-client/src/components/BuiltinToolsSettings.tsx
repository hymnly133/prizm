/**
 * 内置工具配置（如 Tavily 联网搜索）
 * 由 McpSettings 引用，作为 Agent 工具配置的一部分。
 */
import { Button, Checkbox, Form, Input, Text, toast } from '@lobehub/ui'
import type { PrizmClient, TavilySettings } from '@prizm/client-core'
import { createStaticStyles } from 'antd-style'
import { Globe } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Select } from './ui/Select'
import { LoadingPlaceholder } from './ui/LoadingPlaceholder'

const styles = createStaticStyles(({ css, cssVar }) => ({
  sectionTitle: css`
    position: relative;
    display: flex;
    gap: ${cssVar.marginXS};
    align-items: center;
    height: 32px;
    font-size: ${cssVar.fontSizeLG};
    font-weight: 600;
    color: ${cssVar.colorTextHeading};
    &::after {
      content: '';
      flex: 1;
      height: 1px;
      margin-inline-start: ${cssVar.marginMD};
      background: linear-gradient(to right, ${cssVar.colorBorder}, transparent);
    }
  `,
  serverCard: css`
    padding: ${cssVar.paddingMD};
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillAlter};
    margin-bottom: ${cssVar.marginSM};
  `
}))

const TAVILY_SEARCH_DEPTH_OPTIONS = [
  { label: 'basic', value: 'basic' },
  { label: 'advanced', value: 'advanced' },
  { label: 'fast', value: 'fast' },
  { label: 'ultra-fast', value: 'ultra-fast' }
]

export interface BuiltinToolsSettingsProps {
  http: PrizmClient | null
  onLog?: (msg: string, type: 'info' | 'success' | 'error' | 'warning') => void
}

export function BuiltinToolsSettings({ http, onLog }: BuiltinToolsSettingsProps) {
  const [tavily, setTavily] = useState<Partial<TavilySettings> | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')

  const load = useCallback(async () => {
    if (!http) return
    setLoading(true)
    try {
      const data = await http.getAgentTools()
      setTavily(data.builtin?.tavily ?? null)
      setApiKeyInput('')
    } catch (e) {
      onLog?.(`加载内置工具配置失败: ${e}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [http, onLog])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSave() {
    if (!http) return
    setSaving(true)
    try {
      await http.updateTavilySettings({
        ...tavily,
        ...(apiKeyInput.trim() && { apiKey: apiKeyInput.trim() })
      })
      toast.success('Tavily 配置已保存')
      setApiKeyInput('')
      void load()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingPlaceholder />

  return (
    <div className={styles.serverCard} style={{ marginTop: 12 }}>
      <div className={styles.sectionTitle}>
        <Globe size={16} />
        Tavily 联网搜索
      </div>
      <p className="form-hint" style={{ marginTop: 6, marginBottom: 10 }}>
        为 Agent 提供实时联网搜索能力，需在{' '}
        <a href="https://tavily.com" target="_blank" rel="noreferrer">
          tavily.com
        </a>{' '}
        获取 API Key
      </p>
      <Form className="compact-form" gap={8} layout="vertical">
        <Form.Item label="API Key">
          <Input
            type="password"
            placeholder={tavily?.configured ? '已配置，留空不修改' : 'tvly-xxx'}
            value={apiKeyInput}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKeyInput(e.target.value)}
          />
        </Form.Item>
        <Form.Item label="启用">
          <Checkbox
            checked={tavily?.enabled !== false}
            onChange={(checked: boolean) => setTavily((t) => ({ ...t, enabled: checked }))}
          />
        </Form.Item>
        <Form.Item label="最大结果数" extra="1-20，默认 5">
          <Input
            type="number"
            min={1}
            max={20}
            value={tavily?.maxResults ?? 5}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setTavily((t) => ({ ...t, maxResults: parseInt(e.target.value, 10) || 5 }))
            }
          />
        </Form.Item>
        <Form.Item label="搜索深度">
          <Select
            options={TAVILY_SEARCH_DEPTH_OPTIONS}
            value={tavily?.searchDepth ?? 'basic'}
            onChange={(v) =>
              setTavily((t) => ({ ...t, searchDepth: v as TavilySettings['searchDepth'] }))
            }
          />
        </Form.Item>
        <Form.Item>
          <Button onClick={() => void handleSave()} type="primary" loading={saving}>
            保存 Tavily 配置
          </Button>
        </Form.Item>
      </Form>
    </div>
  )
}
