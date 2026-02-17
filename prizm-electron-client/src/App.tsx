import { ActionIcon, Icon, Segmented } from '@lobehub/ui'
import { App as AntdApp, Modal } from 'antd'
import type { NotificationPayload } from '@prizm/client-core'
import type { LucideIcon } from 'lucide-react'
import {
  Bot,
  BookOpen,
  FlaskConical,
  Gem,
  Home,
  LayoutDashboard,
  Settings,
  User
} from 'lucide-react'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ClientSettingsProvider } from './context/ClientSettingsContext'
import { LogsProvider, useLogsContext } from './context/LogsContext'
import { PrizmProvider, usePrizmContext, SyncEventProvider } from './context/PrizmContext'
import { WorkNavigationProvider } from './context/WorkNavigationContext'
import { DocumentNavigationProvider } from './context/DocumentNavigationContext'
import { ChatWithFileProvider } from './context/ChatWithFileContext'
import { ImportProvider } from './context/ImportContext'
import DropZoneOverlay from './components/import/DropZoneOverlay'
import ImportConfirmModal from './components/import/ImportConfirmModal'
import { setLastSyncEvent } from './events/syncEventStore'
import {
  useAgentSending,
  useAgentPendingInteract,
  useFirstPendingInteract
} from './events/agentBackgroundStore'
import { AppHeader } from './components/layout'
import { QuickActionHandler } from './components/QuickActionHandler'
import AgentPage from './views/AgentPage'
import HomePage from './views/HomePage'
import SettingsPage from './views/SettingsPage'
import TestPage from './views/TestPage'
import UserPage from './views/UserPage'
import WorkPage from './views/WorkPage'
import DocumentPage from './views/DocumentPage'

type PageKey = 'home' | 'work' | 'docs' | 'agent' | 'user' | 'settings' | 'test'

const STATUS_LABELS: Record<'connected' | 'disconnected' | 'connecting' | 'error', string> = {
  connected: '已连接',
  disconnected: '断开',
  connecting: '连接中',
  error: '错误'
}

const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: LucideIcon }> = [
  { key: 'home', label: '主页', icon: Home },
  { key: 'work', label: '工作', icon: LayoutDashboard },
  { key: 'docs', label: '知识库', icon: BookOpen },
  { key: 'agent', label: 'Agent', icon: Bot },
  { key: 'user', label: '用户', icon: User }
]

function AppContent() {
  const { status, loadConfig, initializePrizm, disconnect } = usePrizmContext()
  const { addLog } = useLogsContext()
  const [activePage, setActivePage] = useState<PageKey>('home')
  /** 文档页 dirty 状态引用（由 DocumentPage 设置） */
  const docDirtyRef = useRef(false)

  /** 带离开保护的 setActivePage */
  const setActivePageSafe = useCallback(
    (next: PageKey) => {
      if (activePage === 'docs' && docDirtyRef.current && next !== 'docs') {
        Modal.confirm({
          title: '未保存的更改',
          content: '知识库中有未保存的更改，确定离开吗？',
          okText: '离开',
          cancelText: '继续编辑',
          onOk: () => setActivePage(next)
        })
      } else {
        setActivePage(next)
      }
    },
    [activePage]
  )

  const navigateToWork = useCallback(() => setActivePageSafe('work'), [setActivePageSafe])
  const navigateToDocs = useCallback(() => setActivePage('docs'), [])
  const navigateToAgent = useCallback(() => setActivePageSafe('agent'), [setActivePageSafe])
  const agentSending = useAgentSending()
  const agentPendingInteract = useAgentPendingInteract()
  const firstPendingInteract = useFirstPendingInteract()
  const { notification } = AntdApp.useApp()
  /** 用于去重通知：记录上一次弹出通知的 requestId，同一请求不重复弹出 */
  const lastNotifiedRequestId = useRef<string | null>(null)

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

  // --- Agent 交互通知：待交互请求变化时弹出应用内通知 ---
  useEffect(() => {
    if (!firstPendingInteract) {
      lastNotifiedRequestId.current = null
      return
    }
    const { interact } = firstPendingInteract
    if (interact.requestId === lastNotifiedRequestId.current) return
    lastNotifiedRequestId.current = interact.requestId

    const pathsPreview =
      interact.paths.length > 2
        ? `${interact.paths.slice(0, 2).join(', ')} 等 ${interact.paths.length} 个路径`
        : interact.paths.join(', ')

    notification.warning({
      key: `interact-${interact.requestId}`,
      message: 'Agent 需要您的确认',
      description: `工具 ${interact.toolName} 需要访问: ${pathsPreview}`,
      placement: 'topRight',
      duration: 0,
      onClick: () => {
        setActivePage('agent')
        notification.destroy(`interact-${interact.requestId}`)
      }
    })
  }, [firstPendingInteract, notification, setActivePage])

  /** Segmented 导航选项（带图标 + Agent 后台指示器 + 交互警告指示器）
   *  依赖 agentSending + agentPendingInteract */
  const navOptions = useMemo(
    () =>
      NAV_ITEMS.map((item) => ({
        label: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Icon icon={item.icon} size={14} />
            {item.label}
            {item.key === 'agent' && agentSending && !agentPendingInteract && (
              <span className="agent-bg-indicator" />
            )}
            {item.key === 'agent' && agentPendingInteract && (
              <span className="agent-interact-indicator" title="需要确认" />
            )}
          </span>
        ),
        value: item.key
      })),
    [agentSending, agentPendingInteract]
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
            onChange={(v) => setActivePageSafe(v as PageKey)}
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
              onClick={() => setActivePageSafe('settings')}
            />
            <ActionIcon
              icon={FlaskConical}
              size="small"
              title="测试"
              active={activePage === 'test'}
              onClick={() => setActivePageSafe('test')}
            />
          </>
        }
      />
      <WorkNavigationProvider onNavigateToWork={navigateToWork}>
        <DocumentNavigationProvider onNavigateToDocs={navigateToDocs}>
          <ChatWithFileProvider onNavigateToAgent={navigateToAgent}>
            <ImportProvider>
              <DropZoneOverlay />
              <ImportConfirmModal />
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
                <div
                  className={`page-keep-alive${
                    activePage !== 'docs' ? ' page-keep-alive--hidden' : ''
                  }`}
                >
                  <DocumentPage dirtyRef={docDirtyRef} />
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
            </ImportProvider>
          </ChatWithFileProvider>
        </DocumentNavigationProvider>
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
