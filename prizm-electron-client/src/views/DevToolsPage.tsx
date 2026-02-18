import { Button, Flexbox, Input, toast } from '@lobehub/ui'
import { Tag } from 'antd'
import { memo, useState, useEffect, useCallback } from 'react'
import {
  Activity,
  CheckCircle,
  XCircle,
  Clock,
  Server,
  Wifi,
  WifiOff,
  Cpu,
  RefreshCw
} from 'lucide-react'
import { useLogsContext } from '../context/LogsContext'
import { usePrizmContext, useSyncEventContext } from '../context/PrizmContext'
import { useScope } from '../hooks/useScope'
import type { EventType } from '@prizm/client-core'
import { buildServerUrl } from '@prizm/client-core'
import { setLastSyncEvent } from '../events/syncEventStore'
import EditorPlayground from '../components/EditorPlayground'

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

  return (
    <section className="page settings-page devtools-page">
      {/* System diagnostics */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>系统诊断</h2>
          <p className="form-hint">服务器连接状态、版本信息和运行健康度</p>
        </div>
        <div className="devtools-diagnostics">
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

      {/* Local notification test */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>本地通知测试</h2>
          <p className="form-hint">直接弹出应用内通知窗口，无需服务器</p>
        </div>
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
            placeholder="内容（可选）"
          />
          <Button type="primary" onClick={sendLocalNotif} disabled={!localNotif.title.trim()}>
            发送本地通知
          </Button>
        </Flexbox>
      </div>

      {/* Server notification test */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>服务器通知测试</h2>
          <p className="form-hint">通过 POST /notify 发送，会经 WebSocket 推送给已连接的客户端</p>
        </div>
        <Flexbox className="test-row" horizontal gap={12} align="center" wrap="wrap">
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
            发送服务器通知
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

      {/* Mock data */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>模拟数据</h2>
          <p className="form-hint">通过 API 创建数据，触发 WebSocket 同步，各 Tab 会自动刷新</p>
        </div>
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

      {/* Manual refresh */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>手动刷新</h2>
          <p className="form-hint">强制触发各 Tab 列表刷新（用于测试数据同步）</p>
        </div>
        <div className="config-actions">
          <Button onClick={() => triggerRefresh('todo_list:updated')}>刷新 TODO</Button>
          <Button onClick={() => triggerRefresh('clipboard:itemAdded')}>刷新剪贴板</Button>
        </div>
      </div>

      {/* Editor comparison playground */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>编辑器对比体验</h2>
          <p className="form-hint">
            左侧 CodeMirror 6（当前源码编辑器）vs 右侧 Lobe Editor（Lexical 富文本），同一示例内容
          </p>
        </div>
        <EditorPlayground />
      </div>
    </section>
  )
}

export default memo(DevToolsPage)
