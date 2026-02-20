import { Button, Flexbox, Input, toast } from '@lobehub/ui'
import { InputNumber, Tag } from 'antd'
import { memo, useState, useEffect, useCallback, useRef } from 'react'
import {
  Activity,
  Bell,
  CheckCircle,
  XCircle,
  Clock,
  Server,
  Wifi,
  WifiOff,
  Cpu,
  RefreshCw,
  FileText,
  ListTodo,
  Clipboard,
  StickyNote,
  Code,
  RotateCcw,
  Play,
  Square,
  GitBranch,
  Database,
  Calendar,
  Zap
} from 'lucide-react'
import { useLogsContext } from '../context/LogsContext'
import { usePrizmContext, useSyncEventContext } from '../context/PrizmContext'
import { useScope } from '../hooks/useScope'
import { useScheduleStore } from '../store/scheduleStore'
import type { EventType } from '@prizm/client-core'
import { buildServerUrl } from '@prizm/client-core'
import { setLastSyncEvent } from '../events/syncEventStore'
import EditorPlayground from '../components/EditorPlayground'
import { WorkflowPlayground } from '../components/workflow/WorkflowPlayground'
import { WorkflowEditor } from '../components/workflow/editor'
import { useWorkflowStore } from '../store/workflowStore'
import dayjs from 'dayjs'

type DevCategory =
  | 'diagnostics'
  | 'notification'
  | 'mockdata'
  | 'schedule'
  | 'refresh'
  | 'workflow'
  | 'workflow-editor'
  | 'editor'

interface CategoryItem {
  key: DevCategory
  label: string
  icon: React.ReactNode
}

const CATEGORIES: CategoryItem[] = [
  { key: 'diagnostics', label: '系统诊断', icon: <Activity size={16} /> },
  { key: 'notification', label: '通知测试', icon: <Bell size={16} /> },
  { key: 'mockdata', label: '模拟数据', icon: <Database size={16} /> },
  { key: 'schedule', label: '模拟日程', icon: <Calendar size={16} /> },
  { key: 'refresh', label: '手动刷新', icon: <RefreshCw size={16} /> },
  { key: 'workflow', label: 'Workflow', icon: <GitBranch size={16} /> },
  { key: 'workflow-editor', label: '流程编辑器', icon: <Zap size={16} /> },
  { key: 'editor', label: '编辑器', icon: <Code size={16} /> }
]

interface HealthInfo {
  status: string
  version?: string
  uptime?: number
  port?: number
  embedding?: { enabled: boolean; status: string; modelId?: string }
  [key: string]: unknown
}

function DevToolsPage() {
  const { manager, config, status } = usePrizmContext()
  const { currentScope } = useScope()
  const { lastSyncEvent } = useSyncEventContext()
  const { addLog } = useLogsContext()

  const [activeCategory, setActiveCategory] = useState<DevCategory>('diagnostics')
  const [healthInfo, setHealthInfo] = useState<HealthInfo | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [pingMs, setPingMs] = useState<number | null>(null)

  const [localNotif, setLocalNotif] = useState({
    title: '测试通知',
    body: '支持 **Markdown** 渲染'
  })
  const [serverNotif, setServerNotif] = useState({
    title: '服务器通知',
    body: '来自 WebSocket'
  })
  const [serverNotifResult, setServerNotifResult] = useState<{
    ok: boolean
    msg: string
  } | null>(null)

  const [burstCount, setBurstCount] = useState(5)
  const [burstInterval, setBurstInterval] = useState(300)
  const burstTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [burstRunning, setBurstRunning] = useState(false)
  const burstIndexRef = useRef(0)

  const [mockTask, setMockTask] = useState('测试任务')
  const [mockClipboard, setMockClipboard] = useState('测试剪贴板内容')
  const [mockResult, setMockResult] = useState<{
    ok: boolean
    msg: string
  } | null>(null)

  const fetchHealth = useCallback(async () => {
    if (!config) return
    setHealthLoading(true)
    setHealthError(null)
    const serverUrl = buildServerUrl(config.server.host, config.server.port)
    const start = performance.now()
    try {
      const res = await fetch(`${serverUrl}/health`)
      const elapsed = Math.round(performance.now() - start)
      setPingMs(elapsed)
      if (res.ok) {
        const data = await res.json()
        setHealthInfo(data)
      } else {
        setHealthError(`HTTP ${res.status}`)
      }
    } catch (e) {
      setHealthError(e instanceof Error ? e.message : String(e))
      setPingMs(null)
    } finally {
      setHealthLoading(false)
    }
  }, [config])

  useEffect(() => {
    void fetchHealth()
  }, [fetchHealth])

  function formatUptime(seconds?: number): string {
    if (seconds == null) return '--'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}h ${m}m ${s}s`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  function sendLocalNotif() {
    if (!localNotif.title.trim()) return
    window.prizm.showNotification({
      title: localNotif.title.trim(),
      body: localNotif.body.trim() || undefined
    })
    toast.success('已发送本地通知')
    addLog('已发送本地通知', 'success')
  }

  async function sendServerNotif() {
    if (!serverNotif.title.trim() || !manager) return
    setServerNotifResult(null)
    try {
      const http = manager.getHttpClient()
      await http.sendNotify(serverNotif.title.trim(), serverNotif.body.trim() || undefined)
      setServerNotifResult({
        ok: true,
        msg: '已发送，若已连接 WebSocket 将收到通知'
      })
      toast.success('已发送服务器通知')
      addLog('已发送服务器通知', 'success')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setServerNotifResult({ ok: false, msg })
      toast.error(`服务器通知失败: ${msg}`)
      addLog(`服务器通知失败: ${msg}`, 'error')
    }
  }

  async function mockCreateTask() {
    if (!mockTask.trim() || !manager) return
    setMockResult(null)
    try {
      const http = manager.getHttpClient()
      const lists = await http.getTodoLists(currentScope)
      const payload =
        lists.length > 0
          ? { title: mockTask.trim(), listId: lists[0].id }
          : { title: mockTask.trim(), listTitle: '测试' }
      await http.createTodoItem(currentScope, payload)
      setLastSyncEvent('todo_list:updated')
      setMockResult({ ok: true, msg: '已添加 TODO 项，列表将刷新' })
      toast.success('已添加 TODO 项')
      addLog('已添加 TODO 项', 'success')
    } catch (e) {
      setMockResult({
        ok: false,
        msg: e instanceof Error ? e.message : String(e)
      })
      toast.error(`添加 TODO 失败: ${String(e)}`)
      addLog(`添加 TODO 失败: ${String(e)}`, 'error')
    }
  }

  async function mockAddClipboard() {
    if (!mockClipboard.trim() || !manager) return
    setMockResult(null)
    try {
      const http = manager.getHttpClient()
      await http.addClipboardItem({
        type: 'text',
        content: mockClipboard.trim(),
        createdAt: Date.now()
      })
      setLastSyncEvent('clipboard:itemAdded')
      setMockResult({ ok: true, msg: '已添加剪贴板项，剪贴板 Tab 将刷新' })
      toast.success('已添加测试剪贴板')
      addLog('已添加测试剪贴板', 'success')
    } catch (e) {
      setMockResult({
        ok: false,
        msg: e instanceof Error ? e.message : String(e)
      })
      toast.error(`添加剪贴板失败: ${String(e)}`)
      addLog(`添加剪贴板失败: ${String(e)}`, 'error')
    }
  }

  function triggerRefresh(eventType: EventType) {
    setLastSyncEvent(eventType)
    toast.info(`已触发刷新: ${eventType}`)
    addLog(`已触发刷新: ${eventType}`, 'info')
  }

  const inputProps = {
    variant: 'filled' as const,
    className: 'test-input'
  }

  const wsConnected = status === 'connected'
  const embeddingStatus = healthInfo?.embedding

  function renderContent() {
    switch (activeCategory) {
      case 'diagnostics':
        return (
          <div className="settings-section">
            <div className="settings-section-header">
              <h2>系统诊断</h2>
              <p className="form-hint">服务器连接状态、版本信息和运行健康度</p>
            </div>
            <div className="settings-card">
              <div className="devtools-status-grid">
                <div className="devtools-status-card">
                  <div className="devtools-status-card__icon">
                    {wsConnected ? <Wifi size={20} /> : <WifiOff size={20} />}
                  </div>
                  <div className="devtools-status-card__info">
                    <span className="devtools-status-card__label">WebSocket</span>
                    <Tag color={wsConnected ? 'green' : 'red'} variant="filled">
                      {wsConnected ? '已连接' : '断开'}
                    </Tag>
                  </div>
                </div>
                <div className="devtools-status-card">
                  <div className="devtools-status-card__icon">
                    <Activity size={20} />
                  </div>
                  <div className="devtools-status-card__info">
                    <span className="devtools-status-card__label">延迟</span>
                    <span className="devtools-status-card__value">
                      {pingMs != null ? `${pingMs}ms` : '--'}
                    </span>
                  </div>
                </div>
                <div className="devtools-status-card">
                  <div className="devtools-status-card__icon">
                    <Server size={20} />
                  </div>
                  <div className="devtools-status-card__info">
                    <span className="devtools-status-card__label">服务器</span>
                    {healthInfo ? (
                      <Tag color="green" variant="filled">
                        <CheckCircle size={12} style={{ marginRight: 4 }} />
                        运行中
                      </Tag>
                    ) : healthError ? (
                      <Tag color="red" variant="filled">
                        <XCircle size={12} style={{ marginRight: 4 }} />
                        不可达
                      </Tag>
                    ) : (
                      <span className="devtools-status-card__value">--</span>
                    )}
                  </div>
                </div>
                <div className="devtools-status-card">
                  <div className="devtools-status-card__icon">
                    <Clock size={20} />
                  </div>
                  <div className="devtools-status-card__info">
                    <span className="devtools-status-card__label">运行时间</span>
                    <span className="devtools-status-card__value">
                      {formatUptime(healthInfo?.uptime as number | undefined)}
                    </span>
                  </div>
                </div>
                <div className="devtools-status-card">
                  <div className="devtools-status-card__icon">
                    <Cpu size={20} />
                  </div>
                  <div className="devtools-status-card__info">
                    <span className="devtools-status-card__label">Embedding</span>
                    {embeddingStatus ? (
                      <Tag
                        color={embeddingStatus.status === 'ready' ? 'green' : 'orange'}
                        variant="filled"
                      >
                        {embeddingStatus.status}
                      </Tag>
                    ) : (
                      <span className="devtools-status-card__value">--</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="config-actions" style={{ marginTop: 12 }}>
                <Button
                  onClick={() => void fetchHealth()}
                  disabled={healthLoading}
                  icon={<RefreshCw size={14} />}
                >
                  {healthLoading ? '检测中...' : '重新检测'}
                </Button>
              </div>
              {healthError && (
                <p className="form-hint text-error" style={{ marginTop: 8 }}>
                  健康检查失败: {healthError}
                </p>
              )}
            </div>
          </div>
        )

      case 'notification':
        return (
          <div className="settings-section">
            <div className="settings-section-header">
              <h2>通知 Playground</h2>
              <p className="form-hint">
                测试各种通知场景 — 所有通知直接弹出到桌面独立通知窗口（右下角堆叠）
              </p>
            </div>
            <div className="settings-card">
              <div className="notif-playground">
                <h3 className="notif-playground__subtitle">预设场景</h3>
                <div className="notif-playground__grid">
                  <Button
                    icon={<Bell size={14} />}
                    onClick={() => {
                      window.prizm.showNotification({
                        title: '普通通知',
                        body: '这是一条简单的通知消息'
                      })
                      toast.success('已发送')
                    }}
                  >
                    单条通知
                  </Button>
                  <Button
                    icon={<Code size={14} />}
                    onClick={() => {
                      window.prizm.showNotification({
                        title: 'Markdown 通知',
                        body: '支持 **粗体**、`代码`、[链接](https://example.com)\n\n- 列表项 1\n- 列表项 2'
                      })
                      toast.success('已发送')
                    }}
                  >
                    Markdown 富文本
                  </Button>
                  <Button
                    icon={<ListTodo size={14} />}
                    onClick={() => {
                      window.prizm.showNotification({
                        eventType: 'todo_list:updated',
                        payload: {
                          title: '项目计划',
                          itemCount: 5,
                          doneCount: 3,
                          items: [
                            { id: '1', title: '设计数据库 Schema', status: 'done' },
                            { id: '2', title: '实现 API 接口', status: 'done' },
                            { id: '3', title: '编写单元测试', status: 'done' },
                            { id: '4', title: '前端集成', status: 'doing' },
                            { id: '5', title: '部署上线', status: 'pending' }
                          ]
                        }
                      })
                      toast.success('已发送')
                    }}
                  >
                    TODO 列表
                  </Button>
                  <Button
                    icon={<ListTodo size={14} />}
                    onClick={() => {
                      window.prizm.showNotification({
                        eventType: 'todo_item:created',
                        payload: { title: '完成通知窗口重构' }
                      })
                      toast.success('已发送')
                    }}
                  >
                    TODO 项变更
                  </Button>
                  <Button
                    icon={<FileText size={14} />}
                    onClick={() => {
                      window.prizm.showNotification({
                        eventType: 'document:updated',
                        payload: { title: '技术设计文档 v2.0' }
                      })
                      toast.success('已发送')
                    }}
                  >
                    文档变更
                  </Button>
                  <Button
                    icon={<Clipboard size={14} />}
                    onClick={() => {
                      window.prizm.showNotification({
                        eventType: 'clipboard:itemAdded',
                        payload: { content: 'const result = await fetchData()' }
                      })
                      toast.success('已发送')
                    }}
                  >
                    剪贴板新增
                  </Button>
                  <Button
                    icon={<StickyNote size={14} />}
                    onClick={() => {
                      window.prizm.showNotification({
                        eventType: 'note:created',
                        payload: { title: '会议记录：周一产品评审' }
                      })
                      toast.success('已发送')
                    }}
                  >
                    新便签
                  </Button>
                  <Button
                    icon={<RotateCcw size={14} />}
                    onClick={() => {
                      const uid = 'playground-update-test'
                      window.prizm.showNotification({
                        title: '下载进度',
                        body: '正在下载... 30%',
                        updateId: uid
                      })
                      setTimeout(() => {
                        window.prizm.showNotification({
                          title: '下载进度',
                          body: '正在下载... 70%',
                          updateId: uid
                        })
                      }, 1500)
                      setTimeout(() => {
                        window.prizm.showNotification({
                          title: '下载完成',
                          body: '文件已保存到本地',
                          updateId: uid
                        })
                      }, 3000)
                      toast.success('将依次更新 3 次')
                    }}
                  >
                    更新同一通知
                  </Button>
                  <Button
                    icon={<FileText size={14} />}
                    onClick={() => {
                      window.prizm.showNotification({
                        title: '长内容测试',
                        body: '这是一段很长的通知内容，用于测试通知卡片对长文本的截断和显示效果。'.repeat(
                          5
                        )
                      })
                      toast.success('已发送')
                    }}
                  >
                    长内容
                  </Button>
                </div>

                <h3 className="notif-playground__subtitle" style={{ marginTop: 20 }}>
                  连发测试
                </h3>
                <p className="form-hint">快速发送多条通知，测试堆叠和展开效果</p>
                <Flexbox
                  className="test-row"
                  horizontal
                  gap={12}
                  align="center"
                  wrap="wrap"
                  style={{ marginTop: 8 }}
                >
                  <Flexbox horizontal gap={6} align="center">
                    <span className="form-hint" style={{ whiteSpace: 'nowrap' }}>
                      数量
                    </span>
                    <InputNumber
                      min={2}
                      max={20}
                      value={burstCount}
                      onChange={(v) => v && setBurstCount(v)}
                      style={{ width: 70 }}
                      size="small"
                    />
                  </Flexbox>
                  <Flexbox horizontal gap={6} align="center">
                    <span className="form-hint" style={{ whiteSpace: 'nowrap' }}>
                      间隔 ms
                    </span>
                    <InputNumber
                      min={50}
                      max={3000}
                      step={50}
                      value={burstInterval}
                      onChange={(v) => v && setBurstInterval(v)}
                      style={{ width: 80 }}
                      size="small"
                    />
                  </Flexbox>
                  <Button
                    type="primary"
                    icon={burstRunning ? <Square size={14} /> : <Play size={14} />}
                    onClick={() => {
                      if (burstRunning) {
                        if (burstTimerRef.current) clearInterval(burstTimerRef.current)
                        burstTimerRef.current = null
                        setBurstRunning(false)
                        return
                      }
                      burstIndexRef.current = 0
                      setBurstRunning(true)
                      const labels = [
                        '通知',
                        '提醒',
                        '消息',
                        '更新',
                        '警告',
                        '信息',
                        '事件',
                        '任务'
                      ]
                      const send = () => {
                        const i = burstIndexRef.current
                        if (i >= burstCount) {
                          if (burstTimerRef.current) clearInterval(burstTimerRef.current)
                          burstTimerRef.current = null
                          setBurstRunning(false)
                          return
                        }
                        const label = labels[i % labels.length]
                        window.prizm.showNotification({
                          title: `${label} #${i + 1}`,
                          body: `连发测试 — 第 ${i + 1}/${burstCount} 条`
                        })
                        burstIndexRef.current++
                      }
                      send()
                      burstTimerRef.current = setInterval(send, burstInterval)
                    }}
                  >
                    {burstRunning ? '停止' : `连发 ${burstCount} 条`}
                  </Button>
                </Flexbox>

                <h3 className="notif-playground__subtitle" style={{ marginTop: 20 }}>
                  自定义通知
                </h3>
                <Flexbox className="test-row" horizontal gap={12} align="center" wrap="wrap">
                  <Input
                    {...inputProps}
                    value={localNotif.title}
                    onChange={(e) => setLocalNotif((f) => ({ ...f, title: e.target.value }))}
                    placeholder="标题"
                  />
                  <Input
                    {...inputProps}
                    value={localNotif.body}
                    onChange={(e) => setLocalNotif((f) => ({ ...f, body: e.target.value }))}
                    placeholder="内容（可选，支持 Markdown）"
                  />
                  <Button
                    type="primary"
                    onClick={sendLocalNotif}
                    disabled={!localNotif.title.trim()}
                  >
                    发送
                  </Button>
                </Flexbox>

                <h3 className="notif-playground__subtitle" style={{ marginTop: 20 }}>
                  服务器通知
                </h3>
                <p className="form-hint">通过 POST /notify 发送，经 WebSocket 推送给已连接客户端</p>
                <Flexbox
                  className="test-row"
                  horizontal
                  gap={12}
                  align="center"
                  wrap="wrap"
                  style={{ marginTop: 8 }}
                >
                  <Input
                    {...inputProps}
                    value={serverNotif.title}
                    onChange={(e) => setServerNotif((f) => ({ ...f, title: e.target.value }))}
                    placeholder="标题"
                  />
                  <Input
                    {...inputProps}
                    value={serverNotif.body}
                    onChange={(e) => setServerNotif((f) => ({ ...f, body: e.target.value }))}
                    placeholder="内容（可选）"
                  />
                  <Button
                    type="primary"
                    onClick={sendServerNotif}
                    disabled={!serverNotif.title.trim() || !manager}
                  >
                    发送
                  </Button>
                </Flexbox>
                {serverNotifResult && (
                  <p
                    className={`form-hint test-result-hint ${
                      serverNotifResult.ok ? 'text-success' : 'text-error'
                    }`}
                  >
                    {serverNotifResult.msg}
                  </p>
                )}
              </div>
            </div>
          </div>
        )

      case 'mockdata':
        return (
          <div className="settings-section">
            <div className="settings-section-header">
              <h2>模拟数据</h2>
              <p className="form-hint">通过 API 创建数据，触发 WebSocket 同步，各 Tab 会自动刷新</p>
            </div>
            <div className="settings-card">
              <div className="test-actions">
                <div className="test-action">
                  <Input
                    {...inputProps}
                    value={mockTask}
                    onChange={(e) => setMockTask(e.target.value)}
                    placeholder="TODO 项标题"
                  />
                  <Button onClick={mockCreateTask} disabled={!mockTask.trim() || !manager}>
                    添加 TODO
                  </Button>
                </div>
                <div className="test-action">
                  <Input
                    {...inputProps}
                    value={mockClipboard}
                    onChange={(e) => setMockClipboard(e.target.value)}
                    placeholder="剪贴板内容"
                  />
                  <Button onClick={mockAddClipboard} disabled={!mockClipboard.trim() || !manager}>
                    添加剪贴板
                  </Button>
                </div>
              </div>
              {mockResult && (
                <p
                  className={`form-hint test-result-hint ${
                    mockResult.ok ? 'text-success' : 'text-error'
                  }`}
                >
                  {mockResult.msg}
                </p>
              )}
            </div>
          </div>
        )

      case 'schedule':
        return <MockScheduleSection />

      case 'refresh':
        return (
          <div className="settings-section">
            <div className="settings-section-header">
              <h2>手动刷新</h2>
              <p className="form-hint">强制触发各 Tab 列表刷新（用于测试数据同步）</p>
            </div>
            <div className="settings-card">
              <div className="config-actions" style={{ marginTop: 0 }}>
                <Button onClick={() => triggerRefresh('todo_list:updated')}>刷新 TODO</Button>
                <Button onClick={() => triggerRefresh('clipboard:itemAdded')}>刷新剪贴板</Button>
                <Button onClick={() => triggerRefresh('schedule:created')}>刷新日程</Button>
              </div>
            </div>
          </div>
        )

      case 'workflow':
        return (
          <div className="settings-section">
            <div className="settings-section-header">
              <h2>Workflow & Task Playground</h2>
              <p className="form-hint">工作流与任务系统 — 管理定义、查看运行、手动触发执行</p>
            </div>
            <div className="settings-card">
              <WorkflowPlayground />
            </div>
          </div>
        )

      case 'workflow-editor':
        return <WorkflowEditorSection />

      case 'editor':
        return (
          <div className="settings-section">
            <div className="settings-section-header">
              <h2>编辑器对比体验</h2>
              <p className="form-hint">
                左侧 CodeMirror 6（当前源码编辑器）vs 右侧 Lobe Editor（Lexical
                富文本），同一示例内容
              </p>
            </div>
            <div className="settings-card">
              <EditorPlayground />
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
        <nav className="settings-sidebar" role="navigation" aria-label="测试工具分类">
          {CATEGORIES.map((cat) => (
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

/* ══════════════════════════════════════════════
   工作流可视化编辑器 Section
   ══════════════════════════════════════════════ */

function WorkflowEditorSection() {
  const registerDef = useWorkflowStore((s) => s.registerDef)
  const runWorkflow = useWorkflowStore((s) => s.runWorkflow)
  const defs = useWorkflowStore((s) => s.defs)
  const refreshDefs = useWorkflowStore((s) => s.refreshDefs)

  const [editingDef, setEditingDef] = useState<(typeof defs)[number] | null>(null)

  useEffect(() => {
    void refreshDefs()
  }, [refreshDefs])

  const handleSave = useCallback(
    async (name: string, yaml: string, description?: string) => {
      await registerDef(name, yaml, description)
      toast.success(`已保存: ${name}`)
    },
    [registerDef]
  )

  const handleRun = useCallback(
    (name: string) => {
      void runWorkflow({ workflow_name: name })
      toast.success(`已触发运行: ${name}`)
    },
    [runWorkflow]
  )

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>工作流可视化编辑器</h2>
        <p className="form-hint">
          拖拽式流程编辑器 — 添加 Agent / 审批 / 变换步骤，连线构建工作流，支持 YAML 双向同步
        </p>
      </div>

      {/* Quick-load existing defs */}
      {defs.length > 0 && (
        <div className="settings-card">
          <h3 className="notif-playground__subtitle" style={{ margin: 0 }}>
            加载已有定义
          </h3>
          <p className="form-hint" style={{ marginTop: 2 }}>
            点击加载现有工作流定义进行编辑
          </p>
          <div className="notif-playground__grid" style={{ marginTop: 8 }}>
            {defs.map((def) => (
              <Button
                key={def.id}
                icon={<GitBranch size={14} />}
                onClick={() => setEditingDef(def)}
                type={editingDef?.id === def.id ? 'primary' : 'default'}
              >
                {def.name}
              </Button>
            ))}
            <Button onClick={() => setEditingDef(null)}>+ 新建空白</Button>
          </div>
        </div>
      )}

      {/* Embedded editor */}
      <div className="settings-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ height: 'calc(100vh - 320px)', minHeight: 400 }}>
          <WorkflowEditor
            key={editingDef?.id ?? '__new__'}
            defRecord={editingDef ?? undefined}
            onSave={handleSave}
            onRun={handleRun}
          />
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════
   模拟日程数据 Section
   ══════════════════════════════════════════════ */

const MOCK_PRESETS = [
  {
    label: '今天的会议',
    type: 'event',
    offsetDays: 0,
    offsetHour: 14,
    durationMin: 60,
    desc: '团队周例会'
  },
  {
    label: '明天截止',
    type: 'deadline',
    offsetDays: 1,
    offsetHour: 18,
    durationMin: 0,
    desc: '提交设计文档'
  },
  {
    label: '后天提醒',
    type: 'reminder',
    offsetDays: 2,
    offsetHour: 9,
    durationMin: 0,
    desc: '检查代码审查进度'
  },
  {
    label: '下周事件',
    type: 'event',
    offsetDays: 7,
    offsetHour: 10,
    durationMin: 120,
    desc: '产品发布评审'
  },
  {
    label: '全天事件',
    type: 'event',
    offsetDays: 3,
    offsetHour: 0,
    durationMin: 0,
    desc: '公司团建日',
    allDay: true
  }
] as const

function MockScheduleSection() {
  const createSchedule = useScheduleStore((s) => s.createSchedule)
  const schedules = useScheduleStore((s) => s.schedules)
  const deleteSchedule = useScheduleStore((s) => s.deleteSchedule)
  const refreshSchedules = useScheduleStore((s) => s.refreshSchedules)
  const { addLog } = useLogsContext()
  const [loading, setLoading] = useState<string | null>(null)
  const [batchLoading, setBatchLoading] = useState(false)

  const handlePreset = useCallback(
    async (preset: (typeof MOCK_PRESETS)[number]) => {
      setLoading(preset.label)
      const now = dayjs()
      const start = now.add(preset.offsetDays, 'day').hour(preset.offsetHour).minute(0).second(0)
      const result = await createSchedule({
        title: preset.label,
        description: preset.desc,
        type: preset.type as 'event' | 'reminder' | 'deadline',
        startTime: start.valueOf(),
        endTime:
          preset.durationMin > 0 ? start.add(preset.durationMin, 'minute').valueOf() : undefined,
        allDay: 'allDay' in preset ? preset.allDay : false
      })
      if (result) {
        toast.success(`已创建: ${preset.label}`)
        addLog(`模拟日程已创建: ${preset.label}`, 'success')
      } else {
        toast.error('创建失败')
      }
      setLoading(null)
    },
    [createSchedule, addLog]
  )

  const handleBatchCreate = useCallback(async () => {
    setBatchLoading(true)
    let count = 0
    for (const preset of MOCK_PRESETS) {
      const now = dayjs()
      const start = now.add(preset.offsetDays, 'day').hour(preset.offsetHour).minute(0).second(0)
      const result = await createSchedule({
        title: preset.label,
        description: preset.desc,
        type: preset.type as 'event' | 'reminder' | 'deadline',
        startTime: start.valueOf(),
        endTime:
          preset.durationMin > 0 ? start.add(preset.durationMin, 'minute').valueOf() : undefined,
        allDay: 'allDay' in preset ? preset.allDay : false
      })
      if (result) count++
    }
    toast.success(`批量创建完成: ${count}/${MOCK_PRESETS.length} 条`)
    addLog(`批量创建 ${count} 条模拟日程`, 'success')
    setBatchLoading(false)
  }, [createSchedule, addLog])

  const handleClearAll = useCallback(async () => {
    if (schedules.length === 0) {
      toast.info('没有可删除的日程')
      return
    }
    setBatchLoading(true)
    let count = 0
    for (const s of schedules) {
      const ok = await deleteSchedule(s.id)
      if (ok) count++
    }
    toast.success(`已清空 ${count} 条日程`)
    addLog(`已清空 ${count} 条模拟日程`, 'success')
    setBatchLoading(false)
  }, [schedules, deleteSchedule, addLog])

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>模拟日程数据</h2>
        <p className="form-hint">
          快速创建测试日程，验证工作台侧边栏的时间线、月历和详情功能。 当前 scope 已有{' '}
          <strong>{schedules.length}</strong> 条日程。
        </p>
      </div>

      <div className="settings-card">
        <h3 className="notif-playground__subtitle" style={{ margin: 0 }}>
          快捷预设
        </h3>
        <p className="form-hint" style={{ marginTop: 2 }}>
          点击按钮一键创建对应类型的模拟日程
        </p>
        <div className="notif-playground__grid" style={{ marginTop: 8 }}>
          {MOCK_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              icon={
                preset.type === 'event' ? (
                  <Calendar size={14} />
                ) : preset.type === 'deadline' ? (
                  <Clock size={14} />
                ) : (
                  <Bell size={14} />
                )
              }
              onClick={() => void handlePreset(preset)}
              disabled={loading === preset.label}
            >
              {loading === preset.label ? '创建中...' : preset.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="settings-card">
        <h3 className="notif-playground__subtitle" style={{ margin: 0 }}>
          批量操作
        </h3>
        <div className="config-actions" style={{ marginTop: 8 }}>
          <Button
            type="primary"
            icon={<Zap size={14} />}
            onClick={handleBatchCreate}
            disabled={batchLoading}
          >
            {batchLoading ? '创建中...' : `一键创建全部 (${MOCK_PRESETS.length} 条)`}
          </Button>
          <Button danger onClick={handleClearAll} disabled={batchLoading || schedules.length === 0}>
            清空所有日程 ({schedules.length})
          </Button>
          <Button onClick={() => void refreshSchedules()} icon={<RefreshCw size={14} />}>
            刷新列表
          </Button>
        </div>
      </div>

      {schedules.length > 0 && (
        <div className="settings-card">
          <h3 className="notif-playground__subtitle" style={{ margin: 0 }}>
            当前日程列表
          </h3>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {schedules.slice(0, 20).map((s) => (
              <div key={s.id} className="devtools-schedule-row">
                <Tag
                  color={s.type === 'event' ? 'blue' : s.type === 'deadline' ? 'red' : 'orange'}
                  style={{ fontSize: 11, lineHeight: '18px', margin: 0 }}
                >
                  {s.type}
                </Tag>
                <span className="devtools-schedule-row__title">{s.title}</span>
                <span className="devtools-schedule-row__time">
                  {s.allDay
                    ? dayjs(s.startTime).format('MM/DD 全天')
                    : dayjs(s.startTime).format('MM/DD HH:mm')}
                </span>
                <Tag
                  color={
                    s.status === 'completed'
                      ? 'green'
                      : s.status === 'cancelled'
                      ? 'default'
                      : 'processing'
                  }
                  style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}
                >
                  {s.status}
                </Tag>
              </div>
            ))}
            {schedules.length > 20 && (
              <p className="form-hint">… 还有 {schedules.length - 20} 条</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(DevToolsPage)
