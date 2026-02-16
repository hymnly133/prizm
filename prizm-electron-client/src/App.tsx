import { ActionIcon, Icon, Segmented } from '@lobehub/ui'
import type { NotificationPayload } from '@prizm/client-core'
import type { LucideIcon } from 'lucide-react'
import { Bot, FlaskConical, Gem, Home, LayoutDashboard, Settings, User } from 'lucide-react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { ClientSettingsProvider } from './context/ClientSettingsContext'
import { LogsProvider, useLogsContext } from './context/LogsContext'
import { PrizmProvider, usePrizmContext, SyncEventProvider } from './context/PrizmContext'
import { WorkNavigationProvider } from './context/WorkNavigationContext'
import { ChatWithFileProvider } from './context/ChatWithFileContext'
import { setLastSyncEvent } from './events/syncEventStore'
import { useAgentSending } from './events/agentBackgroundStore'
import { AppHeader } from './components/layout'
import { QuickActionHandler } from './components/QuickActionHandler'
import AgentPage from './views/AgentPage'
import HomePage from './views/HomePage'
import SettingsPage from './views/SettingsPage'
import TestPage from './views/TestPage'
import UserPage from './views/UserPage'
import WorkPage from './views/WorkPage'

type PageKey = 'home' | 'work' | 'agent' | 'user' | 'settings' | 'test'

const STATUS_LABELS: Record<'connected' | 'disconnected' | 'connecting' | 'error', string> = {
  connected: '已连接',
  disconnected: '断开',
  connecting: '连接中',
  error: '错误'
}

const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: LucideIcon }> = [
  { key: 'home', label: '主页', icon: Home },
  { key: 'work', label: '工作', icon: LayoutDashboard },
  { key: 'agent', label: 'Agent', icon: Bot },
  { key: 'user', label: '用户', icon: User }
]

function AppContent() {
  const { status, loadConfig, initializePrizm, disconnect } = usePrizmContext()
  const { addLog } = useLogsContext()
  const [activePage, setActivePage] = useState<PageKey>('home')
  const navigateToWork = useCallback(() => setActivePage('work'), [])
  const navigateToAgent = useCallback(() => setActivePage('agent'), [])
  const agentSending = useAgentSending()

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

  /** Segmented 导航选项（带图标 + Agent 后台指示器）
   *  仅依赖 agentSending，不依赖 activePage，避免每次切页重建 JSX 导致 Segmented 重渲染 */
  const navOptions = useMemo(
    () =>
      NAV_ITEMS.map((item) => ({
        label: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Icon icon={item.icon} size={14} />
            {item.label}
            {item.key === 'agent' && agentSending && <span className="agent-bg-indicator" />}
          </span>
        ),
        value: item.key
      })),
    [agentSending]
  )

  /** Segmented value：仅在主导航页时高亮，设置/测试页不匹配任何选项 */
  const segmentedValue = NAV_ITEMS.some((i) => i.key === activePage) ? activePage : ''

  return (
    <div className="app-layout-wrap">
      <AppHeader
        logo={
          <>
            <Icon icon={Gem} size={18} style={{ color: 'var(--ant-color-primary)' }} />
            <span className="app-brand-name">Prizm</span>
            <span className={`status-dot status-dot--${status}`} title={STATUS_LABELS[status]} />
          </>
        }
        nav={
          <Segmented
            size="small"
            value={segmentedValue}
            onChange={(v) => setActivePage(v as PageKey)}
            options={navOptions}
          />
        }
        actions={
          <>
            <ActionIcon
              icon={Settings}
              size="small"
              title="设置"
              active={activePage === 'settings'}
              onClick={() => setActivePage('settings')}
            />
            <ActionIcon
              icon={FlaskConical}
              size="small"
              title="测试"
              active={activePage === 'test'}
              onClick={() => setActivePage('test')}
            />
          </>
        }
      />
      <WorkNavigationProvider onNavigateToWork={navigateToWork}>
        <ChatWithFileProvider onNavigateToAgent={navigateToAgent}>
          <QuickActionHandler setActivePage={setActivePage} />
          {/* 所有页面始终挂载（keep-alive），通过 CSS display:none 隐藏非活跃页面 */}
          <div className="app-main">
            <div
              className={`page-keep-alive${
                activePage !== 'home' ? ' page-keep-alive--hidden' : ''
              }`}
            >
              <HomePage onNavigateToAgent={navigateToAgent} onNavigateToWork={navigateToWork} />
            </div>
            <div
              className={`page-keep-alive${
                activePage !== 'work' ? ' page-keep-alive--hidden' : ''
              }`}
            >
              <WorkPage />
            </div>
            <SyncEventProvider>
              <div
                className={`page-keep-alive${
                  activePage !== 'agent' ? ' page-keep-alive--hidden' : ''
                }`}
              >
                <AgentPage />
              </div>
            </SyncEventProvider>
            <div
              className={`page-keep-alive${
                activePage !== 'user' ? ' page-keep-alive--hidden' : ''
              }`}
            >
              <UserPage />
            </div>
            <div
              className={`page-keep-alive${
                activePage !== 'settings' ? ' page-keep-alive--hidden' : ''
              }`}
            >
              <SettingsPage />
            </div>
            <SyncEventProvider>
              <div
                className={`page-keep-alive${
                  activePage !== 'test' ? ' page-keep-alive--hidden' : ''
                }`}
              >
                <TestPage />
              </div>
            </SyncEventProvider>
          </div>
        </ChatWithFileProvider>
      </WorkNavigationProvider>
    </div>
  )
}

export default function App() {
  return (
    <LogsProvider>
      <PrizmProvider>
        <ClientSettingsProvider>
          <AppContent />
        </ClientSettingsProvider>
      </PrizmProvider>
    </LogsProvider>
  )
}
