import { memo, useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  ColorSwatches,
  Form,
  Input,
  toast,
  findCustomThemeName,
  primaryColors,
  primaryColorsSwatches,
  neutralColors,
  neutralColorsSwatches
} from '@lobehub/ui'
import { Segmented } from '../components/ui/Segmented'
import { McpSettings } from '../components/McpSettings'
import { AgentGeneralSettings } from '../components/AgentGeneralSettings'
import { CommandsSettings } from '../components/CommandsSettings'
import { SkillsSettings } from '../components/SkillsSettings'
import { AgentRulesSettings } from '../components/AgentRulesSettings'
import { ScopeManagement } from '../components/ScopeManagement'
import { EmbeddingStatus } from '../components/EmbeddingStatus'
import { useClientSettings } from '../context/ClientSettingsContext'
import { EVENT_TYPES, buildServerUrl, getEventLabel } from '@prizm/client-core'
import type { EventType, PrizmConfig } from '@prizm/client-core'
import { useEffect } from 'react'
import { useLogsContext } from '../context/LogsContext'
import { usePrizmContext } from '../context/PrizmContext'
import {
  Globe,
  Keyboard,
  FolderOpen,
  Bot,
  Cpu,
  Plug,
  Terminal as TerminalIcon,
  Sparkles,
  ScrollText,
  Zap,
  Palette,
  Coins
} from 'lucide-react'
import { OnboardingWizard } from '../components/OnboardingWizard'
import { TokenUsagePanel } from '../components/TokenUsagePanel'
type SettingsCategory =
  | 'connection'
  | 'appearance'
  | 'input'
  | 'scope'
  | 'agent'
  | 'embedding'
  | 'token-usage'
  | 'mcp'
  | 'commands'
  | 'skills'
  | 'rules'
  | 'actions'

interface CategoryItem {
  key: SettingsCategory
  label: string
  icon: React.ReactNode
  requiresAuth?: boolean
}

const CATEGORIES: CategoryItem[] = [
  { key: 'connection', label: '连接', icon: <Globe size={16} /> },
  { key: 'appearance', label: '外观', icon: <Palette size={16} /> },
  { key: 'input', label: '输入', icon: <Keyboard size={16} /> },
  { key: 'scope', label: '工作区', icon: <FolderOpen size={16} />, requiresAuth: true },
  { key: 'agent', label: 'Agent', icon: <Bot size={16} />, requiresAuth: true },
  { key: 'embedding', label: '模型', icon: <Cpu size={16} />, requiresAuth: true },
  { key: 'token-usage', label: 'Token 用量', icon: <Coins size={16} />, requiresAuth: true },
  { key: 'mcp', label: 'MCP', icon: <Plug size={16} />, requiresAuth: true },
  { key: 'commands', label: '命令', icon: <TerminalIcon size={16} />, requiresAuth: true },
  { key: 'skills', label: '技能', icon: <Sparkles size={16} />, requiresAuth: true },
  { key: 'rules', label: '规则', icon: <ScrollText size={16} />, requiresAuth: true },
  { key: 'actions', label: '快捷操作', icon: <Zap size={16} /> }
]

function SettingsPage() {
  const {
    config,
    manager,
    loadConfig,
    saveConfig: saveConfigApi,
    testConnection: testConnectionApi,
    registerClient: registerClientApi,
    initializePrizm,
    setConfig
  } = usePrizmContext()
  const { addLog } = useLogsContext()
  const {
    sendWithEnter,
    setSendWithEnter,
    themeMode,
    setThemeMode,
    primaryColor,
    setPrimaryColor,
    neutralColor,
    setNeutralColor
  } = useClientSettings()

  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('connection')
  const [testing, setTesting] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [form, setForm] = useState({
    host: '127.0.0.1',
    port: '4127',
    clientName: 'Prizm Electron Client',
    scopesText: 'default, online',
    notifyEvents: ['notification', 'todo_list:updated'] as string[]
  })

  useEffect(() => {
    if (config) {
      setForm({
        host: config.server.host,
        port: config.server.port,
        clientName: config.client.name,
        scopesText: config.client.requested_scopes.join(', '),
        notifyEvents: [...(config.notify_events ?? ['notification', 'todo_list:updated'])]
      })
    }
  }, [config])

  async function saveConfig() {
    const scopes = form.scopesText
      ? form.scopesText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : ['default', 'online']
    const base = config ?? {
      server: { host: '', port: '', is_dev: 'true' },
      client: {
        name: '',
        auto_register: 'true',
        requested_scopes: ['default', 'online']
      },
      api_key: '',
      tray: {
        enabled: 'true',
        minimize_to_tray: 'true',
        show_notification: 'true'
      },
      notify_events: ['notification', 'todo_list:updated']
    }
    const cfg: PrizmConfig = { ...base }
    cfg.server = { ...cfg.server, host: form.host, port: form.port }
    cfg.client = {
      ...cfg.client,
      name: form.clientName,
      requested_scopes: scopes
    }
    cfg.notify_events = form.notifyEvents as EventType[]
    const ok = await saveConfigApi(cfg)
    if (ok) {
      setConfig(cfg)
      addLog('配置已保存', 'success')
      toast.success('配置已保存')
    }
  }

  async function testConnection() {
    const serverUrl = buildServerUrl(form.host.trim(), form.port.trim())
    if (!form.host.trim() || !form.port.trim()) {
      toast.error('请填写服务器地址和端口')
      addLog('请填写服务器地址和端口', 'error')
      return
    }
    setTesting(true)
    const success = await testConnectionApi(serverUrl)
    setTesting(false)
    if (success) {
      toast.success('服务器连接成功')
    } else {
      toast.error('无法连接到服务器')
    }
    addLog(success ? '服务器连接成功' : '无法连接到服务器', success ? 'success' : 'error')
  }

  async function registerClient() {
    const serverUrl = buildServerUrl(form.host.trim(), form.port.trim())
    if (!form.host.trim() || !form.port.trim()) {
      addLog('请填写服务器地址和端口', 'error')
      return
    }
    if (!form.clientName.trim()) {
      addLog('请填写客户端名称', 'error')
      return
    }
    const scopes = form.scopesText
      ? form.scopesText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : ['default', 'online']
    setRegistering(true)
    const apiKey = await registerClientApi(serverUrl, form.clientName.trim(), scopes)
    setRegistering(false)
    if (apiKey) {
      const cfg = await loadConfig()
      if (cfg) {
        setConfig(cfg)
        toast.success('注册成功，正在重新加载...')
        addLog('注册成功，正在重新加载...', 'success')
        window.location.reload()
      }
    }
  }

  async function reconnect() {
    const c = config
    if (!c) {
      addLog('没有配置可用的服务器', 'error')
      return
    }
    setReconnecting(true)
    try {
      await initializePrizm(c, {
        onLog: addLog,
        onNotify: (p) => addLog(`通知: ${p.title}`, 'info')
      })
    } finally {
      setReconnecting(false)
    }
  }

  async function openDashboard() {
    const c = config
    if (!c) {
      addLog('没有配置可用的服务器', 'error')
      return
    }
    try {
      await window.prizm.openDashboard(buildServerUrl(c.server.host, c.server.port))
      addLog('已打开仪表板', 'success')
    } catch (e) {
      addLog(`打开仪表板失败: ${String(e)}`, 'error')
    }
  }

  useEffect(() => {
    if (!config) {
      setForm({
        host: '127.0.0.1',
        port: '4127',
        clientName: 'Prizm Electron Client',
        scopesText: 'default, online',
        notifyEvents: ['notification', 'todo_list:updated']
      })
    }
  }, [])

  const [showOnboarding, setShowOnboarding] = useState(!config?.api_key)

  useEffect(() => {
    if (config?.api_key) setShowOnboarding(false)
  }, [config?.api_key])

  const inputVariant = 'filled' as const
  const hasAuth = !!config?.api_key

  const primarySwatches = useMemo(
    () =>
      primaryColorsSwatches.map((c) => ({ color: c, title: findCustomThemeName('primary', c) })),
    []
  )
  const neutralSwatches = useMemo(
    () =>
      neutralColorsSwatches.map((c) => ({ color: c, title: findCustomThemeName('neutral', c) })),
    []
  )

  const visibleCategories = CATEGORIES.filter((c) => !c.requiresAuth || hasAuth)

  if (showOnboarding && !hasAuth) {
    return (
      <section className="page settings-page">
        <OnboardingWizard
          onComplete={() => setShowOnboarding(false)}
          testConnection={testConnectionApi}
          registerClient={registerClientApi}
          saveConfig={saveConfigApi}
          loadConfig={loadConfig}
          setConfig={setConfig}
        />
      </section>
    )
  }

  function renderContent() {
    switch (activeCategory) {
      case 'connection':
        return (
          <div className="settings-section">
            <div className="settings-section-header">
              <h2>服务器配置</h2>
              <p className="form-hint">连接 Prizm 服务端地址与客户端注册信息</p>
            </div>
            <div className="settings-card">
              <Form className="compact-form" gap={8} layout="vertical">
                <Form.Item label="服务器地址">
                  <Input
                    variant={inputVariant}
                    value={form.host}
                    onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                    placeholder="127.0.0.1"
                  />
                </Form.Item>
                <Form.Item label="端口" extra="默认端口: 4127">
                  <Input
                    variant={inputVariant}
                    value={form.port}
                    onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                    placeholder="4127"
                  />
                </Form.Item>
                <Form.Item label="客户端名称">
                  <Input
                    variant={inputVariant}
                    value={form.clientName}
                    onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))}
                    placeholder="Prizm Electron Client"
                  />
                </Form.Item>
                <Form.Item
                  label="请求的 Scopes (逗号分隔)"
                  extra="例如: default, online（online 为实时上下文）"
                >
                  <Input
                    variant={inputVariant}
                    value={form.scopesText}
                    onChange={(e) => setForm((f) => ({ ...f, scopesText: e.target.value }))}
                    placeholder="default, online"
                  />
                </Form.Item>
                <Form.Item
                  label="接收通知的事件"
                  extra="勾选后，对应事件发生时将弹出应用内通知。含 TODO 列表更新、便签、文档、剪贴板等。"
                >
                  <Checkbox.Group
                    value={form.notifyEvents}
                    onChange={(vals) => setForm((f) => ({ ...f, notifyEvents: vals as string[] }))}
                    options={EVENT_TYPES.map((ev) => ({
                      label: getEventLabel(ev),
                      value: ev
                    }))}
                  />
                </Form.Item>
                <Form.Item>
                  <div className="config-actions" style={{ marginTop: 4 }}>
                    <Button onClick={testConnection} disabled={testing}>
                      {testing ? '测试中...' : '测试连接'}
                    </Button>
                    <Button onClick={saveConfig}>保存配置</Button>
                    <Button type="primary" onClick={registerClient} disabled={registering}>
                      {registering ? '注册中...' : '注册客户端'}
                    </Button>
                  </div>
                </Form.Item>
              </Form>
            </div>
          </div>
        )

      case 'appearance':
        return (
          <div className="settings-section">
            <div className="settings-section-header">
              <h2>外观</h2>
              <p className="form-hint">主题模式、主题色与中性色调</p>
            </div>
            <div className="settings-card">
              <Form className="compact-form" layout="vertical">
                <Form.Item label="主题模式">
                  <Segmented
                    value={themeMode}
                    onChange={(v) => setThemeMode(v as 'auto' | 'light' | 'dark')}
                    options={[
                      { label: '跟随系统', value: 'auto' },
                      { label: '浅色', value: 'light' },
                      { label: '深色', value: 'dark' }
                    ]}
                  />
                </Form.Item>
                <Form.Item label="主题色" extra="选择应用的强调色，影响按钮、链接、选中态等">
                  <ColorSwatches
                    colors={primarySwatches}
                    value={primaryColor ? primaryColors[primaryColor] : undefined}
                    onChange={(hex) => {
                      if (!hex) {
                        setPrimaryColor(undefined)
                        return
                      }
                      const name = findCustomThemeName('primary', hex)
                      setPrimaryColor(name as typeof primaryColor)
                    }}
                    size={28}
                    shape="circle"
                  />
                </Form.Item>
                <Form.Item label="中性色" extra="影响背景、边框、文字等中性色调">
                  <ColorSwatches
                    colors={neutralSwatches}
                    value={neutralColor ? neutralColors[neutralColor] : undefined}
                    onChange={(hex) => {
                      if (!hex) {
                        setNeutralColor(undefined)
                        return
                      }
                      const name = findCustomThemeName('neutral', hex)
                      setNeutralColor(name as typeof neutralColor)
                    }}
                    size={28}
                    shape="circle"
                  />
                </Form.Item>
              </Form>
            </div>
          </div>
        )

      case 'input':
        return (
          <div className="settings-section">
            <div className="settings-section-header">
              <h2>对话输入</h2>
              <p className="form-hint">Agent 对话输入框的发送快捷键</p>
            </div>
            <div className="settings-card">
              <Form className="compact-form" layout="vertical">
                <Form.Item label="发送消息">
                  <Segmented
                    value={sendWithEnter ? 'enter' : 'ctrl'}
                    onChange={(v) => setSendWithEnter(v === 'enter')}
                    options={[
                      { label: '回车发送（Shift+回车换行）', value: 'enter' },
                      { label: 'Ctrl+回车发送（回车换行）', value: 'ctrl' }
                    ]}
                  />
                </Form.Item>
              </Form>
            </div>
          </div>
        )

      case 'scope':
        return <ScopeManagement http={manager?.getHttpClient() ?? null} onLog={addLog} />

      case 'agent':
        return <AgentGeneralSettings http={manager?.getHttpClient() ?? null} onLog={addLog} />

      case 'embedding':
        return <EmbeddingStatus http={manager?.getHttpClient() ?? null} onLog={addLog} />

      case 'token-usage':
        return <TokenUsagePanel http={manager?.getHttpClient() ?? null} onLog={addLog} />

      case 'mcp':
        return <McpSettings http={manager?.getHttpClient() ?? null} onLog={addLog} />

      case 'commands':
        return <CommandsSettings http={manager?.getHttpClient() ?? null} onLog={addLog} />

      case 'skills':
        return <SkillsSettings http={manager?.getHttpClient() ?? null} onLog={addLog} />

      case 'rules':
        return <AgentRulesSettings http={manager?.getHttpClient() ?? null} onLog={addLog} />

      case 'actions':
        return (
          <div className="settings-section">
            <div className="settings-section-header">
              <h2>快捷操作</h2>
              <p className="form-hint">重新连接 WebSocket 或打开服务端仪表板</p>
            </div>
            <div className="settings-card">
              <div className="config-actions" style={{ marginTop: 0 }}>
                <Button onClick={reconnect} disabled={reconnecting}>
                  {reconnecting ? '重新连接中...' : '重新连接'}
                </Button>
                <Button onClick={openDashboard}>打开仪表板</Button>
              </div>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <section className="page settings-page">
      <div className="settings-layout">
        <nav className="settings-sidebar" role="navigation" aria-label="设置分类">
          {visibleCategories.map((cat) => (
            <button
              key={cat.key}
              type="button"
              className={`settings-sidebar-item${
                activeCategory === cat.key ? ' settings-sidebar-item--active' : ''
              }`}
              onClick={() => setActiveCategory(cat.key)}
              aria-current={activeCategory === cat.key ? 'page' : undefined}
            >
              {cat.icon}
              <span>{cat.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-content">{renderContent()}</div>
      </div>
    </section>
  )
}

export default memo(SettingsPage)
