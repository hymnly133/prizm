import { Button, Flexbox, Input } from '@lobehub/ui'
import { memo, useState } from 'react'
import { useLogsContext } from '../context/LogsContext'
import { usePrizmContext, useSyncEventContext } from '../context/PrizmContext'
import { useScope } from '../hooks/useScope'
import type { EventType } from '@prizm/client-core'
import { setLastSyncEvent } from '../events/syncEventStore'

function TestPage() {
  const { manager } = usePrizmContext()
  const { currentScope } = useScope()
  const { lastSyncEvent } = useSyncEventContext()
  const { addLog } = useLogsContext()

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

  function sendLocalNotif() {
    if (!localNotif.title.trim()) return
    window.prizm.showNotification({
      title: localNotif.title.trim(),
      body: localNotif.body.trim() || undefined
    })
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
      addLog('已发送服务器通知', 'success')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setServerNotifResult({ ok: false, msg })
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
      addLog('已添加 TODO 项', 'success')
    } catch (e) {
      setMockResult({
        ok: false,
        msg: e instanceof Error ? e.message : String(e)
      })
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
      addLog('已添加测试剪贴板', 'success')
    } catch (e) {
      setMockResult({
        ok: false,
        msg: e instanceof Error ? e.message : String(e)
      })
      addLog(`添加剪贴板失败: ${String(e)}`, 'error')
    }
  }

  function triggerRefresh(eventType: EventType) {
    setLastSyncEvent(eventType)
    addLog(`已触发刷新: ${eventType}`, 'info')
  }

  const inputProps = {
    variant: 'filled' as const,
    className: 'test-input'
  }

  return (
    <section className="page settings-page">
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
    </section>
  )
}

export default memo(TestPage)
