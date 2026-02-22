import { memo, useCallback, useMemo, useState } from 'react'
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
import { Switch } from 'antd'
import { Select } from '../components/ui/Select'
import { buildModelSelectOptionsFromEntries } from '../utils/modelSelectOptions'
import { Segmented } from '../components/ui/Segmented'
import { SkillsAndMcpSettings } from '../components/SkillsAndMcpSettings'
import { AgentGeneralSettings } from '../components/AgentGeneralSettings'
import { ServerConfigSettings } from '../components/ServerConfigSettings'
import { LLMConfigSettings } from '../components/LLMConfigSettings'
import { CommandsSettings } from '../components/CommandsSettings'
import { AgentRulesSettings } from '../components/AgentRulesSettings'
import { ScopeManagement } from '../components/ScopeManagement'
import { EmbeddingStatus } from '../components/EmbeddingStatus'
import { useClientSettings } from '../context/ClientSettingsContext'
import { EVENT_TYPES, buildServerUrl, getEventLabel } from '@prizm/client-core'
import type {
  EventType,
  PrizmConfig,
  LLMConfigItemSanitized,
  ServerConfig
} from '@prizm/client-core'
import { useEffect } from 'react'
import { useLogsContext } from '../context/LogsContext'
import { usePrizmContext } from '../context/PrizmContext'
import {
  Globe,
  Keyboard,
  FolderOpen,
  Bot,
  Cpu,
  Server,
  Key,
  Terminal as TerminalIcon,
  Sparkles,
  ScrollText,
  Zap,
  Palette,
  AppWindow,
  User
} from 'lucide-react'
import { OnboardingWizard } from '../components/OnboardingWizard'
import { BrowserPlayground } from '../components/BrowserPlayground'
import { useUserProfile } from '../hooks/useUserProfile'
type SettingsCategory =
  | 'connection'
  | 'appearance'
  | 'profile'
  | 'input'
  | 'scope'
  | 'server'
  | 'llm'
  | 'agent'
  | 'embedding'
  | 'skillsAndMcp'
  | 'commands'
  | 'rules'
  | 'actions'
  | 'browser'

interface CategoryItem {
  key: SettingsCategory
  label: string
  icon: React.ReactNode
  requiresAuth?: boolean
}

const CATEGORIES: CategoryItem[] = [
  { key: 'connection', label: '连接', icon: <Globe size={16} /> },
  { key: 'appearance', label: '外观', icon: <Palette size={16} /> },
  { key: 'profile', label: '用户画像', icon: <User size={16} />, requiresAuth: true },
  { key: 'input', label: '输入', icon: <Keyboard size={16} /> },
  { key: 'scope', label: '工作区', icon: <FolderOpen size={16} />, requiresAuth: true },
  { key: 'server', label: '服务端/运维', icon: <Server size={16} />, requiresAuth: true },
  { key: 'llm', label: 'LLM 配置', icon: <Key size={16} />, requiresAuth: true },
  { key: 'agent', label: 'Agent', icon: <Bot size={16} />, requiresAuth: true },
  { key: 'embedding', label: '模型', icon: <Cpu size={16} />, requiresAuth: true },
  { key: 'skillsAndMcp', label: '技能与 MCP', icon: <Sparkles size={16} />, requiresAuth: true },
  { key: 'commands', label: '命令', icon: <TerminalIcon size={16} />, requiresAuth: true },
  { key: 'rules', label: '规则', icon: <ScrollText size={16} />, requiresAuth: true },
  { key: 'browser', label: '浏览器节点', icon: <AppWindow size={16} />, requiresAuth: true },
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
  const { profile, loading: profileLoading, updateProfile } = useUserProfile()
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
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileForm, setProfileForm] = useState({ displayName: '', preferredTone: '' })
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

  const [browserState, setBrowserState] = useState<{
    isRunning: boolean
    mode: 'internal' | 'external' | null
    wsEndpoint: string | null
  }>({ isRunning: false, mode: 'internal', wsEndpoint: null })

  const [browserServerConfig, setBrowserServerConfig] = useState<{
    configs: LLMConfigItemSanitized[]
    defaultModel?: string
    browserModel?: string
    browserUseStagehand?: boolean
  } | null>(null)
  /** 用于「浏览器使用模型」下拉的 entries（提供商+模型分组） */
  const [browserModelEntries, setBrowserModelEntries] = useState<
    Array<{ configId: string; configName: string; modelId: string; label: string }>
  >([])
  const [browserConfigLoading, setBrowserConfigLoading] = useState(false)

  useEffect(() => {
    if (window.prizm.browserNode) {
      window.prizm.browserNode
        .getStatus()
        .then(setBrowserState)
        .catch(() => {})
    }
  }, [])

  const loadBrowserServerConfig = useCallback(async () => {
    const http = manager?.getHttpClient()
    if (!http || activeCategory !== 'browser') return
    setBrowserConfigLoading(true)
    try {
      const [configRes, modelsRes] = await Promise.all([
        http.getServerConfig(),
        http.getAgentModels()
      ])
      const llm = configRes.llm
      const entries =
        (
          modelsRes as {
            entries?: Array<{
              configId: string
              configName: string
              modelId: string
              label: string
            }>
          }
        ).entries ?? []
      setBrowserModelEntries(entries)
      if (llm?.configs) {
        setBrowserServerConfig({
          configs: llm.configs,
          defaultModel: (llm as { defaultModel?: string }).defaultModel,
          browserModel: (llm as { browserModel?: string }).browserModel,
          browserUseStagehand: (llm as { browserUseStagehand?: boolean }).browserUseStagehand
        })
      } else {
        setBrowserServerConfig(null)
      }
    } catch {
      setBrowserServerConfig(null)
      setBrowserModelEntries([])
    } finally {
      setBrowserConfigLoading(false)
    }
  }, [manager, activeCategory])

  useEffect(() => {
    if (activeCategory === 'browser') void loadBrowserServerConfig()
  }, [activeCategory, loadBrowserServerConfig])

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

  useEffect(() => {
    if (profile && !profileLoading) {
      setProfileForm({
        displayName: profile.displayName ?? '',
        preferredTone: profile.preferredTone ?? ''
      })
    }
  }, [profile, profileLoading])

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
      toast.info('请确认 Prizm 服务端已启动（如 yarn dev:server 或 yarn start）')
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

  const [showOnboarding, setShowOnboarding] = useState(
    () => !config?.api_key || localStorage.getItem('prizm.onboardingCompleted') !== 'true'
  )

  useEffect(() => {
    if (config?.api_key && localStorage.getItem('prizm.onboardingCompleted') === 'true') {
      setShowOnboarding(false)
    }
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

  if (showOnboarding) {
    return (
      <section className="page settings-page">
        <OnboardingWizard
          onComplete={() => {
            localStorage.setItem('prizm.onboardingCompleted', 'true')
            setShowOnboarding(false)
          }}
          testConnection={testConnectionApi}
          registerClient={registerClientApi}
          saveConfig={saveConfigApi}
          loadConfig={loadConfig}
          setConfig={setConfig}
          updateUserProfile={updateProfile}
          initialStep={hasAuth ? 2 : undefined}
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
                <Form.Item
                  label="设备名称（可选）"
                  extra="用于区分多设备，不影响助手对你的称呼；称呼与语气在「用户画像」中设置"
                >
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

      case 'profile':
        return (
          <div className="settings-section">
            <div className="settings-section-header">
              <h2>用户画像</h2>
              <p className="form-hint">
                助手将用你设置的称呼和语气与你交流；首页展示名优先使用「显示名称」，未设置时使用设备名称
              </p>
            </div>
            <div className="settings-card">
              <Form className="compact-form" gap={8} layout="vertical">
                <Form.Item
                  label="显示名称"
                  extra="你希望助手怎么称呼你（如：小明、Alex），将用于首页问候与对话"
                >
                  <Input
                    variant={inputVariant}
                    value={profileForm.displayName}
                    onChange={(e) => setProfileForm((f) => ({ ...f, displayName: e.target.value }))}
                    placeholder="输入你希望被称呼的名字"
                    disabled={profileLoading}
                  />
                </Form.Item>
                <Form.Item label="希望的语气" extra="助手的回复风格（可选预设或自由填写）">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Segmented
                      value={
                        ['简洁专业', '友好随意', '中性克制'].includes(profileForm.preferredTone)
                          ? profileForm.preferredTone
                          : '__custom'
                      }
                      onChange={(v) => {
                        const val = v as string
                        if (val !== '__custom')
                          setProfileForm((f) => ({ ...f, preferredTone: val }))
                      }}
                      options={[
                        { label: '简洁专业', value: '简洁专业' },
                        { label: '友好随意', value: '友好随意' },
                        { label: '中性克制', value: '中性克制' },
                        { label: '其他（下方填写）', value: '__custom' }
                      ]}
                    />
                    <Input
                      variant={inputVariant}
                      value={
                        ['简洁专业', '友好随意', '中性克制'].includes(profileForm.preferredTone)
                          ? ''
                          : profileForm.preferredTone
                      }
                      onChange={(e) =>
                        setProfileForm((f) => ({ ...f, preferredTone: e.target.value }))
                      }
                      placeholder="或输入自定义语气"
                      disabled={profileLoading}
                    />
                  </div>
                </Form.Item>
                <Form.Item>
                  <div
                    className="config-actions"
                    style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                  >
                    <Button
                      type="primary"
                      loading={profileSaving}
                      disabled={profileLoading}
                      onClick={() => {
                        setProfileSaving(true)
                        updateProfile({
                          displayName: profileForm.displayName.trim() || undefined,
                          preferredTone: profileForm.preferredTone.trim() || undefined
                        })
                          .then(() => toast.success('已保存'))
                          .catch(() => toast.error('保存失败'))
                          .finally(() => setProfileSaving(false))
                      }}
                    >
                      保存
                    </Button>
                    <Button
                      onClick={() => {
                        localStorage.removeItem('prizm.onboardingCompleted')
                        setShowOnboarding(true)
                      }}
                    >
                      重新进行引导
                    </Button>
                  </div>
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

      case 'server':
        return <ServerConfigSettings http={manager?.getHttpClient() ?? null} onLog={addLog} />

      case 'llm':
        return <LLMConfigSettings http={manager?.getHttpClient() ?? null} onLog={addLog} />

      case 'agent':
        return <AgentGeneralSettings http={manager?.getHttpClient() ?? null} onLog={addLog} />

      case 'embedding':
        return <EmbeddingStatus http={manager?.getHttpClient() ?? null} onLog={addLog} />

      case 'skillsAndMcp':
        return <SkillsAndMcpSettings http={manager?.getHttpClient() ?? null} onLog={addLog} />

      case 'commands':
        return <CommandsSettings http={manager?.getHttpClient() ?? null} onLog={addLog} />

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

      case 'browser': {
        const effectiveBrowserModel = browserServerConfig?.browserModel ?? ''
        const browserModelOptions = buildModelSelectOptionsFromEntries(browserModelEntries, {
          label: '跟随系统默认',
          value: ''
        })
        const currentModelLabel = effectiveBrowserModel
          ? browserModelEntries.find((e) => `${e.configId}:${e.modelId}` === effectiveBrowserModel)
              ?.label
          : null

        return (
          <div className="settings-section">
            <div className="settings-section-header">
              <h2>浏览器节点</h2>
              <p className="form-hint">切换使用的浏览器实例（Prizm 内置 或 本机独立浏览器）</p>
            </div>
            <div className="settings-card">
              <Form className="compact-form" layout="vertical">
                <Form.Item
                  label="使用 Stagehand"
                  extra="开启后 perform/ai/extract 使用 Stagehand 的 act/observe/extract（需配置下方浏览器模型）。关闭则使用自建 snapshot+ref。"
                  valuePropName="checked"
                >
                  <Switch
                    checked={!!browserServerConfig?.browserUseStagehand}
                    onChange={async (checked: boolean) => {
                      const http = manager?.getHttpClient()
                      if (!http) return
                      try {
                        await http.updateServerConfig({
                          llm: { browserUseStagehand: checked }
                        } as unknown as Partial<ServerConfig>)
                        setBrowserServerConfig((prev) =>
                          prev ? { ...prev, browserUseStagehand: checked } : null
                        )
                        toast.success(checked ? '已启用 Stagehand' : '已改用自建 snapshot+ref')
                      } catch (e) {
                        toast.error(String(e))
                      }
                    }}
                    disabled={browserConfigLoading}
                  />
                </Form.Item>
                <Form.Item
                  label="浏览器使用模型"
                  extra="observe / extract 会向 LLM 发送页面截图，需使用支持多模态（vision）的模型。Stagehand 需要具体模型，按提供商选择。"
                >
                  <Select
                    value={effectiveBrowserModel}
                    onChange={async (v: string) => {
                      const http = manager?.getHttpClient()
                      if (!http) return
                      try {
                        await http.updateServerConfig({
                          llm: { browserModel: v || undefined }
                        } as unknown as Partial<ServerConfig>)
                        setBrowserServerConfig((prev) =>
                          prev ? { ...prev, browserModel: v || undefined } : null
                        )
                        toast.success('已更新浏览器使用模型')
                      } catch (e) {
                        toast.error(String(e))
                      }
                    }}
                    options={browserModelOptions}
                    placeholder={browserConfigLoading ? '加载中...' : '选择模型'}
                    disabled={browserConfigLoading}
                    style={{ minWidth: 220 }}
                  />
                  {currentModelLabel && (
                    <span
                      style={{
                        display: 'block',
                        marginTop: 6,
                        fontSize: 12,
                        color: 'var(--colorTextSecondary)'
                      }}
                    >
                      当前: {currentModelLabel}
                    </span>
                  )}
                </Form.Item>
                <Form.Item
                  label="节点状态"
                  extra="如果需要更改模式，会自动重启节点。外部浏览器模式将自动连接到默认浏览器或全新 Chrome（由 Playwright 驱动）。"
                >
                  <Segmented
                    value={browserState.mode || 'internal'}
                    onChange={async (v) => {
                      const mode = v as 'internal' | 'external'
                      if (browserState.mode === mode) return
                      try {
                        if (browserState.isRunning) await window.prizm.browserNode.stop()
                        const res = await window.prizm.browserNode.start(mode)
                        const state = await window.prizm.browserNode.getStatus()
                        setBrowserState(state)
                        if (res.success)
                          toast.success(`切换为 ${mode === 'internal' ? '内置' : '外部'} 节点`)
                        else toast.error(`切换失败: ${res.message}`)
                      } catch (e) {
                        toast.error(`切换失败: ${e}`)
                      }
                    }}
                    options={[
                      { label: '内置 Electron 节点', value: 'internal' },
                      { label: '外部 Chrome 独立节点', value: 'external' }
                    ]}
                  />
                  <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        background: browserState.isRunning ? '#52c41a' : '#ff4d4f'
                      }}
                    />
                    <span>{browserState.isRunning ? '节点运行中' : '节点未启动'}</span>
                    <Button
                      size="small"
                      onClick={async () => {
                        if (browserState.isRunning) await window.prizm.browserNode.stop()
                        else await window.prizm.browserNode.start(browserState.mode || 'internal')
                        const state = await window.prizm.browserNode.getStatus()
                        setBrowserState(state)
                      }}
                    >
                      {browserState.isRunning ? '停止' : '启动'}
                    </Button>
                  </div>
                </Form.Item>
              </Form>
              {config?.server && (
                <BrowserPlayground
                  baseUrl={buildServerUrl(config.server.host, config.server.port)}
                  apiKey={config.api_key ?? ''}
                  isNodeRunning={browserState.isRunning}
                />
              )}
            </div>
          </div>
        )
      }

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
