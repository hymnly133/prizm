/**
 * HomePage (Dashboard) — 统一仪表盘
 *
 * HomeHero 头部（问候 + 身份 + 内联 Tabs + Quick Actions），
 * 每个 tab 面板独立滚动（CSS display:none keep-alive）。
 */
import { useMemo, useCallback, useState, useRef, memo } from 'react'
import { Button, Icon, Tag, toast } from '@lobehub/ui'
import { AccentSpotlightCard } from '../components/ui/AccentSpotlightCard'
import { useTheme } from 'antd-style'
import {
  Activity,
  ArrowRight,
  Brain,
  Clipboard,
  Coins,
  Copy,
  Eye,
  FileText,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  User as UserIcon
} from 'lucide-react'
import { usePrizmContext } from '../context/PrizmContext'
import { useHomeData } from '../hooks/useHomeData'
import { useWorkNavigation } from '../context/WorkNavigationContext'
import { useChatWithFile } from '../context/ChatWithFileContext'
import { useImportContext } from '../context/ImportContext'
import { SectionHeader } from '../components/ui/SectionHeader'
import { LoadingPlaceholder } from '../components/ui/LoadingPlaceholder'
import { EmptyState } from '../components/ui/EmptyState'
import { HomeHero } from '../components/home/HomeHero'
import { MemoryDashboard } from '../components/home/MemoryDashboard'
import { TokenUsagePanel } from '../components/agent/TokenUsagePanel'
import { ActivityTimeline } from '../components/ActivityTimeline'
import { formatRelativeTime } from '../utils/formatRelativeTime'
import HomeStatsSection, { type StatItem } from './HomeStatsSection'
import RecentSessionsSection from './RecentSessionsSection'
import HomeTodoSection, { type TodoListGroup } from './HomeTodoSection'
import type { TodoList, Document as PrizmDocument } from '@prizm/client-core'
import { isChatListSession } from '@prizm/shared'
import type { FileItem } from '../hooks/useFileList'

type DashboardTab = 'overview' | 'usage' | 'memory'

const DASHBOARD_TABS = [
  { label: '总览', value: 'overview' as const },
  { label: '用量', value: 'usage' as const },
  { label: '记忆', value: 'memory' as const }
]

const TAB_STORAGE_KEY = 'prizm-dashboard-tab'

function loadTab(): DashboardTab {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY)
    if (v === 'usage' || v === 'memory') return v
  } catch { /* ignore */ }
  return 'overview'
}

function stripMarkdown(text: string): string {
  return text.replace(/[#*_~`>|[\]()!-]/g, '').replace(/\n+/g, ' ').trim()
}

/* ── 主组件 ── */
function HomePage({
  onNavigateToAgent,
  onNavigateToWork
}: {
  onNavigateToAgent: () => void
  onNavigateToWork: () => void
}) {
  const { manager } = usePrizmContext()
  const data = useHomeData()
  const { openFileAtWork } = useWorkNavigation()
  const { chatWith } = useChatWithFile()
  const { startImportFromFileDialog } = useImportContext()
  const theme = useTheme()
  const [activeTab, setActiveTab] = useState<DashboardTab>(loadTab)
  const mountedTabs = useRef(new Set<DashboardTab>(['overview']))

  if (!mountedTabs.current.has(activeTab)) {
    mountedTabs.current.add(activeTab)
  }

  const handleTabChange = useCallback((val: string | number) => {
    const t = val as DashboardTab
    setActiveTab(t)
    try { localStorage.setItem(TAB_STORAGE_KEY, t) } catch { /* ignore */ }
  }, [])

  /* ── 数据处理 ── */
  const recentSessions = useMemo(() => {
    return [...data.sessions]
      .filter((s) => isChatListSession(s))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5)
  }, [data.sessions])

  const todoLists = useMemo<TodoListGroup[]>(() => {
    const todoFiles = data.fileList.filter((f) => f.kind === 'todoList')
    const lists: TodoListGroup[] = []
    for (const file of todoFiles) {
      const list = file.raw as TodoList
      const activeItems = list.items
        .filter((item) => item.status === 'todo' || item.status === 'doing')
        .sort((a, b) => {
          if (a.status === 'doing' && b.status !== 'doing') return -1
          if (b.status === 'doing' && a.status !== 'doing') return 1
          return b.updatedAt - a.updatedAt
        })
        .slice(0, 4)
      if (activeItems.length > 0) lists.push({ list, activeItems })
    }
    lists.sort((a, b) => b.list.updatedAt - a.list.updatedAt)
    return lists.slice(0, 3)
  }, [data.fileList])

  const recentDocuments = useMemo(() => {
    return data.fileList.filter((f) => f.kind === 'document').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4)
  }, [data.fileList])

  const bt = data.stats.memoryByType
  const statItems = useMemo<StatItem[]>(
    () => [
      { icon: <MessageSquare size={20} />, label: '会话', value: data.statsLoading ? '...' : String(data.stats.sessionsCount), color: theme.colorInfo, onClick: onNavigateToAgent },
      { icon: <FileText size={20} />, label: '文档', value: data.statsLoading ? '...' : String(data.stats.documentsCount), color: theme.colorSuccess, onClick: onNavigateToWork },
      { icon: <UserIcon size={20} />, label: '画像', value: data.statsLoading ? '...' : String(bt.profile), color: theme.colorWarning, description: 'profile' },
      { icon: <Sparkles size={20} />, label: '叙事', value: data.statsLoading ? '...' : String(bt.narrative), color: theme.geekblue, description: 'narrative' },
      { icon: <Eye size={20} />, label: '前瞻', value: data.statsLoading ? '...' : String(bt.foresight), color: theme.cyan, description: 'foresight' },
      { icon: <Brain size={20} />, label: '文档记忆', value: data.statsLoading ? '...' : String(bt.document), color: theme.colorSuccess, description: 'document' },
      { icon: <Activity size={20} />, label: '事件日志', value: data.statsLoading ? '...' : String(bt.event_log), color: theme.magenta, description: 'event_log' }
    ],
    [data.statsLoading, data.stats, bt, theme, onNavigateToAgent, onNavigateToWork]
  )

  /* ── 操作回调 ── */
  const handleNewChat = useCallback(() => { chatWith({ text: '' }); onNavigateToAgent() }, [chatWith, onNavigateToAgent])
  const handleOpenSession = useCallback((id: string) => { chatWith({ sessionId: id }); onNavigateToAgent() }, [chatWith, onNavigateToAgent])
  const handleOpenDocument = useCallback((file: FileItem) => { openFileAtWork(file.kind, file.id); onNavigateToWork() }, [openFileAtWork, onNavigateToWork])
  const handleNewDocument = useCallback(async () => {
    const http = manager?.getHttpClient()
    if (!http) return
    try { const doc = await http.createDocument({ title: '新文档' }, data.currentScope); openFileAtWork('document', doc.id); onNavigateToWork() }
    catch { toast.error('创建文档失败') }
  }, [manager, data.currentScope, openFileAtWork, onNavigateToWork])
  const handleOpenTodoList = useCallback((id: string) => { openFileAtWork('todoList', id); onNavigateToWork() }, [openFileAtWork, onNavigateToWork])
  const handleCopyClipboardItem = useCallback((content: string) => { void navigator.clipboard.writeText(content).then(() => toast.success('已复制')) }, [])

  const renderDocItem = useCallback((file: FileItem) => {
    const doc = file.raw as PrizmDocument
    const raw = (doc.content ?? '').slice(0, 200)
    const stripped = stripMarkdown(raw)
    const preview = stripped.length > 80 ? stripped.slice(0, 80) + '...' : stripped || '(空)'
    return (
      <div className="home-doc-card" role="button" tabIndex={0} onClick={() => handleOpenDocument(file)} onKeyDown={(e) => e.key === 'Enter' && handleOpenDocument(file)}>
        <div className="home-doc-card__icon"><FileText size={16} /></div>
        <h4 className="home-doc-card__title">{doc.title || '无标题'}</h4>
        <p className="home-doc-card__preview">{preview}</p>
        <span className="home-doc-card__time">{formatRelativeTime(file.updatedAt)}</span>
      </div>
    )
  }, [handleOpenDocument])

  return (
    <div className="home-page">
      {/* ── Hero 头部（问候 + 身份 + Tabs + Quick Actions） ── */}
      <HomeHero
        activeTab={activeTab}
        onTabChange={handleTabChange}
        tabOptions={DASHBOARD_TABS}
        onNewChat={handleNewChat}
        onNavigateToWork={onNavigateToWork}
        onImport={() => void startImportFromFileDialog()}
      />

      {/* ── 总览 ── */}
      <div className="dashboard-tab-pane" style={activeTab !== 'overview' ? { display: 'none' } : undefined}>
        <HomeStatsSection items={statItems} animationIndex={0} />
        <div className="home-grid">
          <RecentSessionsSection sessions={recentSessions} sessionsLoading={data.sessionsLoading} sessionsCount={data.stats.sessionsCount} onNewChat={handleNewChat} onOpenSession={handleOpenSession} onViewAll={onNavigateToAgent} animationIndex={1} />
          <HomeTodoSection todoLists={todoLists} loading={data.fileListLoading} onOpenTodoList={handleOpenTodoList} onViewAll={onNavigateToWork} animationIndex={2} />
        </div>
        <div>
          <SectionHeader icon={FileText} title="最近文档" count={data.stats.documentsCount} extra={<><Button size="small" icon={<Icon icon={Plus} size="small" />} onClick={handleNewDocument}>新建</Button><Button size="small" type="text" icon={<Icon icon={ArrowRight} size="small" />} iconPlacement="end" onClick={onNavigateToWork}>查看全部</Button></>} />
          {data.fileListLoading ? <LoadingPlaceholder /> : recentDocuments.length === 0 ? (
            <EmptyState icon={FileText} description="暂无文档" actions={<Button icon={<Icon icon={Plus} size="small" />} onClick={handleNewDocument}>新建文档</Button>} />
          ) : (
            <AccentSpotlightCard items={recentDocuments} renderItem={renderDocItem} columns={recentDocuments.length >= 3 ? 3 : recentDocuments.length} gap="12px" size={600} borderRadius={12} className="home-spotlight-docs" />
          )}
        </div>
        {data.clipboard.length > 0 && (
          <div className="home-clipboard-strip">
            <div className="home-clipboard-strip__header">
              <Icon icon={Clipboard} size="small" />
              <span className="home-card__title">最近剪贴板</span>
              <span className="section-header__extra"><Button size="small" type="text" icon={<Icon icon={ArrowRight} size="small" />} iconPlacement="end" onClick={onNavigateToWork}>查看全部</Button></span>
            </div>
            <div className="home-clipboard-strip__items">
              {data.clipboard.map((item) => (
                <div key={item.id} className="home-clipboard-item home-clipboard-item--clickable" title="点击复制到剪贴板" role="button" tabIndex={0} onClick={() => handleCopyClipboardItem(item.content)} onKeyDown={(e) => e.key === 'Enter' && handleCopyClipboardItem(item.content)}>
                  <span className="home-clipboard-item__text">{item.content.length > 80 ? item.content.slice(0, 80) + '...' : item.content}</span>
                  <div className="home-clipboard-item__footer">
                    <span className="home-clipboard-item__time">{formatRelativeTime(item.createdAt)}</span>
                    <Icon icon={Copy} size={12} className="home-clipboard-item__copy-icon" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── 用量 ── */}
      {mountedTabs.current.has('usage') && (
        <div className="dashboard-tab-pane" style={activeTab !== 'usage' ? { display: 'none' } : undefined}>
          <div className="content-card content-card--default content-card--hoverable">
            <SectionHeader icon={Coins} title="Token 用量" className="content-card__header" />
            <div className="content-card__body"><TokenUsagePanel /></div>
          </div>
          <div className="content-card content-card--default content-card--hoverable">
            <SectionHeader icon={Activity} title="活动时间线" className="content-card__header" />
            <div className="content-card__body"><ActivityTimeline /></div>
          </div>
        </div>
      )}

      {/* ── 记忆 ── */}
      {mountedTabs.current.has('memory') && (
        <div className="dashboard-tab-pane" style={activeTab !== 'memory' ? { display: 'none' } : undefined}>
          <MemoryDashboard visible={activeTab === 'memory'} />
        </div>
      )}
    </div>
  )
}

export default memo(HomePage)
