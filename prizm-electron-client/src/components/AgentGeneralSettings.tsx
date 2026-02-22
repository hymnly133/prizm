/**
 * Agent 通用设置（LLM 模型 + 记忆模块）
 * 从 McpSettings.tsx 分离的 AgentLLMSection + 新增 Memory 配置
 */
import { Button, Checkbox, Form, Input, Text, toast } from '@lobehub/ui'
import { Select } from './ui/Select'
import type {
  AgentLLMSettings,
  AvailableModel,
  ShellInfo,
  TerminalSettings
} from '@prizm/client-core'
import { createStaticStyles } from 'antd-style'
import { Brain, Layers, MessageSquare, Terminal } from 'lucide-react'
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

interface AgentGeneralSettingsProps {
  http: PrizmClient | null
  onLog?: (msg: string, type: 'info' | 'success' | 'error' | 'warning') => void
}

export function AgentGeneralSettings({ http, onLog }: AgentGeneralSettingsProps) {
  const [agent, setAgent] = useState<Partial<AgentLLMSettings>>({})
  const [terminal, setTerminal] = useState<Partial<TerminalSettings>>({})
  const [scopeContextMaxChars, setScopeContextMaxChars] = useState<number | undefined>(undefined)
  const [models, setModels] = useState<AvailableModel[]>([])
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!http) return
    setLoading(true)
    try {
      const [tools, modelsRes, shellsRes, serverConfig] = await Promise.all([
        http.getAgentTools(),
        http.getAgentModels(),
        http.getAvailableShells(),
        http.getServerConfig()
      ])
      setAgent(tools.agent ?? {})
      setTerminal(tools.terminal ?? {})
      setScopeContextMaxChars(serverConfig.agent?.scopeContextMaxChars)
      const list = modelsRes.models ?? []
      setModels(
        list.map((m) => ({
          id: `${m.configId}:${m.modelId}`,
          label: m.label,
          provider: modelsRes.configs?.find((c) => c.id === m.configId)?.name ?? m.configId
        }))
      )
      setShells(shellsRes.shells ?? [])
    } catch (e) {
      onLog?.(`加载 Agent 配置失败: ${e}`, 'error')
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
      await http.updateAgentTools({ agent, terminal })
      if (scopeContextMaxChars !== undefined) {
        await http.updateServerConfig({ agent: { scopeContextMaxChars } })
      }
      toast.success('Agent 设置已保存')
      void load()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setSaving(false)
    }
  }

  const modelOptions = [
    { label: '默认（跟随 Provider）', value: '' },
    ...models.map((m) => ({ label: m.label, value: m.id }))
  ]

  if (loading) return <Text type="secondary">加载中...</Text>

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>Agent</h2>
        <p className="form-hint">配置 Agent 的默认模型、摘要策略、上下文上限和记忆模块</p>
      </div>

      {/* Scope 上下文 */}
      <div className="settings-card">
        <div className={styles.sectionTitle}>
          <Layers size={16} />
          Scope 上下文
        </div>
        <p className="form-hint" style={{ marginTop: 6, marginBottom: 10 }}>
          单次注入的便签/待办/文档摘要字符数上限
        </p>
        <Form className="compact-form" gap={8} layout="vertical">
          <Form.Item label="Scope 上下文最大字符数" extra="建议 500–12000">
            <Input
              type="number"
              min={500}
              max={12000}
              value={scopeContextMaxChars ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setScopeContextMaxChars(
                  e.target.value ? parseInt(e.target.value, 10) || undefined : undefined
                )
              }
              placeholder="4000"
            />
          </Form.Item>
        </Form>
      </div>

      {/* LLM 模型 & 摘要配置 */}
      <div className="settings-card">
        <div className={styles.sectionTitle}>
          <MessageSquare size={16} />
          LLM 模型 & 摘要
        </div>
        <p className="form-hint" style={{ marginTop: 6, marginBottom: 10 }}>
          文档摘要、对话摘要及默认模型，可在客户端选择覆盖
        </p>
        <Form className="compact-form" gap={8} layout="vertical">
          <Form.Item label="默认对话模型" extra="客户端发消息时可覆盖">
            <Select
              options={modelOptions}
              value={agent.defaultModel ?? ''}
              onChange={(v) => setAgent((a) => ({ ...a, defaultModel: v || undefined }))}
            />
          </Form.Item>
          <Form.Item label="文档摘要">
            <Checkbox
              checked={agent.documentSummary?.enabled !== false}
              onChange={(checked: boolean) =>
                setAgent((a) => ({
                  ...a,
                  documentSummary: { ...a.documentSummary, enabled: checked }
                }))
              }
            />
            <span style={{ marginLeft: 8 }}>启用</span>
          </Form.Item>
          <Form.Item label="文档摘要最小长度" extra="字符数超过此值才触发，默认 500">
            <Input
              type="number"
              min={100}
              value={agent.documentSummary?.minLen ?? 500}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setAgent((a) => ({
                  ...a,
                  documentSummary: {
                    ...a.documentSummary,
                    minLen: parseInt(e.target.value, 10) || 500
                  }
                }))
              }
            />
          </Form.Item>
          <Form.Item label="对话摘要">
            <Checkbox
              checked={agent.conversationSummary?.enabled !== false}
              onChange={(checked: boolean) =>
                setAgent((a) => ({
                  ...a,
                  conversationSummary: { ...a.conversationSummary, enabled: checked }
                }))
              }
            />
            <span style={{ marginLeft: 8 }}>启用（用于会话列表标题）</span>
          </Form.Item>
          <Form.Item label="对话摘要模型">
            <Select
              options={modelOptions}
              value={agent.conversationSummary?.model ?? ''}
              onChange={(v) =>
                setAgent((a) => ({
                  ...a,
                  conversationSummary: {
                    ...a.conversationSummary,
                    model: v || undefined
                  }
                }))
              }
            />
          </Form.Item>
        </Form>
      </div>

      {/* 上下文窗口 A/B */}
      <div className="settings-card">
        <div className={styles.sectionTitle}>
          <Layers size={16} />
          上下文窗口
        </div>
        <p className="form-hint" style={{ marginTop: 6, marginBottom: 10 }}>
          完全上下文轮数 A、缓存轮数 B。满 A+B 轮时将最老 B 轮压缩为 Session
          记忆，发送顺序为「压缩块 + 最新 A 轮 raw」
        </p>
        <Form className="compact-form" gap={8} layout="vertical">
          <Form.Item label="完全上下文轮数 A" extra="最新 A 轮保持原始发送">
            <Input
              type="number"
              min={1}
              max={20}
              value={agent.contextWindow?.fullContextTurns ?? 4}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setAgent((a) => ({
                  ...a,
                  contextWindow: {
                    ...a.contextWindow,
                    fullContextTurns: Math.max(1, parseInt(e.target.value, 10) || 4)
                  }
                }))
              }
            />
          </Form.Item>
          <Form.Item label="缓存轮数 B" extra="每 B 轮压缩为一段 Session 记忆">
            <Input
              type="number"
              min={1}
              max={10}
              value={agent.contextWindow?.cachedContextTurns ?? 3}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setAgent((a) => ({
                  ...a,
                  contextWindow: {
                    ...a.contextWindow,
                    cachedContextTurns: Math.max(1, parseInt(e.target.value, 10) || 3)
                  }
                }))
              }
            />
          </Form.Item>
        </Form>
      </div>

      {/* 记忆模块 */}
      <div className="settings-card">
        <div className={styles.sectionTitle}>
          <Brain size={16} />
          记忆模块
        </div>
        <p className="form-hint" style={{ marginTop: 6, marginBottom: 10 }}>
          启用后 Agent 将自动记住对话中的关键信息，跨会话提供个性化服务
        </p>
        <Form className="compact-form" gap={8} layout="vertical">
          <Form.Item label="启用记忆">
            <Checkbox
              checked={agent.memory?.enabled === true}
              onChange={(checked: boolean) =>
                setAgent((a) => ({
                  ...a,
                  memory: { ...a.memory, enabled: checked }
                }))
              }
            />
            <span style={{ marginLeft: 8 }}>启用</span>
          </Form.Item>
          <Form.Item label="记忆处理模型" extra="用于提取和检索记忆的 LLM 模型">
            <Select
              options={modelOptions}
              value={agent.memory?.model ?? ''}
              onChange={(v) =>
                setAgent((a) => ({
                  ...a,
                  memory: {
                    ...a.memory,
                    model: v || undefined
                  }
                }))
              }
            />
          </Form.Item>
        </Form>
      </div>

      {/* 终端设置 */}
      <div className="settings-card">
        <div className={styles.sectionTitle}>
          <Terminal size={16} />
          终端
        </div>
        <p className="form-hint" style={{ marginTop: 6, marginBottom: 10 }}>
          选择 Agent 创建终端时使用的默认 Shell
        </p>
        <Form className="compact-form" gap={8} layout="vertical">
          <Form.Item label="默认 Shell" extra="留空则自动检测系统最佳 Shell">
            <Select
              options={[
                { label: '自动检测', value: '' },
                ...shells.map((s) => ({
                  label: `${s.label}${s.isDefault ? '（推荐）' : ''}`,
                  value: s.path
                }))
              ]}
              value={terminal.defaultShell ?? ''}
              onChange={(v) => setTerminal((t) => ({ ...t, defaultShell: v || undefined }))}
            />
          </Form.Item>
        </Form>
      </div>

      {/* 统一保存按钮 */}
      <div>
        <Button onClick={() => void handleSave()} type="primary" loading={saving}>
          保存 Agent 设置
        </Button>
      </div>
    </div>
  )
}
