/**
 * HomePage - 主页：问候语、快捷操作、最近对话、统计概览、待办列表、文档、剪贴板
 * 现代 Dashboard 风格，使用 LobeUI SpotlightCard + motion 动画
 */
import { useMemo, useCallback, memo } from 'react'
import { motion } from 'motion/react'
import { Button, Icon, Tag } from '@lobehub/ui'
import { SpotlightCard } from '@lobehub/ui/awesome'
import { useTheme } from 'antd-style'
import {
  Activity,
  ArrowRight,
  Brain,
  Clipboard,
  Copy,
  Eye,
  FileText,
  Import,
  ListTodo,
  MessageSquare,
  Plus,
  Sparkles,
  User as UserIcon
} from 'lucide-react'
import { fadeUpStagger } from '../theme/motionPresets'
import { usePrizmContext } from '../context/PrizmContext'
import { useHomeData } from '../hooks/useHomeData'
import { useWorkNavigation } from '../context/WorkNavigationContext'
import { useChatWithFile } from '../context/ChatWithFileContext'
import { useImportContext } from '../context/ImportContext'
import { SectionHeader } from '../components/ui/SectionHeader'
import { LoadingPlaceholder } from '../components/ui/LoadingPlaceholder'
import { HomeStatusBar } from '../components/HomeStatusBar'
import { formatRelativeTime } from '../utils/formatRelativeTime'
import HomeStatsSection, { type StatItem } from './HomeStatsSection'
import RecentSessionsSection from './RecentSessionsSection'
import HomeTodoSection, { type TodoListGroup } from './HomeTodoSection'
import type { TodoList, Document as PrizmDocument } from '@prizm/client-core'
import type { FileItem } from '../hooks/useFileList'

/* ── 工具函数 ── */
function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

function stripMarkdown(text: string): string {
  return text
    .replace(/[#*_~`>|[\]()!-]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
}

/* ── 主组件 ── */
function HomePage({
  onNavigateToAgent,
  onNavigateToWork,
  onNavigateToUser
}: {
  onNavigateToAgent: () => void
  onNavigateToWork: () => void
  onNavigateToUser: () => void
}) {
  const { manager } = usePrizmContext()
  const data = useHomeData()
  const { openFileAtWork } = useWorkNavigation()
  const { chatWith } = useChatWithFile()
  const { startImportFromFileDialog } = useImportContext()
  const theme = useTheme()

  /* 最近 5 条会话，按 updatedAt 排序 */
  const recentSessions = useMemo(() => {
    return [...data.sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)
  }, [data.sessions])

  /* 待办列表：按列表分组，每个列表最多展示 4 项活跃待办，最多 3 个列表 */
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
      if (activeItems.length > 0) {
        lists.push({ list, activeItems })
      }
    }
    lists.sort((a, b) => b.list.updatedAt - a.list.updatedAt)
    return lists.slice(0, 3)
  }, [data.fileList])

  /* 最近 4 篇文档 */
  const recentDocuments = useMemo(() => {
    return data.fileList
      .filter((f) => f.kind === 'document')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 4)
  }, [data.fileList])

  /* 统计卡片数据：会话、文档 + 按类型分组的记忆 */
  const bt = data.stats.memoryByType
  const statItems = useMemo<StatItem[]>(
    () => [
      {
        icon: <MessageSquare size={20} />,
        label: '会话',
        value: data.statsLoading ? '...' : String(data.stats.sessionsCount),
        color: theme.colorInfo,
        onClick: onNavigateToAgent
      },
      {
        icon: <FileText size={20} />,
        label: '文档',
        value: data.statsLoading ? '...' : String(data.stats.documentsCount),
        color: theme.colorSuccess,
        onClick: onNavigateToWork
      },
      {
        icon: <UserIcon size={20} />,
        label: '画像',
        value: data.statsLoading ? '...' : String(bt.profile),
        color: theme.colorWarning,
        description: 'profile',
        onClick: onNavigateToUser
      },
      {
        icon: <Sparkles size={20} />,
        label: '叙事',
        value: data.statsLoading ? '...' : String(bt.narrative),
        color: theme.geekblue,
        description: 'narrative',
        onClick: onNavigateToUser
      },
      {
        icon: <Eye size={20} />,
        label: '前瞻',
        value: data.statsLoading ? '...' : String(bt.foresight),
        color: theme.cyan,
        description: 'foresight',
        onClick: onNavigateToUser
      },
      {
        icon: <Brain size={20} />,
        label: '文档记忆',
        value: data.statsLoading ? '...' : String(bt.document),
        color: theme.colorSuccess,
        description: 'document',
        onClick: onNavigateToUser
      },
      {
        icon: <Activity size={20} />,
        label: '事件日志',
        value: data.statsLoading ? '...' : String(bt.event_log),
        color: theme.magenta,
        description: 'event_log',
        onClick: onNavigateToUser
      }
    ],
    [
      data.statsLoading,
      data.stats,
      bt,
      theme,
      onNavigateToAgent,
      onNavigateToWork,
      onNavigateToUser
    ]
  )

  /* 快捷操作 */
  const handleNewChat = useCallback(() => {
    chatWith({ text: '' })
    onNavigateToAgent()
  }, [chatWith, onNavigateToAgent])

  const handleOpenSession = useCallback(
    (sessionId: string) => {
      chatWith({ sessionId })
      onNavigateToAgent()
    },
    [chatWith, onNavigateToAgent]
  )

  const handleOpenDocument = useCallback(
    (file: FileItem) => {
      openFileAtWork(file.kind, file.id)
      onNavigateToWork()
    },
    [openFileAtWork, onNavigateToWork]
  )

  const handleNewDocument = useCallback(async () => {
    const http = manager?.getHttpClient()
    if (!http) return
    try {
      const doc = await http.createDocument({ title: '新文档' }, data.currentScope)
      openFileAtWork('document', doc.id)
      onNavigateToWork()
    } catch {
      /* ignore */
    }
  }, [manager, data.currentScope, openFileAtWork, onNavigateToWork])

  const handleOpenTodoList = useCallback(
    (listId: string) => {
      openFileAtWork('todoList', listId)
      onNavigateToWork()
    },
    [openFileAtWork, onNavigateToWork]
  )

  const handleCopyClipboardItem = useCallback((content: string) => {
    void navigator.clipboard.writeText(content)
  }, [])

  const renderDocItem = useCallback(
    (file: FileItem) => {
      const doc = file.raw as PrizmDocument
      const raw = (doc.content ?? '').slice(0, 200)
      const stripped = stripMarkdown(raw)
      const preview = stripped.length > 80 ? stripped.slice(0, 80) + '...' : stripped || '(空)'

      return (
        <div
          className="home-doc-card"
          role="button"
          tabIndex={0}
          onClick={() => handleOpenDocument(file)}
          onKeyDown={(e) => e.key === 'Enter' && handleOpenDocument(file)}
        >
          <div className="home-doc-card__icon">
            <FileText size={16} />
          </div>
          <h4 className="home-doc-card__title">{doc.title || '无标题'}</h4>
          <p className="home-doc-card__preview">{preview}</p>
          <span className="home-doc-card__time">{formatRelativeTime(file.updatedAt)}</span>
        </div>
      )
    },
    [handleOpenDocument]
  )

  let sectionIdx = 0

  return (
    <div className="home-page">
      <div className="home-scroll-container">
        {/* ── 连接状态条 ── */}
        <HomeStatusBar />

        {/* ── 问候 + 快捷操作 ── */}
        <motion.div className="home-greeting" {...fadeUpStagger(sectionIdx++)}>
          <div className="home-greeting-text">
            <h1 className="home-greeting-title">{getGreeting()}</h1>
            <p className="home-greeting-subtitle">
              工作区 <Tag size="small">{data.getScopeLabel(data.currentScope)}</Tag>
            </p>
          </div>
          <div className="home-quick-actions">
            <Button
              icon={<Icon icon={Plus} size="small" />}
              onClick={handleNewChat}
              type="primary"
              size="middle"
            >
              新对话
            </Button>
            <Button
              icon={<Icon icon={FileText} size="small" />}
              onClick={() => onNavigateToWork()}
              size="middle"
            >
              文档
            </Button>
            <Button
              icon={<Icon icon={ListTodo} size="small" />}
              onClick={() => onNavigateToWork()}
              size="middle"
            >
              待办
            </Button>
            <Button
              icon={<Icon icon={Import} size="small" />}
              onClick={() => void startImportFromFileDialog()}
              size="middle"
            >
              导入
            </Button>
          </div>
        </motion.div>

        {/* ── 工作区统计 (SpotlightCard) ── */}
        <HomeStatsSection items={statItems} animationIndex={sectionIdx++} />

        {/* ── 主内容网格 ── */}
        <div className="home-grid">
          <RecentSessionsSection
            sessions={recentSessions}
            sessionsLoading={data.sessionsLoading}
            sessionsCount={data.stats.sessionsCount}
            onNewChat={handleNewChat}
            onOpenSession={handleOpenSession}
            onViewAll={onNavigateToAgent}
            animationIndex={sectionIdx++}
          />
          <HomeTodoSection
            todoLists={todoLists}
            loading={data.fileListLoading}
            onOpenTodoList={handleOpenTodoList}
            onViewAll={onNavigateToWork}
            animationIndex={sectionIdx++}
          />
        </div>

        {/* ── 最近文档 (SpotlightCard) ── */}
        {recentDocuments.length > 0 && (
          <motion.div {...fadeUpStagger(sectionIdx++)}>
            <SectionHeader
              icon={FileText}
              title="最近文档"
              count={data.stats.documentsCount}
              extra={
                <>
                  <Button
                    size="small"
                    icon={<Icon icon={Plus} size="small" />}
                    onClick={handleNewDocument}
                  >
                    新建
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    icon={<Icon icon={ArrowRight} size="small" />}
                    iconPosition="end"
                    onClick={onNavigateToWork}
                  >
                    查看全部
                  </Button>
                </>
              }
            />
            {data.fileListLoading ? (
              <LoadingPlaceholder />
            ) : (
              <SpotlightCard
                items={recentDocuments}
                renderItem={renderDocItem}
                columns={recentDocuments.length >= 3 ? 3 : recentDocuments.length}
                gap="12px"
                size={600}
                borderRadius={12}
                className="home-spotlight-docs"
              />
            )}
          </motion.div>
        )}

        {/* ── 剪贴板历史条 ── */}
        {data.clipboard.length > 0 && (
          <motion.div className="home-clipboard-strip" {...fadeUpStagger(sectionIdx++)}>
            <div className="home-clipboard-strip__header">
              <Icon icon={Clipboard} size="small" />
              <span className="home-card__title">最近剪贴板</span>
              <span className="section-header__extra">
                <Button
                  size="small"
                  type="text"
                  icon={<Icon icon={ArrowRight} size="small" />}
                  iconPosition="end"
                  onClick={onNavigateToWork}
                >
                  查看全部
                </Button>
              </span>
            </div>
            <div className="home-clipboard-strip__items">
              {data.clipboard.map((item) => (
                <div
                  key={item.id}
                  className="home-clipboard-item home-clipboard-item--clickable"
                  title="点击复制到剪贴板"
                  role="button"
                  tabIndex={0}
                  onClick={() => handleCopyClipboardItem(item.content)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCopyClipboardItem(item.content)}
                >
                  <span className="home-clipboard-item__text">
                    {item.content.length > 80 ? item.content.slice(0, 80) + '...' : item.content}
                  </span>
                  <div className="home-clipboard-item__footer">
                    <span className="home-clipboard-item__time">
                      {formatRelativeTime(item.createdAt)}
                    </span>
                    <Icon icon={Copy} size={12} className="home-clipboard-item__copy-icon" />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}

export default memo(HomePage)
