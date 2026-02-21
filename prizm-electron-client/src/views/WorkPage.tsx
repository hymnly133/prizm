/**
 * WorkPage (工作台) — 统一内容管理
 *
 * 两种视图模式：
 * 1. 集成视图（默认）— 滚动式布局：文档卡片网格 + 待办紧凑卡片 + 日程时间线
 * 2. 文件树视图 — 完整的文件夹结构浏览
 *
 * 设计原则：
 * - 文档数量最多，占主视觉区域，使用大卡片网格展示预览
 * - 待办和日程占用较小，使用紧凑但信息密度高的呈现方式
 * - 单页滚动，各 Section 有独立标题栏
 */
import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { ActionIcon, Button, Flexbox, Markdown, Modal, toast, Icon } from '@lobehub/ui'
import { App, Tag, Progress, Badge, Checkbox } from 'antd'
import { AnimatePresence, motion } from 'motion/react'
import {
  Calendar,
  CheckSquare,
  Circle,
  Edit3,
  FileText,
  Import,
  ListTodo,
  Loader,
  MessageSquare,
  Plus,
  Trash2,
  X
} from 'lucide-react'
import { useCardSelection } from '../hooks/useCardSelection'
import { EASE_SMOOTH } from '../theme/motionPresets'
import { Segmented } from '../components/ui/Segmented'
import { SectionHeader } from '../components/ui/SectionHeader'
import { LoadingPlaceholder } from '../components/ui/LoadingPlaceholder'
import { EmptyState } from '../components/ui/EmptyState'
import { RefreshIconButton } from '../components/ui/RefreshIconButton'
import FileDetailView from '../components/FileDetailView'
import DocumentPreviewModal from '../components/DocumentPreviewModal'
import SearchSection from '../components/SearchSection'
import {
  ScheduleTimeline,
  ScheduleCalendar,
  ScheduleDetailDrawer,
  ScheduleCreateModal,
  ScheduleConflictBadge,
  CronJobPanel,
  CronJobCreateModal
} from '../components/schedule'
import type { ScheduleViewMode } from '../components/schedule'
import { useScope } from '../hooks/useScope'
import { useScopeDataStore } from '../store/scopeDataStore'
import { useFileList, docToFileItem, todoToFileItem } from '../hooks/useFileList'
import { usePrizmContext } from '../context/PrizmContext'
import { useLogsContext } from '../context/LogsContext'
import { useWorkNavigation } from '../context/WorkNavigationContext'
import { useDocumentNavigation, useChatWithFile } from '../context/NavigationContext'
import { useImportContext } from '../context/ImportContext'
import { useScheduleStore } from '../store/scheduleStore'
import { formatRelativeTime } from '../utils/formatRelativeTime'
import { isImageFileName } from '../utils/fileUtils'
import { WorkFolderView } from '../components/WorkFolderView'
import type { FileKind, FileItem } from '../hooks/useFileList'
import type { TodoItemStatus, TodoList, Document as PrizmDocument } from '@prizm/client-core'
import type { SavePayload } from '../components/FileDetailView'
import type { ScheduleItem } from '@prizm/shared'
import type { TreeNode } from '../hooks/useFileTree'
import { getKindLabel, STATUS_LABELS } from '../constants/todo'
import dayjs from 'dayjs'

const VIEW_MODE_KEY = 'prizm-work-view-mode'
type ViewMode = 'integrated' | 'folder'

function stripMarkdown(text: string): string {
  return text
    .replace(/[#*_~`>|[\]()!-]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
}

const SCHEDULE_VIEW_KEY = 'prizm-schedule-view'

/* ══════════════════════════════════════════════
   文档卡片网格 — 主要视觉区域
   ══════════════════════════════════════════════ */
const DocumentGrid = memo(function DocumentGrid({
  items,
  loading,
  onSelect,
  onEdit,
  onAdd,
  onDelete,
  onChat,
  isSelectionMode,
  isSelected,
  onToggleItem
}: {
  items: FileItem[]
  loading: boolean
  onSelect: (payload: { kind: FileKind; id: string }) => void
  onEdit: (docId: string) => void
  onAdd: () => void
  onDelete: (file: FileItem) => void
  onChat: (file: FileItem) => void
  isSelectionMode: boolean
  isSelected: (id: string) => boolean
  onToggleItem: (id: string, shiftKey?: boolean) => void
}) {
  return (
    <section className="ws-section ws-section--documents">
      <SectionHeader
        icon={FileText}
        title="文档"
        count={items.length}
        extra={
          <Button size="small" icon={<Icon icon={Plus} size="small" />} onClick={onAdd}>
            新建
          </Button>
        }
      />
      {loading ? (
        <LoadingPlaceholder />
      ) : items.length === 0 ? (
        <EmptyState
          icon={FileText}
          description="暂无文档，开始创建吧"
          actions={
            <Button icon={<Icon icon={Plus} size="small" />} onClick={onAdd}>
              新建文档
            </Button>
          }
        />
      ) : (
        <div className="ws-doc-grid">
          {items.map((file) => {
            const doc = file.raw as PrizmDocument
            const raw = (doc.content ?? '').slice(0, 300)
            const stripped = stripMarkdown(raw)
            const preview = stripped.length > 120 ? stripped.slice(0, 120) + '…' : stripped || ''
            const wordCount = (doc.content ?? '').length
            const selected = isSelected(file.id)
            return (
              <div
                key={file.id}
                className={`ws-doc-card${selected ? ' ws-doc-card--selected' : ''}${
                  isSelectionMode ? ' ws-doc-card--selectable' : ''
                }`}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  if (isSelectionMode || e.ctrlKey || e.metaKey) {
                    e.preventDefault()
                    onToggleItem(file.id, e.shiftKey)
                  } else {
                    onSelect({ kind: 'document', id: file.id })
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (isSelectionMode) onToggleItem(file.id)
                    else onSelect({ kind: 'document', id: file.id })
                  }
                }}
              >
                <div className="ws-doc-card__body">
                  <div className="ws-doc-card__title-row">
                    <span
                      className={`ws-card-check${
                        isSelectionMode || selected ? ' ws-card-check--visible' : ''
                      }`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleItem(file.id, e.shiftKey)
                      }}
                    >
                      <Checkbox checked={selected} />
                    </span>
                    <h3 className="ws-doc-card__title">{doc.title || '无标题'}</h3>
                  </div>
                  {preview && <p className="ws-doc-card__preview">{preview}</p>}
                </div>
                <div className="ws-doc-card__footer">
                  <span className="ws-doc-card__meta">
                    {formatRelativeTime(file.updatedAt)}
                    {wordCount > 0 && (
                      <span className="ws-doc-card__chars">
                        {wordCount > 999 ? `${(wordCount / 1000).toFixed(1)}k` : wordCount} 字
                      </span>
                    )}
                  </span>
                  {!isSelectionMode && (
                    <div
                      className="ws-doc-card__actions"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <ActionIcon
                        icon={Edit3}
                        size="small"
                        title="编辑"
                        onClick={() => onEdit(file.id)}
                      />
                      <ActionIcon
                        icon={MessageSquare}
                        size="small"
                        title="聊聊它"
                        onClick={() => onChat(file)}
                      />
                      <ActionIcon
                        icon={Trash2}
                        size="small"
                        title="删除"
                        onClick={() => onDelete(file)}
                      />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
})

/* ══════════════════════════════════════════════
   待办列表 — 紧凑卡片 + 进度条
   ══════════════════════════════════════════════ */
const TodoCards = memo(function TodoCards({
  items,
  loading,
  onSelect,
  onAdd,
  onDelete,
  onChat,
  isSelectionMode,
  isSelected,
  onToggleItem
}: {
  items: FileItem[]
  loading: boolean
  onSelect: (payload: { kind: FileKind; id: string }) => void
  onAdd: () => void
  onDelete: (file: FileItem) => void
  onChat: (file: FileItem) => void
  isSelectionMode: boolean
  isSelected: (id: string) => boolean
  onToggleItem: (id: string, shiftKey?: boolean) => void
}) {
  return (
    <section className="ws-section ws-section--todos">
      <SectionHeader
        icon={ListTodo}
        title="待办列表"
        count={items.length}
        extra={
          <Button size="small" icon={<Icon icon={Plus} size="small" />} onClick={onAdd}>
            新建
          </Button>
        }
      />
      {loading ? (
        <LoadingPlaceholder />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          description="暂无待办"
          actions={
            <Button size="small" icon={<Icon icon={Plus} size="small" />} onClick={onAdd}>
              新建待办
            </Button>
          }
        />
      ) : (
        <div className="ws-todo-grid">
          {items.map((file) => {
            const list = file.raw as TodoList
            const total = list.items.length
            const doneCount = list.items.filter((i) => i.status === 'done').length
            const doingCount = list.items.filter((i) => i.status === 'doing').length
            const todoCount = total - doneCount - doingCount
            const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0
            const topItems = list.items
              .filter((i) => i.status !== 'done')
              .sort((a, b) => {
                if (a.status === 'doing' && b.status !== 'doing') return -1
                if (b.status === 'doing' && a.status !== 'doing') return 1
                return b.updatedAt - a.updatedAt
              })
              .slice(0, 4)
            const selected = isSelected(file.id)

            return (
              <div
                key={file.id}
                className={`ws-todo-card${selected ? ' ws-todo-card--selected' : ''}${
                  isSelectionMode ? ' ws-todo-card--selectable' : ''
                }`}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  if (isSelectionMode || e.ctrlKey || e.metaKey) {
                    e.preventDefault()
                    onToggleItem(file.id, e.shiftKey)
                  } else {
                    onSelect({ kind: 'todoList', id: file.id })
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (isSelectionMode) onToggleItem(file.id)
                    else onSelect({ kind: 'todoList', id: file.id })
                  }
                }}
              >
                <div className="ws-todo-card__header">
                  <span
                    className={`ws-card-check ws-card-check--compact${
                      isSelectionMode || selected ? ' ws-card-check--visible' : ''
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleItem(file.id, e.shiftKey)
                    }}
                  >
                    <Checkbox checked={selected} />
                  </span>
                  <h4 className="ws-todo-card__title">{file.title}</h4>
                  {!isSelectionMode && (
                    <div
                      className="ws-todo-card__actions"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <ActionIcon
                        icon={MessageSquare}
                        size="small"
                        title="聊聊它"
                        onClick={() => onChat(file)}
                      />
                      <ActionIcon
                        icon={Trash2}
                        size="small"
                        title="删除"
                        onClick={() => onDelete(file)}
                      />
                    </div>
                  )}
                </div>
                <Progress
                  percent={pct}
                  size="small"
                  strokeColor="var(--ant-color-success)"
                  trailColor="var(--ant-color-fill-secondary)"
                  showInfo={false}
                  className="ws-todo-card__progress"
                />
                <div className="ws-todo-card__stats">
                  {doingCount > 0 && (
                    <Badge
                      color="blue"
                      text={<span className="ws-todo-card__stat-text">{doingCount} 进行中</span>}
                    />
                  )}
                  {todoCount > 0 && (
                    <Badge
                      color="default"
                      text={<span className="ws-todo-card__stat-text">{todoCount} 待办</span>}
                    />
                  )}
                  <Badge
                    color="green"
                    text={
                      <span className="ws-todo-card__stat-text">
                        {doneCount}/{total} 完成
                      </span>
                    }
                  />
                </div>
                {topItems.length > 0 && (
                  <ul className="ws-todo-card__items">
                    {topItems.map((item) => (
                      <li key={item.id} className="ws-todo-card__item">
                        {item.status === 'doing' ? (
                          <Loader
                            size={13}
                            className="ws-todo-card__item-icon ws-todo-card__item-icon--doing"
                          />
                        ) : (
                          <Circle size={13} className="ws-todo-card__item-icon" />
                        )}
                        <span className="ws-todo-card__item-text">{item.title}</span>
                      </li>
                    ))}
                    {list.items.filter((i) => i.status !== 'done').length > 4 && (
                      <li className="ws-todo-card__item ws-todo-card__item--more">
                        还有 {list.items.filter((i) => i.status !== 'done').length - 4} 项…
                      </li>
                    )}
                  </ul>
                )}
                <span className="ws-todo-card__time">{formatRelativeTime(file.updatedAt)}</span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
})

/* ══════════════════════════════════════════════
   日程区域 — Segmented 切换时间线/月历/定时任务
   ══════════════════════════════════════════════ */
const ScheduleSection = memo(function ScheduleSection() {
  const schedules = useScheduleStore((s) => s.schedules)
  const setSelectedScheduleId = useScheduleStore((s) => s.setSelectedScheduleId)
  const selectedScheduleId = useScheduleStore((s) => s.selectedScheduleId)

  const [scheduleView, setScheduleView] = useState<ScheduleViewMode>(() => {
    try {
      const v = localStorage.getItem(SCHEDULE_VIEW_KEY)
      if (v === 'calendar' || v === 'cron') return v
    } catch {
      /* ignore */
    }
    return 'timeline'
  })
  const [createOpen, setCreateOpen] = useState(false)
  const [cronCreateOpen, setCronCreateOpen] = useState(false)
  const [createInitialDate, setCreateInitialDate] = useState<number | undefined>()

  const handleViewChange = useCallback((v: string | number) => {
    const mode = v as ScheduleViewMode
    setScheduleView(mode)
    try {
      localStorage.setItem(SCHEDULE_VIEW_KEY, mode)
    } catch {
      /* ignore */
    }
  }, [])

  const handleItemClick = useCallback(
    (item: ScheduleItem) => {
      setSelectedScheduleId(item.id)
    },
    [setSelectedScheduleId]
  )

  const handleAddClick = useCallback((date?: number) => {
    setCreateInitialDate(date)
    setCreateOpen(true)
  }, [])

  const handleCreateClose = useCallback(() => {
    setCreateOpen(false)
    setCreateInitialDate(undefined)
  }, [])

  return (
    <section className="ws-schedule-section">
      <SectionHeader
        icon={Calendar}
        title="日程"
        count={schedules.length}
        extra={
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <ScheduleConflictBadge />
            <Segmented
              size="small"
              value={scheduleView}
              onChange={handleViewChange}
              options={[
                { label: '时间线', value: 'timeline' },
                { label: '月历', value: 'calendar' },
                { label: '定时', value: 'cron' }
              ]}
            />
            <ActionIcon
              icon={Plus}
              size="small"
              title={scheduleView === 'cron' ? '新建定时任务' : '新建日程'}
              onClick={() => (scheduleView === 'cron' ? setCronCreateOpen(true) : handleAddClick())}
            />
          </div>
        }
      />

      <div className="ws-schedule-section__views">
        {scheduleView === 'timeline' && (
          <ScheduleTimeline
            showHeader={false}
            onItemClick={handleItemClick}
            onAddClick={() => handleAddClick()}
          />
        )}
        {scheduleView === 'calendar' && (
          <ScheduleCalendar
            onItemClick={handleItemClick}
            onAddClick={(date) => handleAddClick(date)}
          />
        )}
        {scheduleView === 'cron' && <CronJobPanel onAddClick={() => setCronCreateOpen(true)} />}
      </div>

      <ScheduleDetailDrawer
        open={!!selectedScheduleId}
        scheduleId={selectedScheduleId}
        onClose={() => setSelectedScheduleId(null)}
      />

      <ScheduleCreateModal
        open={createOpen}
        onClose={handleCreateClose}
        initialDate={createInitialDate}
      />

      <CronJobCreateModal open={cronCreateOpen} onClose={() => setCronCreateOpen(false)} />
    </section>
  )
})

/* ══════════════════════════════════════════════
   批量操作浮动工具栏
   ══════════════════════════════════════════════ */
const BatchActionBar = memo(function BatchActionBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onDeselectAll,
  onDelete,
  onChat,
  onExit
}: {
  selectedCount: number
  totalCount: number
  onSelectAll: () => void
  onDeselectAll: () => void
  onDelete: () => void
  onChat: () => void
  onExit: () => void
}) {
  const allSelected = selectedCount === totalCount && totalCount > 0
  return (
    <motion.div
      className="ws-batch-bar"
      initial={{ opacity: 0, y: 40, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 40, scale: 0.96 }}
      transition={{ duration: 0.28, ease: EASE_SMOOTH }}
    >
      <div className="ws-batch-bar__left">
        <Checkbox
          checked={allSelected}
          indeterminate={selectedCount > 0 && !allSelected}
          onChange={(e) => {
            if (e.target.checked) onSelectAll()
            else onDeselectAll()
          }}
        />
        <span className="ws-batch-bar__count">
          已选 <strong>{selectedCount}</strong> 项
        </span>
      </div>

      <div className="ws-batch-bar__actions">
        <Button
          size="small"
          icon={<Icon icon={MessageSquare} size="small" />}
          onClick={onChat}
          disabled={selectedCount === 0}
        >
          聊聊它们
        </Button>
        <Button
          size="small"
          danger
          icon={<Icon icon={Trash2} size="small" />}
          onClick={onDelete}
          disabled={selectedCount === 0}
        >
          批量删除
        </Button>
      </div>

      <ActionIcon icon={X} size="small" title="退出选择" onClick={onExit} />
    </motion.div>
  )
})

/* ══════════════════════════════════════════════
   主组件
   ══════════════════════════════════════════════ */
function WorkPage() {
  const { modal } = App.useApp()
  const { manager } = usePrizmContext()
  const { addLog } = useLogsContext()
  const { currentScope } = useScope()
  const { fileList, fileListLoading, refreshFileList, optimisticAdd, optimisticRemove } =
    useFileList(currentScope)
  const { pendingWorkFile, consumePendingWorkFile } = useWorkNavigation()
  const { navigateToDocs } = useDocumentNavigation()
  const { chatWith } = useChatWithFile()
  const { startImportFromFileDialog } = useImportContext()

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(VIEW_MODE_KEY) === 'folder' ? 'folder' : 'integrated'
    } catch {
      return 'integrated'
    }
  })

  const hLayout = useDefaultLayout({ id: 'prizm-work-h' })
  const vLayout = useDefaultLayout({ id: 'prizm-work-v' })

  const [selectedFile, setSelectedFile] = useState<{ kind: FileKind; id: string } | null>(null)
  const [genericFilePreview, setGenericFilePreview] = useState<{
    path: string
    name: string
    content?: string
    /** 图片预览时使用（object URL），关闭时需 revoke */
    imageUrl?: string
    loading?: boolean
  } | null>(null)
  const filePreviewFetchingRef = useRef<string | null>(null)
  const filePreviewObjectUrlRef = useRef<string | null>(null)

  const closeGenericFilePreview = useCallback(() => {
    if (filePreviewObjectUrlRef.current) {
      URL.revokeObjectURL(filePreviewObjectUrlRef.current)
      filePreviewObjectUrlRef.current = null
    }
    setGenericFilePreview(null)
  }, [])

  useEffect(() => {
    setSelectedFile(null)
    closeGenericFilePreview()
  }, [currentScope, closeGenericFilePreview])

  useEffect(() => {
    if (!genericFilePreview) return
    if (genericFilePreview.content !== undefined || genericFilePreview.imageUrl !== undefined)
      return
    if (filePreviewFetchingRef.current === genericFilePreview.path) return
    const http = manager?.getHttpClient()
    if (!http) return
    const targetPath = genericFilePreview.path
    if (filePreviewObjectUrlRef.current) {
      URL.revokeObjectURL(filePreviewObjectUrlRef.current)
      filePreviewObjectUrlRef.current = null
    }
    const isImage = isImageFileName(genericFilePreview.name)
    filePreviewFetchingRef.current = targetPath
    setGenericFilePreview((prev) => prev && { ...prev, loading: true, imageUrl: undefined })

    if (isImage) {
      http
        .fileServeBlob(targetPath, currentScope)
        .then((blob) => {
          if (filePreviewObjectUrlRef.current) {
            URL.revokeObjectURL(filePreviewObjectUrlRef.current)
            filePreviewObjectUrlRef.current = null
          }
          const url = URL.createObjectURL(blob)
          filePreviewObjectUrlRef.current = url
          setGenericFilePreview((prev) =>
            prev && prev.path === targetPath ? { ...prev, imageUrl: url, loading: false } : prev
          )
        })
        .catch(() => {
          setGenericFilePreview((prev) =>
            prev && prev.path === targetPath
              ? { ...prev, content: '(无法加载图片)', loading: false }
              : prev
          )
        })
        .finally(() => {
          if (filePreviewFetchingRef.current === targetPath) filePreviewFetchingRef.current = null
        })
    } else {
      http
        .fileRead(targetPath, currentScope)
        .then((result) => {
          setGenericFilePreview((prev) =>
            prev && prev.path === targetPath
              ? { ...prev, content: result.content, loading: false }
              : prev
          )
        })
        .catch(() => {
          setGenericFilePreview((prev) =>
            prev && prev.path === targetPath
              ? { ...prev, content: '(无法读取文件内容)', loading: false }
              : prev
          )
        })
        .finally(() => {
          if (filePreviewFetchingRef.current === targetPath) filePreviewFetchingRef.current = null
        })
    }
  }, [genericFilePreview, manager, currentScope])

  useEffect(() => {
    if (!pendingWorkFile) return
    const { kind, id } = pendingWorkFile
    consumePendingWorkFile()
    if (kind === 'document') return
    const exists = fileList.some((f) => f.kind === kind && f.id === id)
    if (exists) {
      setSelectedFile(pendingWorkFile)
    } else {
      refreshFileList(currentScope, { silent: true }).then(() => {
        setSelectedFile(pendingWorkFile)
      })
    }
  }, [pendingWorkFile, consumePendingWorkFile, fileList, currentScope, refreshFileList])

  const todoItems = useMemo(
    () => fileList.filter((f) => f.kind === 'todoList').sort((a, b) => b.updatedAt - a.updatedAt),
    [fileList]
  )
  const docItems = useMemo(
    () => fileList.filter((f) => f.kind === 'document').sort((a, b) => b.updatedAt - a.updatedAt),
    [fileList]
  )

  const allCardIds = useMemo(
    () => [...docItems.map((f) => f.id), ...todoItems.map((f) => f.id)],
    [docItems, todoItems]
  )

  const cardSelection = useCardSelection(allCardIds)

  useEffect(() => {
    cardSelection.exitSelectionMode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentScope])

  useEffect(() => {
    if (!cardSelection.isSelectionMode) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cardSelection.exitSelectionMode()
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        cardSelection.selectAll(allCardIds)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    cardSelection.isSelectionMode,
    cardSelection.exitSelectionMode,
    cardSelection.selectAll,
    allCardIds
  ])

  const selectedFileData = useMemo(() => {
    if (!selectedFile) return null
    return fileList.find((f) => f.kind === selectedFile.kind && f.id === selectedFile.id) ?? null
  }, [selectedFile, fileList])

  const handleSelectFile = useCallback(
    (payload: { kind: FileKind; id: string }) => setSelectedFile(payload),
    []
  )
  const handleEditDoc = useCallback((docId: string) => navigateToDocs(docId), [navigateToDocs])
  const handleChatFile = useCallback(
    (file: FileItem) => {
      chatWith({ files: [{ kind: file.kind, id: file.id, title: file.title }] })
    },
    [chatWith]
  )

  const onAddDocument = useCallback(async () => {
    const http = manager?.getHttpClient()
    if (!http) return
    try {
      const doc = await http.createDocument({ title: '未命名文档', content: '' }, currentScope)
      optimisticAdd(docToFileItem(doc))
      navigateToDocs(doc.id)
      addLog('已创建文档', 'success')
    } catch (e) {
      addLog(`创建文档失败: ${String(e)}`, 'error')
    }
  }, [manager, currentScope, optimisticAdd, navigateToDocs, addLog])

  const onAddTodo = useCallback(async () => {
    const http = manager?.getHttpClient()
    if (!http) return
    try {
      const todoList = await http.createTodoList(currentScope, { title: '待办' })
      optimisticAdd(todoToFileItem(todoList))
      setSelectedFile({ kind: 'todoList', id: todoList.id })
      addLog('已新建待办列表', 'success')
    } catch (e) {
      addLog(`创建待办失败: ${String(e)}`, 'error')
    }
  }, [manager, currentScope, optimisticAdd, addLog])

  const doDeleteFile = useCallback(
    async (file: FileItem) => {
      if (!manager) return
      const http = manager.getHttpClient()
      optimisticRemove(file.kind, file.id)
      if (selectedFile?.kind === file.kind && selectedFile?.id === file.id) setSelectedFile(null)
      try {
        if (file.kind === 'todoList') await http.deleteTodoList(currentScope, file.id)
        else await http.deleteDocument(file.id, currentScope)
        addLog('已删除', 'success')
      } catch (e) {
        optimisticAdd(file)
        throw e
      }
    },
    [manager, currentScope, optimisticRemove, optimisticAdd, selectedFile, addLog]
  )

  const handleDeleteFile = useCallback(
    (file: FileItem) => {
      modal.confirm({
        title: '确认删除',
        content: `确定要删除「${file.title}」吗？`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            await doDeleteFile(file)
          } catch (e) {
            addLog(`删除失败: ${String(e)}`, 'error')
          }
        }
      })
    },
    [modal, doDeleteFile, addLog]
  )

  const handleBatchDelete = useCallback(() => {
    const ids = Array.from(cardSelection.selectedIds)
    const files = fileList.filter((f) => ids.includes(f.id))
    if (files.length === 0) return
    modal.confirm({
      title: '批量删除',
      content: `确定要删除选中的 ${files.length} 项吗？此操作不可撤销。`,
      okText: '全部删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const http = manager?.getHttpClient()
        if (!http) return
        if (files.length > 10) toast.loading(`正在删除 ${files.length} 项…`)
        const store = useScopeDataStore.getState()
        const docIds = files.filter((f) => f.kind === 'document').map((f) => f.id)
        const todoIds = files.filter((f) => f.kind === 'todoList').map((f) => f.id)
        store.removeDocuments(docIds)
        store.removeTodoLists(todoIds)
        if (
          selectedFile &&
          files.some((f) => f.kind === selectedFile.kind && f.id === selectedFile.id)
        )
          setSelectedFile(null)
        cardSelection.exitSelectionMode()
        const CONCURRENCY = 5
        let failed = 0
        for (let i = 0; i < files.length; i += CONCURRENCY) {
          const chunk = files.slice(i, i + CONCURRENCY)
          const results = await Promise.allSettled(
            chunk.map(async (file) => {
              try {
                if (file.kind === 'todoList') await http.deleteTodoList(currentScope, file.id)
                else await http.deleteDocument(file.id, currentScope)
              } catch {
                if (file.kind === 'todoList') store.upsertTodoList(file.raw as TodoList)
                else store.upsertDocument(file.raw as PrizmDocument)
                throw new Error('delete failed')
              }
            })
          )
          failed += results.filter((r) => r.status === 'rejected').length
        }
        if (failed > 0) addLog(`${files.length - failed} 项已删除，${failed} 项失败`, 'warning')
        else addLog(`已删除 ${files.length} 项`, 'success')
      }
    })
  }, [cardSelection, fileList, modal, manager, currentScope, selectedFile, setSelectedFile, addLog])

  const handleBatchChat = useCallback(() => {
    const ids = Array.from(cardSelection.selectedIds)
    const files = fileList.filter((f) => ids.includes(f.id))
    if (files.length === 0) return
    chatWith({
      files: files.map((f) => ({ kind: f.kind, id: f.id, title: f.title }))
    })
    cardSelection.exitSelectionMode()
  }, [cardSelection, fileList, chatWith])

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode)
    } catch {
      /* ignore */
    }
  }, [])

  const handleFolderNodeClick = useCallback((node: TreeNode) => {
    if (node.prizmId && node.prizmType) {
      const kind: FileKind = node.prizmType === 'document' ? 'document' : 'todoList'
      setSelectedFile({ kind, id: node.prizmId })
    } else {
      setGenericFilePreview({ path: node.id, name: node.name })
    }
  }, [])

  const refreshScope = useCallback(
    () => refreshFileList(currentScope),
    [currentScope, refreshFileList]
  )

  async function onSaveFile(payload: SavePayload) {
    const f = selectedFileData
    const http = manager?.getHttpClient()
    if (!http || !f) return
    try {
      if (payload.kind === 'document')
        await http.updateDocument(
          f.id,
          { title: payload.title, content: payload.content },
          currentScope
        )
      else if (payload.kind === 'todoList') {
        await http.updateTodoListTitle(currentScope, f.id, payload.title)
        await http.replaceTodoItems(currentScope, f.id, payload.items)
      }
      addLog('已保存', 'success')
    } catch (e) {
      addLog(`保存失败: ${String(e)}`, 'error')
      throw e
    }
  }

  async function onDeleteFile() {
    const f = selectedFileData
    if (!f) return
    try {
      await doDeleteFile(f)
    } catch (e) {
      addLog(`删除失败: ${String(e)}`, 'error')
    }
  }

  async function onTodoItemStatus(itemId: string, status: string) {
    if (!manager || !['todo', 'doing', 'done'].includes(status)) return
    try {
      await manager
        .getHttpClient()
        .updateTodoItem(itemId, { status: status as TodoItemStatus }, currentScope)
      toast.success(`已设为 ${STATUS_LABELS[status as TodoItemStatus] ?? status}`)
      addLog('已更新 TODO 状态', 'success')
    } catch {
      toast.error('更新失败')
    }
  }

  return (
    <section className="work-page work-page--cards">
      {/* ── 工具栏 ── */}
      <div className="work-page__toolbar">
        <div className="work-page__toolbar-left">
          <SearchSection
            activeTab="files"
            scope={currentScope}
            onActiveTabChange={() => {}}
            onRefreshFiles={refreshScope}
            onRefreshTasks={refreshScope}
            onRefreshClipboard={() => {}}
            onSelectFile={handleSelectFile}
          />
        </div>
        <div className="work-page__toolbar-actions">
          <ActionIcon icon={ListTodo} title="新建待办" onClick={onAddTodo} size="large" />
          <ActionIcon icon={FileText} title="新建文档" onClick={onAddDocument} size="large" />
          <ActionIcon
            icon={Import}
            title="导入文件"
            onClick={() => void startImportFromFileDialog()}
            size="large"
          />
          <RefreshIconButton onClick={refreshScope} disabled={fileListLoading} title="刷新" />
          <span className="work-page__toolbar-divider" />
          <ActionIcon
            icon={CheckSquare}
            title={cardSelection.isSelectionMode ? '退出多选' : '多选模式'}
            size="large"
            className={cardSelection.isSelectionMode ? 'work-page__view-toggle--active' : ''}
            onClick={cardSelection.toggleSelectionMode}
          />
          <Segmented
            size="small"
            value={viewMode}
            onChange={(v) => handleViewModeChange(v as ViewMode)}
            options={[
              { label: '集成', value: 'integrated' },
              { label: '文件树', value: 'folder' }
            ]}
          />
        </div>
      </div>

      {/* ── 内容区 ── */}
      <div className="work-page__content">
        {viewMode === 'folder' ? (
          <WorkFolderView scope={currentScope} onSelectFile={handleFolderNodeClick} />
        ) : (
          <Group
            orientation="horizontal"
            className="ws-integrated"
            defaultLayout={hLayout.defaultLayout}
            onLayoutChanged={hLayout.onLayoutChanged}
          >
            {/* 主区域：文档卡片网格 */}
            <Panel id="docs" className="ws-primary" minSize="240px">
              <DocumentGrid
                items={docItems}
                loading={fileListLoading}
                onSelect={handleSelectFile}
                onEdit={handleEditDoc}
                onAdd={onAddDocument}
                onDelete={handleDeleteFile}
                onChat={handleChatFile}
                isSelectionMode={cardSelection.isSelectionMode}
                isSelected={cardSelection.isSelected}
                onToggleItem={cardSelection.toggleItem}
              />
            </Panel>
            <Separator className="ws-separator ws-separator--h" />
            {/* 侧边区域：待办 + 日程（各面板可独立调整高度） */}
            <Panel
              id="sidebar"
              className="ws-sidebar"
              defaultSize="30%"
              minSize="240px"
              maxSize="50%"
            >
              <Group
                orientation="vertical"
                className="ws-sidebar-inner"
                defaultLayout={vLayout.defaultLayout}
                onLayoutChanged={vLayout.onLayoutChanged}
              >
                <Panel id="todos" className="ws-sidebar-panel" minSize="20%">
                  <TodoCards
                    items={todoItems}
                    loading={fileListLoading}
                    onSelect={handleSelectFile}
                    onAdd={onAddTodo}
                    onDelete={handleDeleteFile}
                    onChat={handleChatFile}
                    isSelectionMode={cardSelection.isSelectionMode}
                    isSelected={cardSelection.isSelected}
                    onToggleItem={cardSelection.toggleItem}
                  />
                </Panel>
                <Separator className="ws-separator ws-separator--v" />
                <Panel id="schedule" className="ws-sidebar-panel" minSize="20%">
                  <ScheduleSection />
                </Panel>
              </Group>
            </Panel>
          </Group>
        )}
      </div>

      {/* ── 批量操作浮动工具栏 ── */}
      <AnimatePresence>
        {cardSelection.isSelectionMode && (
          <BatchActionBar
            selectedCount={cardSelection.selectedIds.size}
            totalCount={allCardIds.length}
            onSelectAll={() => cardSelection.selectAll(allCardIds)}
            onDeselectAll={cardSelection.deselectAll}
            onDelete={handleBatchDelete}
            onChat={handleBatchChat}
            onExit={cardSelection.exitSelectionMode}
          />
        )}
      </AnimatePresence>

      {/* ── 文档预览模态 ── */}
      <DocumentPreviewModal
        open={!!selectedFile && selectedFile.kind === 'document'}
        documentId={selectedFile?.kind === 'document' ? selectedFile.id : null}
        scope={currentScope}
        onClose={() => setSelectedFile(null)}
        onEdit={handleEditDoc}
      />

      {/* ── Todo 列表编辑模态 ── */}
      <Modal
        destroyOnHidden
        open={!!selectedFile && selectedFile.kind !== 'document'}
        title={selectedFileData ? getKindLabel(selectedFileData.kind) : ''}
        width={800}
        onCancel={() => setSelectedFile(null)}
        footer={
          <Flexbox horizontal justify="flex-end">
            <Button type="primary" onClick={() => setSelectedFile(null)}>
              关闭
            </Button>
          </Flexbox>
        }
      >
        {selectedFileData && selectedFileData.kind !== 'document' && (
          <div style={{ paddingTop: 16, maxHeight: '80vh', overflowY: 'auto' }}>
            <FileDetailView
              file={selectedFileData}
              onDelete={onDeleteFile}
              onDone={() => {}}
              onSave={onSaveFile}
              onTodoItemStatus={selectedFileData.kind === 'todoList' ? onTodoItemStatus : undefined}
            />
          </div>
        )}
      </Modal>

      {/* ── 通用文件预览模态（含图片查看） ── */}
      <Modal
        destroyOnHidden
        open={!!genericFilePreview}
        title={genericFilePreview?.name ?? '文件预览'}
        width={genericFilePreview?.imageUrl ? 900 : 800}
        onCancel={closeGenericFilePreview}
        footer={
          <Flexbox horizontal justify="flex-end">
            <Button type="primary" onClick={closeGenericFilePreview}>
              关闭
            </Button>
          </Flexbox>
        }
      >
        {genericFilePreview && (
          <div style={{ paddingTop: 16, maxHeight: '80vh', overflowY: 'auto' }}>
            {genericFilePreview.loading ? (
              <div style={{ padding: 24, textAlign: 'center', opacity: 0.5 }}>加载中…</div>
            ) : genericFilePreview.imageUrl ? (
              <div style={{ textAlign: 'center' }}>
                <img
                  src={genericFilePreview.imageUrl}
                  alt={genericFilePreview.name}
                  style={{
                    maxWidth: '100%',
                    height: 'auto',
                    objectFit: 'contain',
                    borderRadius: 8
                  }}
                />
              </div>
            ) : genericFilePreview.name.endsWith('.md') ? (
              <Markdown>{genericFilePreview.content ?? '(空)'}</Markdown>
            ) : (
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: 13,
                  lineHeight: 1.6,
                  padding: 8,
                  background: 'var(--ant-color-fill-quaternary)',
                  borderRadius: 8
                }}
              >
                {genericFilePreview.content ?? '(空)'}
              </pre>
            )}
          </div>
        )}
      </Modal>
    </section>
  )
}

export default memo(WorkPage)
