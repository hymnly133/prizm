/**
 * Agent 工具配置 UI：内置工具（Tavily）+ MCP 服务器
 * 标签页：内置工具 | MCP 服务器；页内卡片式布局。
 */
import {
  Alert,
  Button,
  Flexbox,
  Form,
  Input,
  Modal,
  Text,
  TextArea,
  toast
} from '@lobehub/ui'
import { Spin } from 'antd'
import { Segmented } from './ui/Segmented'
import { Select } from './ui/Select'
import { ContentCard, ContentCardHeader, ContentCardBody } from './ui/ContentCard'
import { EmptyState } from './ui/EmptyState'
import { LoadingPlaceholder } from './ui/LoadingPlaceholder'
import type { McpServerConfig } from '@prizm/client-core'
import { ClipboardPaste, Plus, Plug, Server } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { PrizmClient } from '@prizm/client-core'
import { parseMcpJson, ParseMcpErrorCode, type ParseMcpSuccessResult } from '../utils/parseMcpJson'
import { BuiltinToolsSettings } from './BuiltinToolsSettings'
import { McpServerCard } from './mcp/McpServerCard'

interface McpSettingsProps {
  http: PrizmClient | null
  onLog?: (msg: string, type: 'info' | 'success' | 'error' | 'warning') => void
}

const TRANSPORT_OPTIONS: { label: string; value: McpServerConfig['transport'] }[] = [
  { label: 'Streamable HTTP', value: 'streamable-http' },
  { label: 'SSE', value: 'sse' },
  { label: 'Stdio', value: 'stdio' }
]

type McpSubTabKey = 'builtin' | 'servers'

export function McpSettings({ http, onLog }: McpSettingsProps) {
  const [subTab, setSubTab] = useState<McpSubTabKey>('builtin')
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
    <div className="settings-section" role="region" aria-label="MCP 设置">
      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={subTab}
          onChange={(v) => setSubTab(v as McpSubTabKey)}
          options={[
            { label: '内置工具', value: 'builtin' },
            { label: `MCP 服务器${servers.length > 0 ? ` (${servers.length})` : ''}`, value: 'servers' }
          ]}
          role="tablist"
          aria-label="内置工具与 MCP 服务器切换"
        />
      </div>

      {subTab === 'builtin' && (
        <div role="tabpanel" id="mcp-builtin-tabpanel" aria-labelledby="mcp-builtin-tab">
          <ContentCard variant="default" hoverable={false} className="settings-card">
            <ContentCardHeader>
              <Flexbox horizontal align="center" gap={8}>
                <Server size={16} aria-hidden />
                <span>内置工具</span>
              </Flexbox>
            </ContentCardHeader>
            <ContentCardBody>
              <BuiltinToolsSettings http={http} onLog={onLog} />
            </ContentCardBody>
          </ContentCard>
        </div>
      )}

      {subTab === 'servers' && (
        <div role="tabpanel" id="mcp-servers-tabpanel" aria-labelledby="mcp-servers-tab">
          <ContentCard variant="default" hoverable={false} className="settings-card" style={{ marginBottom: 16 }}>
            <ContentCardHeader>
              <Flexbox horizontal align="center" justify="space-between" gap={8} style={{ flexWrap: 'wrap' }}>
                <Flexbox horizontal align="center" gap={8}>
                  <Plug size={16} aria-hidden />
                  <span>MCP 服务器列表</span>
                </Flexbox>
                <Flexbox horizontal gap={8}>
                  <Button icon={<Plus size={14} />} onClick={openAdd} type="primary" size="small">
                    添加服务器
                  </Button>
                  <Button
                    icon={<ClipboardPaste size={14} />}
                    onClick={() => {
                      setImportExpanded(!importExpanded)
                      setImportError(null)
                    }}
                    type="dashed"
                    size="small"
                  >
                    快速导入 JSON
                  </Button>
                </Flexbox>
              </Flexbox>
            </ContentCardHeader>
            <ContentCardBody>
              {importExpanded && (
                <Flexbox gap={8} style={{ marginBottom: 12 }}>
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
                <Flexbox align="center" justify="center" style={{ padding: 24 }}>
                  <LoadingPlaceholder />
                </Flexbox>
              ) : servers.length === 0 ? (
                <EmptyState
                  icon={Plug}
                  description="暂无 MCP 服务器，点击上方「添加服务器」或「快速导入 JSON」"
                  actions={
                    <Flexbox gap={8} horizontal>
                      <Button size="small" type="primary" onClick={openAdd}>
                        添加 MCP 服务器
                      </Button>
                    </Flexbox>
                  }
                />
              ) : (
                <Flexbox className="panel-list" gap={8} style={{ flexDirection: 'column' }} role="list" aria-label="MCP 服务器列表">
                  {servers.map((r) => (
                    <McpServerCard
                      key={r.id}
                      server={r}
                      onEdit={() => openEdit(r)}
                      onDelete={() => handleDelete(r.id)}
                      onTest={() => handleTest(r.id)}
                      testDisabled={!http}
                    />
                  ))}
                </Flexbox>
              )}
            </ContentCardBody>
          </ContentCard>
        </div>
      )}

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
        <ContentCard variant="subtle" hoverable={false} style={{ marginTop: 12, padding: 16 }}>
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
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMcpApiKeyInput(e.target.value)}
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
        </ContentCard>
      </Modal>
    </div>
  )
}
