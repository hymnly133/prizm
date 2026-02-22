/**
 * 服务端/运维配置：仅服务与网络、鉴权与日志（Embedding/LLM/Agent 上下文/技能已拆至对应设置页）
 */
import { Button, Checkbox, Form, Input, Text, toast } from '@lobehub/ui'
import { Select } from './ui/Select'
import type {
  ServerConfig,
  ServerConfigResponse,
  ServerConfigServer
} from '@prizm/client-core'
import { createStaticStyles } from 'antd-style'
import { Server, Shield } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { PrizmClient } from '@prizm/client-core'

const styles = createStaticStyles(({ css, cssVar }) => ({
  sectionTitle: css`
    position: relative;
    display: flex;
    gap: ${cssVar.marginXS};
    align-items: center;
    height: 28px;
    font-size: 13px;
    font-weight: 600;
    color: ${cssVar.colorTextHeading};
    &::after {
      content: '';
      flex: 1;
      height: 1px;
      margin-inline-start: ${cssVar.marginMD};
      background: linear-gradient(to right, ${cssVar.colorBorder}, transparent);
    }
  `
}))

interface ServerConfigSettingsProps {
  http: PrizmClient | null
  onLog?: (msg: string, type: 'info' | 'success' | 'error' | 'warning') => void
}

export function ServerConfigSettings({ http, onLog }: ServerConfigSettingsProps) {
  const [config, setConfig] = useState<ServerConfigResponse | null>(null)
  const [patch, setPatch] = useState<Partial<ServerConfig>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!http) return
    setLoading(true)
    try {
      const res = await http.getServerConfig()
      setConfig(res)
      setPatch({ server: res.server ?? {} })
    } catch (e) {
      onLog?.(`加载服务端配置失败: ${e}`, 'error')
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
      await http.updateServerConfig(patch)
      toast.success('服务端配置已保存')
      onLog?.('若修改了端口或主机，请重启服务端后生效', 'info')
      void load()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setSaving(false)
    }
  }

  const updateServer = (u: Partial<ServerConfigServer>) =>
    setPatch((p) => ({ ...p, server: { ...p.server, ...u } }))

  if (loading) return <Text type="secondary">加载中...</Text>

  const s = patch.server ?? {}

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>服务端/运维</h2>
        <p className="form-hint">
          端口、监听地址、鉴权与日志。与环境变量等价，环境变量优先覆盖。修改端口/主机后需重启服务端。LLM、Embedding、Agent 上下文、技能等请在对应设置页配置。
        </p>
      </div>

      <div className="settings-card">
        <div className={styles.sectionTitle}>
          <Server size={16} />
          服务与网络
        </div>
        <Form className="compact-form" gap={8} layout="vertical">
          <Form.Item label="端口" extra="修改后需重启服务端">
            <Input
              type="number"
              value={s.port ?? ''}
              onChange={(ev) => updateServer({ port: parseInt(ev.target.value, 10) || undefined })}
              placeholder="4127"
            />
          </Form.Item>
          <Form.Item label="监听地址" extra="修改后需重启服务端">
            <Input
              value={s.host ?? ''}
              onChange={(ev) => updateServer({ host: ev.target.value || undefined })}
              placeholder="127.0.0.1"
            />
          </Form.Item>
          <Form.Item label="数据目录" extra="仅来自环境变量，只读">
            <Input value={config?.dataDir ?? ''} readOnly placeholder=".prizm-data" />
          </Form.Item>
        </Form>
      </div>

      <div className="settings-card">
        <div className={styles.sectionTitle}>
          <Shield size={16} />
          鉴权与日志
        </div>
        <Form className="compact-form" gap={8} layout="vertical">
          <Form.Item label="关闭鉴权（开发用）">
            <Checkbox
              checked={s.authDisabled === true}
              onChange={(c) => updateServer({ authDisabled: c as boolean })}
            />
            <span style={{ marginLeft: 8 }}>启用则无需 API Key 访问</span>
          </Form.Item>
          <Form.Item label="日志级别">
            <Select
              options={[
                { label: 'info', value: 'info' },
                { label: 'warn', value: 'warn' },
                { label: 'error', value: 'error' }
              ]}
              value={s.logLevel ?? 'info'}
              onChange={(v) => updateServer({ logLevel: (v as 'info' | 'warn' | 'error') || undefined })}
            />
          </Form.Item>
          <Form.Item label="MCP 默认 Scope" extra="HTTP MCP 未传 ?scope= 时使用">
            <Input
              value={s.mcpScope ?? ''}
              onChange={(ev) => updateServer({ mcpScope: ev.target.value.trim() || undefined })}
              placeholder="online"
            />
          </Form.Item>
        </Form>
      </div>

      <div>
        <Button onClick={() => void handleSave()} type="primary" loading={saving}>
          保存服务端配置
        </Button>
      </div>
    </div>
  )
}
