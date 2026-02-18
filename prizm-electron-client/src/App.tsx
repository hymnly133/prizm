import { ActionIcon, Icon } from '@lobehub/ui'
import { Segmented } from './components/ui/Segmented'
import { App as AntdApp, Modal } from 'antd'
import type { NotificationPayload } from '@prizm/client-core'
import type { LucideIcon } from 'lucide-react'
import {
  Bot,
  Columns2,
  FileText,
  FlaskConical,
  Gem,
  Home,
  LayoutDashboard,
  ScrollText,
  Settings,
  User
} from 'lucide-react'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ClientSettingsProvider } from './context/ClientSettingsContext'
import { LogsProvider, useLogsContext } from './context/LogsContext'
import { PrizmProvider, usePrizmContext, SyncEventProvider } from './context/PrizmContext'
import { ScopeProvider } from './context/ScopeContext'
import { NavigationProvider } from './context/NavigationContext'
import { ImportProvider } from './context/ImportContext'
import { HeaderSlotsProvider } from './context/HeaderSlotsContext'
import DropZoneOverlay from './components/import/DropZoneOverlay'
import ImportConfirmModal from './components/import/ImportConfirmModal'
import { setLastSyncEvent } from './events/syncEventStore'
import {
  useAgentSending,
  useAgentPendingInteract,
  useFirstPendingInteract
} from './events/agentBackgroundStore'
import { AppHeader } from './components/layout'
import ScopeSwitcher from './components/ui/ScopeSwitcher'
import { LogsDrawer } from './components/LogsDrawer'
import { CommandPalette } from './components/CommandPalette'
import { useHashRoute } from './hooks/useHashRoute'
import { useScopeDataBinding } from './hooks/useScopeDataBinding'
import { QuickActionHandler } from './components/QuickActionHandler'
import AgentPage from './views/AgentPage'
import DocumentEditorPage from './views/DocumentEditorPage'
import HomePage from './views/HomePage'
import SettingsPage from './views/SettingsPage'
import DevToolsPage from './views/DevToolsPage'
import UserPage from './views/UserPage'
import WorkPage from './views/WorkPage'
import CollaborationPage from './views/CollaborationPage'

type PageKey = 'home' | 'work' | 'docs' | 'agent' | 'collaboration' | 'user' | 'settings' | 'test'

const STATUS_LABELS: Record<'connected' | 'disconnected' | 'connecting' | 'error', string> = {
  connected: '已连接',
  disconnected: '断开',
  connecting: '连接中',
  error: '错误'
}

const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: LucideIcon }> = [
  { key: 'home', label: '主页', icon: Home },
  { key: 'work', label: '工作', icon: LayoutDashboard },
  { key: 'docs', label: '文档', icon: FileText },
  { key: 'agent', label: 'Agent', icon: Bot },
  { key: 'collaboration', label: '协作', icon: Columns2 },
  { key: 'user', label: '用户', icon: User }
]

function AppContent() {
  const { status, loadConfig, initializePrizm, disconnect } = usePrizmContext()
  const { addLog } = useLogsContext()
  const [activePage, setActivePage] = useState<PageKey>('home')
  /** 文档编辑页 dirty 状态引用（由 DocumentEditorPage 中的 DocumentEditorView 设置） */
  const docsDirtyRef = useRef(false)

  const [logsDrawerOpen, setLogsDrawerOpen] = useState(false)

  /** Ref: 在回调中读取 activePage 最新值，避免回调依赖 activePage 导致级联重建 */
  const activePageRef = useRef(activePage)
  activePageRef.current = activePage

  useHashRoute(activePage, setActivePage)
  useScopeDataBinding()

  /**
   * Stable: 带离开保护的页面切换 — 通过 ref 读取当前页，回调引用永久稳定。
   * 不使用 startTransition，因为级联重渲染已被根治（稳定回调 + memoized context），
   * 而 startTransition 会让 React 将此更新标记为非紧急，被 Segmented 动画延迟。
   */
  const collabDocDirtyRef = useRef(false)

  const setActivePageSafe = useCallback((next: PageKey) => {
    const cur = activePageRef.current
    const hasDirtyDoc =
      (cur === 'docs' && docsDirtyRef.current) ||
      (cur === 'collaboration' && collabDocDirtyRef.current)
    if (hasDirtyDoc && next !== cur) {
      Modal.confirm({
        title: '未保存的更改',
        content: '文档中有未保存的更改，确定离开吗？',
        okText: '离开',
        cancelText: '继续编辑',
        onOk: () => setActivePage(next)
      })
    } else {
      setActivePage(next)
    }
  }, [])

  /** Stable: 导航回调均不再因 activePage 变化而重建 */
  const navigateToWork = useCallback(() => setActivePageSafe('work'), [setActivePageSafe])
  const navigateToDocs = useCallback(() => setActivePageSafe('docs'), [setActivePageSafe])
  const navigateToAgent = useCallback(() => setActivePageSafe('agent'), [setActivePageSafe])
  const navigateToUser = useCallback(() => setActivePageSafe('user'), [setActivePageSafe])

  /** 懒挂载 + 空闲预加载：首屏只挂载 home，之后空闲时预挂载高频页面 */
  const mountedPagesRef = useRef(new Set<PageKey>(['home']))
  mountedPagesRef.current.add(activePage)
  const [, preloadTick] = useState(0)
  useEffect(() => {
    const PRELOAD_PAGES: PageKey[] = ['work', 'docs', 'agent', 'collaboration']
    const schedule = () => {
      let added = false
      for (const p of PRELOAD_PAGES) {
        if (!mountedPagesRef.current.has(p)) {
          mountedPagesRef.current.add(p)
          added = true
        }
      }
      if (added) preloadTick((n) => n + 1)
    }
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(schedule, { timeout: 3000 })
      return () => window.cancelIdleCallback(id)
    }
    const timer = setTimeout(schedule, 2000)
    return () => clearTimeout(timer)
  }, [])
  const mounted = mountedPagesRef.current
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

  /** Stable: Segmented onChange 回调，避免每次渲染创建新引用 */
  const onSegmentedChange = useCallback(
    (v: string | number) => setActivePageSafe(v as PageKey),
    [setActivePageSafe]
  )

  return (
    <HeaderSlotsProvider activePage={activePage}>
      <div className="app-layout-wrap">
        <AppHeader
          logo={
            <>
              <Icon icon={Gem} size={18} style={{ color: 'var(--ant-color-primary)' }} />
              <span className="app-brand-name">
                <span className="app-brand-accent">P</span>rizm
              </span>
              <span className={`status-dot status-dot--${status}`} title={STATUS_LABELS[status]} />
              <ScopeSwitcher />
            </>
          }
          nav={
            <Segmented
              size="small"
              value={segmentedValue}
              onChange={onSegmentedChange}
              options={navOptions}
            />
          }
          actions={
            <>
              <ActionIcon
                icon={ScrollText}
                size="small"
                title="日志"
                onClick={() => setLogsDrawerOpen(true)}
              />
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
                title="开发者工具"
                active={activePage === 'test'}
                onClick={() => setActivePageSafe('test')}
              />
            </>
          }
        />
        <NavigationProvider
          onNavigateToWork={navigateToWork}
          onNavigateToDocs={navigateToDocs}
          onNavigateToAgent={navigateToAgent}
        >
          <ImportProvider>
            <DropZoneOverlay />
            <ImportConfirmModal />
            <QuickActionHandler setActivePage={setActivePage} />
            {/* 懒挂载 keep-alive：首次访问才挂载，之后通过 CSS 隐藏保留状态 */}
            <SyncEventProvider>
              <div className="app-main">
                {mounted.has('home') && (
                  <div
                    className={`page-keep-alive${
                      activePage !== 'home' ? ' page-keep-alive--hidden' : ''
                    }`}
                  >
                    <HomePage
                      onNavigateToAgent={navigateToAgent}
                      onNavigateToWork={navigateToWork}
                      onNavigateToUser={navigateToUser}
                    />
                  </div>
                )}
                {mounted.has('work') && (
                  <div
                    className={`page-keep-alive${
                      activePage !== 'work' ? ' page-keep-alive--hidden' : ''
                    }`}
                  >
                    <WorkPage />
                  </div>
                )}
                {mounted.has('docs') && (
                  <div
                    className={`page-keep-alive${
                      activePage !== 'docs' ? ' page-keep-alive--hidden' : ''
                    }`}
                  >
                    <DocumentEditorPage dirtyRef={docsDirtyRef} onBack={navigateToWork} />
                  </div>
                )}
                {mounted.has('agent') && (
                  <div
                    className={`page-keep-alive${
                      activePage !== 'agent' ? ' page-keep-alive--hidden' : ''
                    }`}
                  >
                    <AgentPage />
                  </div>
                )}
                {mounted.has('collaboration') && (
                  <div
                    className={`page-keep-alive${
                      activePage !== 'collaboration' ? ' page-keep-alive--hidden' : ''
                    }`}
                  >
                    <CollaborationPage
                      onNavigateToAgent={navigateToAgent}
                      onNavigateToDocs={navigateToDocs}
                    />
                  </div>
                )}
                {mounted.has('user') && (
                  <div
                    className={`page-keep-alive${
                      activePage !== 'user' ? ' page-keep-alive--hidden' : ''
                    }`}
                  >
                    <UserPage />
                  </div>
                )}
                {mounted.has('settings') && (
                  <div
                    className={`page-keep-alive${
                      activePage !== 'settings' ? ' page-keep-alive--hidden' : ''
                    }`}
                  >
                    <SettingsPage />
                  </div>
                )}
                {mounted.has('test') && (
                  <div
                    className={`page-keep-alive${
                      activePage !== 'test' ? ' page-keep-alive--hidden' : ''
                    }`}
                  >
                    <DevToolsPage />
                  </div>
                )}
              </div>
            </SyncEventProvider>
          </ImportProvider>
        </NavigationProvider>
        <LogsDrawer open={logsDrawerOpen} onClose={() => setLogsDrawerOpen(false)} />
        <CommandPalette
          onNavigate={(page) => setActivePageSafe(page as PageKey)}
          onNewChat={() => {
            setActivePageSafe('agent')
          }}
          onOpenLogs={() => setLogsDrawerOpen(true)}
        />
      </div>
    </HeaderSlotsProvider>
  )
}

export default function App() {
  return (
    <LogsProvider>
      <PrizmProvider>
        <ClientSettingsProvider>
          <ScopeProvider>
            <AppContent />
          </ScopeProvider>
        </ClientSettingsProvider>
      </PrizmProvider>
    </LogsProvider>
  )
}
