/**
 * HomePage - 主页：问候语、快捷操作、最近对话、统计概览、待办列表、文档、剪贴板
 * 现代 Dashboard 风格，使用 LobeUI SpotlightCard + motion 动画
 */
import { useMemo, useCallback, memo } from 'react'
import { motion } from 'motion/react'
import { Button, Icon, Tag, Text } from '@lobehub/ui'
import { SpotlightCard } from '@lobehub/ui/awesome'
import {
  Brain,
  Clipboard,
  FileText,
  Import,
  ListTodo,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles
} from 'lucide-react'
import { useHomeData } from '../hooks/useHomeData'
import { useWorkNavigation } from '../context/WorkNavigationContext'
import { useChatWithFile } from '../context/ChatWithFileContext'
import { useImportContext } from '../context/ImportContext'
import ScopeSidebar from '../components/ui/ScopeSidebar'
import { formatRelativeTime } from '../utils/formatRelativeTime'
import HomeStatsSection, { type StatItem } from './HomeStatsSection'
import RecentSessionsSection from './RecentSessionsSection'
import HomeTodoSection, { type TodoListGroup } from './HomeTodoSection'
import type { TodoList, Document as PrizmDocument } from '@prizm/client-core'
import type { FileItem } from '../hooks/useFileList'

/* ── 动画常量 ── */
const STAGGER_DELAY = 0.06
const EASE_SMOOTH = [0.33, 1, 0.68, 1] as const

function fadeUp(index: number) {
  return {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: index * STAGGER_DELAY, duration: 0.4, ease: EASE_SMOOTH }
  }
}

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
  onNavigateToWork
}: {
  onNavigateToAgent: () => void
  onNavigateToWork: () => void
}) {
  const data = useHomeData()
  const { openFileAtWork } = useWorkNavigation()
  const { chatWith } = useChatWithFile()
  const { startImportFromFileDialog } = useImportContext()

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

  /* 统计卡片数据 */
  const statItems = useMemo<StatItem[]>(
    () => [
      {
        icon: <MessageSquare size={20} />,
        label: '会话',
        value: data.statsLoading ? '...' : String(data.stats.sessionsCount),
        color: 'var(--ant-color-primary)'
      },
      {
        icon: <FileText size={20} />,
        label: '文档',
        value: data.statsLoading ? '...' : String(data.stats.documentsCount),
        color: 'var(--ant-color-success)'
      },
      {
        icon: <Brain size={20} />,
        label: 'User 记忆',
        value: data.statsLoading ? '...' : String(data.stats.userMemoryCount),
        color: 'var(--ant-color-warning)',
        description: '画像 / 偏好'
      },
      {
        icon: <Sparkles size={20} />,
        label: 'Scope 记忆',
        value: data.statsLoading ? '...' : String(data.stats.scopeMemoryCount),
        color: 'var(--ant-geekblue-6, #2f54eb)',
        description: '叙事 / 文档'
      }
    ],
    [data.statsLoading, data.stats]
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

  const handleOpenTodoList = useCallback(
    (listId: string) => {
      openFileAtWork('todoList', listId)
      onNavigateToWork()
    },
    [openFileAtWork, onNavigateToWork]
  )

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
        {/* ── Scope 选择器 ── */}
        <div className="home-scope-bar">
          <ScopeSidebar
            scopes={data.scopes}
            scopesLoading={data.scopesLoading}
            currentScope={data.currentScope}
            getScopeLabel={data.getScopeLabel}
            onSelect={data.setScope}
          />
          <button
            type="button"
            className="home-refresh-btn"
            onClick={data.refreshAll}
            title="刷新全部"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {/* ── 问候 + 快捷操作 ── */}
        <motion.div className="home-greeting" {...fadeUp(sectionIdx++)}>
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
            animationIndex={sectionIdx++}
          />
          <HomeTodoSection
            todoLists={todoLists}
            loading={data.fileListLoading}
            onOpenTodoList={handleOpenTodoList}
            animationIndex={sectionIdx++}
          />
        </div>

        {/* ── 最近文档 (SpotlightCard) ── */}
        {recentDocuments.length > 0 && (
          <motion.div {...fadeUp(sectionIdx++)}>
            <div className="home-section-header">
              <Icon icon={FileText} size="small" />
              <span className="home-section-title">最近文档</span>
              <Tag size="small">{data.stats.documentsCount}</Tag>
            </div>
            {data.fileListLoading ? (
              <div className="home-loading-placeholder">加载中...</div>
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
          <motion.div className="home-clipboard-strip" {...fadeUp(sectionIdx++)}>
            <div className="home-clipboard-strip__header">
              <Icon icon={Clipboard} size="small" />
              <span className="home-card__title">最近剪贴板</span>
            </div>
            <div className="home-clipboard-strip__items">
              {data.clipboard.map((item) => (
                <div key={item.id} className="home-clipboard-item" title={item.content}>
                  <span className="home-clipboard-item__text">
                    {item.content.length > 80 ? item.content.slice(0, 80) + '...' : item.content}
                  </span>
                  <span className="home-clipboard-item__time">
                    {formatRelativeTime(item.createdAt)}
                  </span>
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
