import { Button, Checkbox, Form, Input } from '@lobehub/ui'
import { McpSettings } from '../components/McpSettings'
import { AgentGeneralSettings } from '../components/AgentGeneralSettings'
import { EVENT_TYPES, buildServerUrl, getEventLabel } from '@prizm/client-core'
import type { EventType, PrizmConfig } from '@prizm/client-core'
import { useEffect, useState } from 'react'
import { useLogsContext } from '../context/LogsContext'
import { usePrizmContext } from '../context/PrizmContext'

export default function SettingsPage() {
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
  const { logs, addLog, clearLogs } = useLogsContext()

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
    }
  }

  async function testConnection() {
    const serverUrl = buildServerUrl(form.host.trim(), form.port.trim())
    if (!form.host.trim() || !form.port.trim()) {
      addLog('请填写服务器地址和端口', 'error')
      return
    }
    setTesting(true)
    const success = await testConnectionApi(serverUrl)
    setTesting(false)
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

  const inputVariant = 'filled' as const

  return (
    <section className="page settings-page">
      <div className="settings-section">
        <div className="settings-section-header">
          <h2>服务器配置</h2>
          <p className="form-hint">连接 Prizm 服务端地址与客户端注册信息</p>
        </div>
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
            <div className="config-actions">
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

      {config?.api_key && (
        <AgentGeneralSettings http={manager?.getHttpClient() ?? null} onLog={addLog} />
      )}

      {config?.api_key && <McpSettings http={manager?.getHttpClient() ?? null} onLog={addLog} />}

      <div className="settings-section">
        <div className="settings-section-header">
          <h2>快捷操作</h2>
          <p className="form-hint">重新连接 WebSocket 或打开服务端仪表板</p>
        </div>
        <div className="config-actions">
          <Button onClick={reconnect} disabled={reconnecting}>
            {reconnecting ? '重新连接中...' : '重新连接'}
          </Button>
          <Button onClick={openDashboard}>打开仪表板</Button>
        </div>
      </div>

      <div className="settings-section logs-section">
        <div className="settings-section-header logs-header">
          <div>
            <h2>日志</h2>
            <p className="form-hint">连接与操作记录</p>
          </div>
          <div className="logs-actions">
            <Button size="small" onClick={clearLogs}>
              清空
            </Button>
            <Button
              size="small"
              onClick={() => {
                const text = logs
                  .map(
                    (l) =>
                      `[${l.timestamp}] [${l.type}]${l.source ? ` [${l.source}]` : ''} ${l.message}`
                  )
                  .join('\n')
                const blob = new Blob([text], {
                  type: 'text/plain;charset=utf-8'
                })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `prizm-logs-${new Date().toISOString().slice(0, 10)}.log`
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              导出
            </Button>
          </div>
        </div>
        <div className="logs">
          {logs.length === 0 ? (
            <div className="log-placeholder">等待连接...</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={`log-item ${log.type}`}>
                <span className="log-time">[{log.timestamp}]</span>
                {log.source && <span className="log-source">[{log.source}]</span>}
                <span className="log-msg">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
