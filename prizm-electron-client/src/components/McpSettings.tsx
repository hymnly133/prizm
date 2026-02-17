/**
 * Agent 工具配置 UI：内置工具（Tavily）+ MCP 服务器
 * 参照 LobeChat：MCP 支持 API Key / headers / env 配置
 */
import {
  ActionIcon,
  Alert,
  Button,
  Flexbox,
  Form,
  Icon,
  Input,
  Modal,
  Text,
  TextArea,
  toast
} from '@lobehub/ui'
import { Select } from './ui/Select'
import type { McpServerConfig } from '@prizm/client-core'
import { createStaticStyles } from 'antd-style'
import { ClipboardPaste, Edit, Link, Plus, Terminal, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { PrizmClient } from '@prizm/client-core'
import { parseMcpJson, ParseMcpErrorCode, type ParseMcpSuccessResult } from '../utils/parseMcpJson'
import { BuiltinToolsSettings } from './BuiltinToolsSettings'

const styles = createStaticStyles(({ css, cssVar }) => ({
  connectionForm: css`
    padding: ${cssVar.paddingMD};
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillAlter};
  `,
  emptyState: css`
    padding: ${cssVar.paddingXL};
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};
    color: ${cssVar.colorTextTertiary};
    text-align: center;
    background: ${cssVar.colorFillQuaternary};
  `,
  previewItem: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-block: ${cssVar.paddingXS};
    padding-inline: 0;
    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  previewLabel: css`
    display: flex;
    gap: ${cssVar.marginXS};
    align-items: center;
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  previewValue: css`
    padding-block: ${cssVar.paddingXXS};
    padding-inline: ${cssVar.paddingXS};
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-weight: 600;
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillQuaternary};
  `,
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
  `,
  serverCardHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: ${cssVar.marginSM};
  `
}))

interface McpSettingsProps {
  http: PrizmClient | null
  onLog?: (msg: string, type: 'info' | 'success' | 'error' | 'warning') => void
}

const TRANSPORT_OPTIONS: { label: string; value: McpServerConfig['transport'] }[] = [
  { label: 'Streamable HTTP', value: 'streamable-http' },
  { label: 'SSE', value: 'sse' },
  { label: 'Stdio', value: 'stdio' }
]

export function McpSettings({ http, onLog }: McpSettingsProps) {
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [importExpanded, setImportExpanded] = useState(false)
  const [jsonInput, setJsonInput] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [editing, setEditing] = useState<McpServerConfig | null>(null)
  const [form, setForm] = useState<Partial<McpServerConfig>>({
    transport: 'streamable-http',
    enabled: true
  })

  const loadServers = useCallback(async () => {
    if (!http) return
    setLoading(true)
    try {
      const list = await http.listMcpServers()
      setServers(list)
    } catch (e) {
      onLog?.(`加载 MCP 服务器失败: ${e}`, 'error')
      setServers([])
    } finally {
      setLoading(false)
    }
  }, [http, onLog])

  useEffect(() => {
    void loadServers()
  }, [loadServers])

  const openAdd = () => {
    setEditing(null)
    setMcpApiKeyInput('')
    setMcpEnvText('')
    setForm({ transport: 'streamable-http', enabled: true })
    setModalOpen(true)
  }

  const [mcpApiKeyInput, setMcpApiKeyInput] = useState('')
  const [mcpEnvText, setMcpEnvText] = useState('')

  const openEdit = (s: McpServerConfig) => {
    setEditing(s)
    const bearer = s.headers?.['Authorization'] ?? s.headers?.['authorization']
    const apiKey = typeof bearer === 'string' && bearer.startsWith('Bearer ') ? bearer.slice(7) : ''
    setMcpApiKeyInput(apiKey)
    const env = s.stdio?.env
    setMcpEnvText(
      env && typeof env === 'object'
        ? Object.entries(env)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n')
        : ''
    )
    setForm({
      id: s.id,
      name: s.name,
      transport: s.transport,
      url: s.url,
      stdio: s.stdio,
      headers: s.headers,
      enabled: s.enabled
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    setForm({ transport: 'streamable-http', enabled: true })
    setMcpApiKeyInput('')
    setMcpEnvText('')
  }

  async function handleSubmit() {
    if (!http || !form.id?.trim() || !form.name?.trim()) {
      toast.error('请填写 ID 和名称')
      return
    }
    if (form.transport !== 'stdio' && !form.url?.trim()) {
      toast.error('请填写 URL')
      return
    }
    if (form.transport === 'stdio' && !form.stdio?.command?.trim()) {
      toast.error('请填写 stdio 命令')
      return
    }
    try {
      const headers = { ...form.headers }
      if (mcpApiKeyInput.trim()) {
        headers['Authorization'] = `Bearer ${mcpApiKeyInput.trim()}`
      }
      const stdio = form.stdio ? { ...form.stdio } : undefined
      if (stdio && mcpEnvText.trim()) {
        const env: Record<string, string> = {}
        for (const line of mcpEnvText.split('\n')) {
          const idx = line.indexOf('=')
          if (idx > 0) {
            const k = line.slice(0, idx).trim()
            const v = line.slice(idx + 1).trim()
            if (k) env[k] = v
          }
        }
        stdio.env = Object.keys(env).length ? env : undefined
      }
      const payload = {
        ...form,
        headers: Object.keys(headers).length ? headers : undefined,
        stdio
      }
      if (editing) {
        await http.updateMcpServer(editing.id, {
          name: payload.name,
          transport: payload.transport!,
          url: payload.url,
          stdio: payload.stdio,
          headers: payload.headers,
          enabled: payload.enabled ?? true
        })
        toast.success('已更新')
      } else {
        await http.addMcpServer(payload as McpServerConfig)
        toast.success('已添加')
      }
      closeModal()
      await loadServers()
    } catch (e) {
      toast.error(String(e))
    }
  }

  async function handleDelete(id: string) {
    if (!http) return
    try {
      await http.deleteMcpServer(id)
      toast.success('已删除')
      await loadServers()
    } catch (e) {
      toast.error(String(e))
    }
  }

  async function handleImportJson() {
    setImportError(null)
    const trimmed = jsonInput.trim()
    if (!trimmed) {
      setImportError('请输入 JSON 内容')
      return
    }
    const result = parseMcpJson(trimmed)
    if (result.status === 'noop') {
      setImportError('无效的 JSON 格式')
      return
    }
    if (result.status === 'error') {
      const msg: Record<ParseMcpErrorCode, string> = {
        [ParseMcpErrorCode.EmptyMcpServers]: 'mcpServers 为空',
        [ParseMcpErrorCode.InvalidJson]: 'JSON 解析失败',
        [ParseMcpErrorCode.InvalidMcpStructure]: 'MCP 配置结构无效',
        [ParseMcpErrorCode.InvalidJsonStructure]: 'JSON 结构不符合预期'
      }
      setImportError(msg[result.errorCode] ?? '解析失败')
      return
    }
    const { servers: toAdd } = result as ParseMcpSuccessResult
    if (!http) return
    let ok = 0
    let fail = 0
    for (const s of toAdd) {
      try {
        await http.addMcpServer(s)
        ok++
      } catch {
        fail++
      }
    }
    setJsonInput('')
    setImportExpanded(false)
    setImportError(null)
    await loadServers()
    if (fail > 0) {
      toast.warning(`已导入 ${ok} 个，${fail} 个失败（可能 ID 重复）`)
    } else {
      toast.success(`已导入 ${ok} 个 MCP 服务器`)
    }
  }

  async function handleTest(id: string) {
    if (!http) return
    try {
      const { tools } = await http.getMcpServerTools(id)
      toast.success(`连接成功，共 ${tools.length} 个工具`)
    } catch (e) {
      toast.error(`连接失败: ${e}`)
    }
  }

  const isHttp = form.transport === 'streamable-http' || form.transport === 'sse'

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>Agent 工具配置</h2>
        <p className="form-hint">
          内置联网搜索与 MCP 服务器，Agent 对话时可调用。Tavily 需 API Key；MCP 支持 headers/env
          鉴权。
        </p>
      </div>

      <BuiltinToolsSettings http={http} onLog={onLog} />

      <Flexbox gap={12} style={{ marginTop: 16 }}>
        <div className={styles.sectionTitle}>
          <Link size={16} />
          MCP 服务器列表
        </div>

        <Flexbox gap={10} horizontal wrap="wrap">
          <Button icon={<Plus size={14} />} onClick={openAdd} type="primary">
            添加 MCP 服务器
          </Button>
          <Button
            icon={<ClipboardPaste size={14} />}
            onClick={() => {
              setImportExpanded(!importExpanded)
              setImportError(null)
            }}
            type="dashed"
          >
            快速导入 JSON
          </Button>

          {importExpanded && (
            <Flexbox gap={8} style={{ width: '100%', flexBasis: '100%', marginTop: 6 }}>
              {importError && <Alert showIcon title={importError} type="error" />}
              <TextArea
                autoSize={{ maxRows: 15, minRows: 8 }}
                onChange={(e) => {
                  setJsonInput(e.target.value)
                  if (importError) setImportError(null)
                }}
                placeholder={`支持 LobeChat / Cursor 格式，例如：
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "<your-key>" }
    }
  }
}

或 Prizm 格式：
{
  "mcpServers": [
    { "id": "github", "name": "GitHub", "transport": "streamable-http", "url": "https://...", "enabled": true }
  ]
}`}
                value={jsonInput}
              />
              <Flexbox horizontal justify="flex-end" gap={8}>
                <Button
                  onClick={() => {
                    setImportExpanded(false)
                    setJsonInput('')
                    setImportError(null)
                  }}
                >
                  取消
                </Button>
                <Button onClick={() => void handleImportJson()} type="primary">
                  导入
                </Button>
              </Flexbox>
            </Flexbox>
          )}

          {loading ? (
            <Text type="secondary" style={{ width: '100%', flexBasis: '100%' }}>
              加载中...
            </Text>
          ) : servers.length === 0 ? (
            <div className={styles.emptyState} style={{ width: '100%', flexBasis: '100%' }}>
              <Text type="secondary">暂无 MCP 服务器，点击上方按钮添加</Text>
            </div>
          ) : (
            <Flexbox gap={8} style={{ width: '100%', flexBasis: '100%' }}>
              {servers.map((r) => (
                <div key={r.id} className={styles.serverCard}>
                  <div className={styles.serverCardHeader}>
                    <Flexbox horizontal align="center" gap={8}>
                      <Text strong>{r.name}</Text>
                      <Text style={{ fontSize: 12 }} type="secondary">
                        {r.id}
                      </Text>
                    </Flexbox>
                    <Flexbox horizontal gap={4}>
                      <ActionIcon
                        icon={Edit}
                        onClick={() => openEdit(r)}
                        size="small"
                        title="编辑"
                      />
                      <ActionIcon
                        icon={Trash2}
                        onClick={() => handleDelete(r.id)}
                        size="small"
                        title="删除"
                      />
                      <Button onClick={() => handleTest(r.id)} size="small" disabled={!http}>
                        测试
                      </Button>
                    </Flexbox>
                  </div>
                  <Flexbox paddingInline={8}>
                    <div className={styles.previewItem}>
                      <span className={styles.previewLabel}>传输类型</span>
                      <Flexbox horizontal align="center" gap={4}>
                        <Icon icon={r.transport === 'stdio' ? Terminal : Link} size={14} />
                        <Text className={styles.previewValue}>
                          {r.transport === 'stdio'
                            ? 'STDIO'
                            : r.transport === 'streamable-http'
                            ? 'Streamable HTTP'
                            : 'SSE'}
                        </Text>
                      </Flexbox>
                    </div>
                    {r.url && (
                      <div className={styles.previewItem}>
                        <span className={styles.previewLabel}>URL</span>
                        <span className={styles.previewValue}>{r.url}</span>
                      </div>
                    )}
                    {r.stdio && (
                      <>
                        {r.stdio.command && (
                          <div className={styles.previewItem}>
                            <span className={styles.previewLabel}>命令</span>
                            <span className={styles.previewValue}>{r.stdio.command}</span>
                          </div>
                        )}
                        {r.stdio.args && r.stdio.args.length > 0 && (
                          <div className={styles.previewItem}>
                            <span className={styles.previewLabel}>参数</span>
                            <span className={styles.previewValue}>{r.stdio.args.join(' ')}</span>
                          </div>
                        )}
                        {r.stdio.env && Object.keys(r.stdio.env).length > 0 && (
                          <div className={styles.previewItem}>
                            <span className={styles.previewLabel}>环境变量</span>
                            <span className={styles.previewValue}>已配置</span>
                          </div>
                        )}
                      </>
                    )}
                    {r.headers && Object.keys(r.headers).length > 0 && (
                      <div className={styles.previewItem}>
                        <span className={styles.previewLabel}>鉴权</span>
                        <span className={styles.previewValue}>已配置</span>
                      </div>
                    )}
                  </Flexbox>
                </div>
              ))}
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>

      {/* 添加/编辑 Modal - 参照 LobeChat McpSettingsModal */}
      <Modal
        destroyOnHidden
        footer={
          <Flexbox horizontal justify="flex-end" gap={8}>
            <Button onClick={closeModal}>取消</Button>
            <Button onClick={() => void handleSubmit()} type="primary">
              {editing ? '保存' : '添加'}
            </Button>
          </Flexbox>
        }
        onCancel={closeModal}
        open={modalOpen}
        title={editing ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
        width={520}
      >
        <div className={styles.connectionForm} style={{ marginTop: 12 }}>
          <Form className="compact-form" gap={8} layout="vertical">
            <Form.Item label="ID" required>
              <Input
                disabled={!!editing}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value.trim() }))}
                placeholder="如: github"
                value={form.id ?? ''}
              />
            </Form.Item>
            <Form.Item label="名称" required>
              <Input
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value.trim() }))}
                placeholder="如: GitHub"
                value={form.name ?? ''}
              />
            </Form.Item>
            <Form.Item label="传输类型">
              <Select
                onChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    transport: v as McpServerConfig['transport']
                  }))
                }
                options={TRANSPORT_OPTIONS}
                value={form.transport ?? 'streamable-http'}
              />
            </Form.Item>
            {isHttp && (
              <>
                <Form.Item label="URL" required>
                  <Input
                    onChange={(e) => setForm((f) => ({ ...f, url: e.target.value.trim() }))}
                    placeholder="http://127.0.0.1:4127/mcp"
                    value={form.url ?? ''}
                  />
                </Form.Item>
                <Form.Item
                  label="API Key"
                  extra="部分 MCP 服务需鉴权，填写后设置 Authorization: Bearer"
                >
                  <Input
                    type="password"
                    placeholder={
                      form.headers?.['Authorization'] || form.headers?.['authorization']
                        ? '已配置，留空不修改'
                        : '可选'
                    }
                    value={mcpApiKeyInput}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setMcpApiKeyInput(e.target.value)
                    }
                  />
                </Form.Item>
              </>
            )}
            {form.transport === 'stdio' && (
              <>
                <Form.Item label="命令" required>
                  <Input
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        stdio: {
                          command: e.target.value.trim(),
                          args: f.stdio?.args ?? []
                        }
                      }))
                    }
                    placeholder="npx, uv, python..."
                    value={form.stdio?.command ?? ''}
                  />
                </Form.Item>
                <Form.Item label="参数">
                  <Input
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        stdio: {
                          command: f.stdio?.command ?? '',
                          args: e.target.value.split(/\s+/).filter(Boolean)
                        }
                      }))
                    }
                    placeholder="-y @modelcontextprotocol/server-filesystem /path"
                    value={form.stdio?.args?.join(' ') ?? ''}
                  />
                </Form.Item>
                <Form.Item
                  label="环境变量"
                  extra="每行 KEY=value，如 GITHUB_PERSONAL_ACCESS_TOKEN=xxx"
                >
                  <TextArea
                    rows={3}
                    placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx"
                    value={mcpEnvText}
                    onChange={(e) => setMcpEnvText(e.target.value)}
                  />
                </Form.Item>
              </>
            )}
          </Form>
        </div>
      </Modal>
    </div>
  )
}
