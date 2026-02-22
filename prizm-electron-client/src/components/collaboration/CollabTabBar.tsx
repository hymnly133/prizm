/**
 * CollabTabBar — horizontal, drag-sortable tab strip for the right panel.
 *
 * Uses @dnd-kit with horizontalListSortingStrategy for drag reordering.
 */
import { memo, useCallback, useRef, useEffect } from 'react'
import { ActionIcon } from '@lobehub/ui'
import { Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Blocks,
  Calendar,
  Clock,
  FileText,
  GitBranch,
  Info,
  MessageSquare,
  Plus,
  X,
  Zap
} from 'lucide-react'
import type { CollabTab, CollabTabType } from './collabTabTypes'
import type { LucideIcon } from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  Blocks,
  Calendar,
  Clock,
  FileText,
  Zap,
  GitBranch,
  Info,
  MessageSquare
}

const TYPE_ICON: Record<CollabTabType, LucideIcon> = {
  document: FileText,
  task: Zap,
  workflow: GitBranch,
  'workflow-def': Blocks,
  run: GitBranch,
  session: MessageSquare,
  'session-detail': Info,
  schedule: Calendar,
  cron: Clock,
  'document-list': FileText,
  'task-list': Zap,
  'workflow-list': GitBranch,
  'schedule-list': Calendar,
  'cron-list': Clock
}

/* ── Sortable Tab Item ── */

interface SortableTabProps {
  tab: CollabTab
  isActive: boolean
  onActivate: (id: string) => void
  onClose: (e: React.MouseEvent, id: string) => void
}

const SortableTabItem = memo(function SortableTabItem({
  tab,
  isActive,
  onActivate,
  onClose
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id
  })

  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, 0px, 0)` : undefined,
    transition: transition ?? undefined,
    cursor: isDragging ? 'grabbing' : 'pointer'
  }

  const IconComp = (tab.icon && ICON_MAP[tab.icon]) || TYPE_ICON[tab.type] || FileText

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`collab-tab-item${isActive ? ' collab-tab-item--active' : ''}${
        isDragging ? ' collab-tab-item--dragging' : ''
      }`}
      data-tab-id={tab.id}
      title={tab.label}
      onClick={() => onActivate(tab.id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onActivate(tab.id)}
      {...attributes}
      {...listeners}
    >
      <IconComp size={12} className="collab-tab-item__icon" />
      <span className="collab-tab-item__label">{tab.label}</span>
      {tab.dirty && <span className="collab-tab-item__dirty" />}
      {tab.closeable !== false && (
        <span
          className="collab-tab-item__close"
          role="button"
          tabIndex={-1}
          onClick={(e) => onClose(e, tab.id)}
        >
          <X size={11} />
        </span>
      )}
    </div>
  )
})

/* ── Tab Bar ── */

export interface CollabTabBarProps {
  tabs: CollabTab[]
  activeTabId: string | null
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onReorder?: (reordered: CollabTab[]) => void
  onAddTab?: (
    type: 'document-list' | 'task-list' | 'workflow-list' | 'schedule-list' | 'cron-list'
  ) => void
  onClosePanel?: () => void
}

export const CollabTabBar = memo(function CollabTabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onReorder,
  onAddTab,
  onClosePanel
}: CollabTabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!activeTabId || !scrollRef.current) return
    const el = scrollRef.current.querySelector(`[data-tab-id="${activeTabId}"]`)
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [activeTabId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIdx = tabs.findIndex((t) => t.id === active.id)
      const newIdx = tabs.findIndex((t) => t.id === over.id)
      if (oldIdx === -1 || newIdx === -1) return
      onReorder?.(arrayMove(tabs, oldIdx, newIdx))
    },
    [tabs, onReorder]
  )

  const addMenuItems: MenuProps['items'] = [
    {
      key: 'document-list',
      icon: <FileText size={13} />,
      label: '浏览文档',
      onClick: () => onAddTab?.('document-list')
    },
    {
      key: 'task-list',
      icon: <Zap size={13} />,
      label: '浏览任务',
      onClick: () => onAddTab?.('task-list')
    },
    {
      key: 'workflow-list',
      icon: <GitBranch size={13} />,
      label: '浏览工作流',
      onClick: () => onAddTab?.('workflow-list')
    },
    { type: 'divider' },
    {
      key: 'schedule-list',
      icon: <Calendar size={13} />,
      label: '浏览日程',
      onClick: () => onAddTab?.('schedule-list')
    },
    {
      key: 'cron-list',
      icon: <Clock size={13} />,
      label: '浏览定时任务',
      onClick: () => onAddTab?.('cron-list')
    }
  ]

  const handleClose = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation()
      onClose(tabId)
    },
    [onClose]
  )

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="collab-tab-bar">
        <div className="collab-tab-bar__scroll" ref={scrollRef}>
          <SortableContext items={tabs} strategy={horizontalListSortingStrategy}>
            {tabs.map((tab) => (
              <SortableTabItem
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                onActivate={onActivate}
                onClose={handleClose}
              />
            ))}
          </SortableContext>
        </div>

        <div className="collab-tab-bar__actions">
          <Dropdown menu={{ items: addMenuItems }} trigger={['click']} placement="bottomRight">
            <ActionIcon icon={Plus} size="small" title="打开标签页" />
          </Dropdown>
          {onClosePanel && (
            <ActionIcon icon={X} size="small" title="关闭面板" onClick={onClosePanel} />
          )}
        </div>
      </div>
    </DndContext>
  )
})
