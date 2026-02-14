import { Button, Tag } from '@lobehub/ui'
import type { NotificationPayload } from '@prizm/client-core'
import { useState, useEffect } from 'react'
import { LogsProvider, useLogsContext } from './context/LogsContext'
import { PrizmProvider, usePrizmContext, SyncEventProvider } from './context/PrizmContext'
import { setLastSyncEvent } from './events/syncEventStore'
import { AppHeader } from './components/layout'
import AgentPage from './views/AgentPage'
import SettingsPage from './views/SettingsPage'
import TestPage from './views/TestPage'
import UserPage from './views/UserPage'
import WorkPage from './views/WorkPage'

const STATUS_LABELS: Record<'connected' | 'disconnected' | 'connecting' | 'error', string> = {
  connected: '已连接',
  disconnected: '断开',
  connecting: '连接中',
  error: '错误'
}

function AppContent() {
  const { status, loadConfig, initializePrizm, disconnect } = usePrizmContext()
  const { addLog } = useLogsContext()
  const [activePage, setActivePage] = useState<'work' | 'settings' | 'test' | 'agent' | 'user'>(
    'work'
  )

  useEffect(() => {
    addLog('Prizm Electron 通知客户端启动', 'info')
    const unsubscribeClipboard = window.prizm.onClipboardItemAdded(() => {
      setLastSyncEvent('clipboard:itemAdded')
    })

    async function init() {
      const cfg = await loadConfig()
      if (!cfg) {
        addLog('请先配置服务器并注册客户端', 'warning')
        setActivePage('settings')
        return
      }
      if (!cfg.api_key?.length) {
        addLog('需要注册客户端获取 API Key', 'warning')
        setActivePage('settings')
        return
      }
      await initializePrizm(cfg, {
        onLog: addLog,
        onNotify: (p: NotificationPayload) => addLog(`通知: ${p.title}`, 'info')
      })
    }

    void init()

    return () => {
      unsubscribeClipboard?.()
      disconnect()
    }
  }, [addLog, loadConfig, initializePrizm, disconnect])

  const statusColor =
    status === 'connected'
      ? 'green'
      : status === 'connecting'
      ? 'blue'
      : status === 'disconnected'
      ? 'gold'
      : 'red'

  return (
    <div className="app-layout-wrap">
      <AppHeader
        brand={
          <>
            <Tag color={statusColor} size="small">
              {STATUS_LABELS[status]}
            </Tag>
            <h1>Prizm</h1>
          </>
        }
        nav={
          <>
            <Button
              type={activePage === 'work' ? 'primary' : 'default'}
              onClick={() => setActivePage('work')}
            >
              工作
            </Button>
            <Button
              type={activePage === 'agent' ? 'primary' : 'default'}
              onClick={() => setActivePage('agent')}
            >
              Agent
            </Button>
            <Button
              type={activePage === 'user' ? 'primary' : 'default'}
              onClick={() => setActivePage('user')}
            >
              用户
            </Button>
            <Button
              type={activePage === 'settings' ? 'primary' : 'default'}
              onClick={() => setActivePage('settings')}
            >
              设置
            </Button>
            <Button
              type={activePage === 'test' ? 'primary' : 'default'}
              onClick={() => setActivePage('test')}
            >
              测试
            </Button>
          </>
        }
      />
      <div className="app-main">
        {activePage === 'work' && <WorkPage />}
        {activePage === 'agent' && (
          <SyncEventProvider>
            <AgentPage />
          </SyncEventProvider>
        )}
        {activePage === 'user' && <UserPage />}
        {activePage === 'settings' && <SettingsPage />}
        {activePage === 'test' && (
          <SyncEventProvider>
            <TestPage />
          </SyncEventProvider>
        )}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <LogsProvider>
      <PrizmProvider>
        <AppContent />
      </PrizmProvider>
    </LogsProvider>
  )
}
