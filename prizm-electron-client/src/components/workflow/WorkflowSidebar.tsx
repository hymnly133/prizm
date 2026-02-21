/**
 * WorkflowSidebar — 左侧工作流与会话统一列表
 *
 * 工作流管理会话与工作流定义合并为单一列表，按更新时间排序；搜索、右键菜单、新建打开右侧面板。
 */

import { memo, useMemo, useCallback } from 'react'
import { Button, Dropdown, Tag } from 'antd'
import type { MenuProps } from 'antd'
import { Plus, Play, Pencil, Trash2, MessageSquare, PanelRightOpen } from 'lucide-react'
import { ActionIcon, Icon } from '@lobehub/ui'
import type { WorkflowDefRecord, WorkflowRun } from '@prizm/shared'
import type { EnrichedSession } from '@prizm/shared'
import { getWorkflowManagementSessionLabel } from '@prizm/shared'
import SearchInput from '../ui/SearchInput'
import { EmptyState } from '../ui/EmptyState'

type SidebarItem =
  | { type: 'session'; session: EnrichedSession }
  | { type: 'def'; def: WorkflowDefRecord }
  | { type: 'combined'; def: WorkflowDefRecord; session: EnrichedSession }

export interface WorkflowSidebarProps {
  defs: WorkflowDefRecord[]
  runs: WorkflowRun[]
  /** 工作流管理会话（待创建 + 已绑定） */
  managementSessions: EnrichedSession[]
  selectedDefId: string | null
  selectedManagementSessionId: string | null
  searchQuery: string
  onSearch: (q: string) => void
  /** 选中定义；可选 sessionId 表示同时打开关联会话（分屏） */
  onSelectDef: (defId: string, sessionId?: string | null) => void
  onSelectManagementSession: (sessionId: string | null, defId?: string | null) => void
  /** 打开右侧创建工作流面板（仅图/YAML） */
  onOpenCreatePanel: () => void
  /** 用对话创建：新建待创建会话并在主内容区展示 */
  onNewSession: () => void
  onRunWorkflow: (name: string) => void
  onDeleteDef: (defId: string) => void
  /** 删除待创建的管理会话（仅对未绑定定义的会话有效） */
  onDeleteManagementSession?: (sessionId: string) => void
  /** 打开右侧标签栏（与协作页一致） */
  onOpenRightPanel?: () => void
  /** 在右侧标签页打开定义（编辑）；若不传则右键「编辑」仅选中 */
  onOpenDefInTab?: (defId: string, label: string) => void
  /** 仅管理会话未创建工作流时隐藏「打开标签栏」入口 */
  hideTabBarEntry?: boolean
}

export const WorkflowSidebar = memo(function WorkflowSidebar({
  defs,
  runs,
  managementSessions,
  selectedDefId,
  selectedManagementSessionId,
  searchQuery,
  onSearch,
  onSelectDef,
  onSelectManagementSession,
  onOpenCreatePanel,
  onNewSession,
  onRunWorkflow,
  onDeleteDef,
  onDeleteManagementSession,
  onOpenRightPanel,
  onOpenDefInTab,
  hideTabBarEntry = false
}: WorkflowSidebarProps) {
  const activeDefNames = useMemo(() => {
    const names = new Set<string>()
    for (const run of runs) {
      if (run.status === 'running' || run.status === 'paused' || run.status === 'pending') {
        names.add(run.workflowName)
      }
    }
    return names
  }, [runs])

  /** 会话 ID 集合：已被某定义绑定的会话（用于合并为一项，不单独展示） */
  const sessionIdsOwnedByDef = useMemo(() => {
    const set = new Set<string>()
    for (const d of defs) {
      if (d.workflowManagementSessionId) set.add(d.workflowManagementSessionId)
    }
    return set
  }, [defs])

  /** 合并会话与定义为单一列表：对话创建的工作流只显示一项，点击即分屏；按更新时间降序 */
  const mergedItems = useMemo(() => {
    const sessionById = new Map(managementSessions.map((s) => [s.id, s]))
    const items: SidebarItem[] = []

    for (const d of defs) {
      const linkedSessionId = d.workflowManagementSessionId
      const linkedSession = linkedSessionId != null ? sessionById.get(linkedSessionId) : undefined
      if (linkedSession) {
        items.push({ type: 'combined', def: d, session: linkedSession })
      } else {
        items.push({ type: 'def', def: d })
      }
    }
    for (const s of managementSessions) {
      if (sessionIdsOwnedByDef.has(s.id)) continue
      items.push({ type: 'session', session: s })
    }
    items.sort((a, b) => {
      const ta =
        a.type === 'session'
          ? a.session.updatedAt
          : a.type === 'combined'
          ? Math.max(a.def.updatedAt, a.session.updatedAt)
          : a.def.updatedAt
      const tb =
        b.type === 'session'
          ? b.session.updatedAt
          : b.type === 'combined'
          ? Math.max(b.def.updatedAt, b.session.updatedAt)
          : b.def.updatedAt
      return tb - ta
    })
    return items
  }, [managementSessions, defs, sessionIdsOwnedByDef])

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return mergedItems
    const q = searchQuery.toLowerCase()
    return mergedItems.filter((item) => {
      if (item.type === 'session') {
        const label = getWorkflowManagementSessionLabel(item.session)
        return label.toLowerCase().includes(q)
      }
      if (item.type === 'combined') {
        const label = getWorkflowManagementSessionLabel(item.session)
        return (
          item.def.name.toLowerCase().includes(q) ||
          (item.def.description ?? '').toLowerCase().includes(q) ||
          label.toLowerCase().includes(q)
        )
      }
      return (
        item.def.name.toLowerCase().includes(q) ||
        (item.def.description ?? '').toLowerCase().includes(q)
      )
    })
  }, [mergedItems, searchQuery])

  const makeDefMenuItems = useCallback(
    (def: WorkflowDefRecord): MenuProps['items'] => [
      {
        key: 'run',
        label: '运行',
        icon: <Play size={14} />,
        onClick: () => onRunWorkflow(def.name)
      },
      {
        key: 'edit',
        label: '编辑',
        icon: <Pencil size={14} />,
        onClick: () => {
          if (onOpenDefInTab) {
            onOpenDefInTab(def.id, def.name)
          } else {
            onSelectDef(def.id)
          }
        }
      },
      {
        key: 'delete',
        label: '删除',
        icon: <Trash2 size={14} />,
        danger: true,
        onClick: () => onDeleteDef(def.id)
      }
    ],
    [onRunWorkflow, onOpenDefInTab, onSelectDef, onDeleteDef]
  )

  return (
    <div className="wfp-sidebar">
      <div className="wfp-sidebar__search">
        <SearchInput
          placeholder="搜索工作流与会话…"
          value={searchQuery}
          onChange={onSearch}
          onSearch={onSearch}
        />
      </div>

      <div className="wfp-sidebar__section">
        <div className="wfp-sidebar__section-title">工作流与会话</div>
      </div>
      <div className="wfp-sidebar__list">
        {filteredItems.length === 0 && (
          <EmptyState
            description={searchQuery ? '无匹配结果' : '暂无工作流或会话'}
            className="wfp-sidebar__empty"
          />
        )}
        {filteredItems.map((item) => {
          if (item.type === 'session') {
            const label = getWorkflowManagementSessionLabel(item.session)
            const isSelected = item.session.id === selectedManagementSessionId
            return (
              <div
                key={`s-${item.session.id}`}
                className={`wfp-def-item wfp-def-item--session${
                  isSelected ? ' wfp-def-item--selected' : ''
                }`}
                onClick={() => {
                  const defId =
                    item.session.toolMeta?.workflowDefId || item.session.bgMeta?.workflowDefId
                  onSelectManagementSession(item.session.id, defId || null)
                }}
                role="button"
                tabIndex={0}
              >
                <Tag color="blue" style={{ flexShrink: 0, marginRight: 4 }}>
                  会话
                </Tag>
                <div className="wfp-def-item__info">
                  <span className="wfp-def-item__name">{label}</span>
                </div>
                <span className="wfp-def-item__time">
                  {formatRelativeTime(item.session.updatedAt)}
                </span>
                {onDeleteManagementSession && (
                  <ActionIcon
                    icon={Trash2}
                    size="small"
                    title="删除会话"
                    className="wfp-def-item__action"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteManagementSession(item.session.id)
                    }}
                  />
                )}
              </div>
            )
          }
          if (item.type === 'combined') {
            const { def, session } = item
            const isActive = activeDefNames.has(def.name)
            const isSelected =
              def.id === selectedDefId || session.id === selectedManagementSessionId
            return (
              <Dropdown
                key={`c-${def.id}`}
                menu={{ items: makeDefMenuItems(def) }}
                trigger={['contextMenu']}
              >
                <div
                  className={`wfp-def-item${isSelected ? ' wfp-def-item--selected' : ''}`}
                  onClick={() => onSelectDef(def.id, session.id)}
                  role="button"
                  tabIndex={0}
                >
                  <Tag color="cyan" style={{ flexShrink: 0, marginRight: 4 }}>
                    会话+定义
                  </Tag>
                  {isActive && <div className="wfp-def-item__dot" title="有活跃运行" />}
                  <div className="wfp-def-item__info">
                    <span className="wfp-def-item__name">{def.name}</span>
                    {def.description && (
                      <span className="wfp-def-item__desc">{def.description}</span>
                    )}
                  </div>
                  <span className="wfp-def-item__time">
                    {formatRelativeTime(Math.max(def.updatedAt, session.updatedAt))}
                  </span>
                </div>
              </Dropdown>
            )
          }
          const { def } = item
          const isActive = activeDefNames.has(def.name)
          const isSelected = def.id === selectedDefId
          return (
            <Dropdown
              key={`d-${def.id}`}
              menu={{ items: makeDefMenuItems(def) }}
              trigger={['contextMenu']}
            >
              <div
                className={`wfp-def-item${isSelected ? ' wfp-def-item--selected' : ''}`}
                onClick={() => onSelectDef(def.id)}
                role="button"
                tabIndex={0}
              >
                <Tag style={{ flexShrink: 0, marginRight: 4 }}>定义</Tag>
                {isActive && <div className="wfp-def-item__dot" title="有活跃运行" />}
                <div className="wfp-def-item__info">
                  <span className="wfp-def-item__name">{def.name}</span>
                  {def.description && <span className="wfp-def-item__desc">{def.description}</span>}
                </div>
                <span className="wfp-def-item__time">{formatRelativeTime(def.updatedAt)}</span>
              </div>
            </Dropdown>
          )
        })}
      </div>
      <div className="wfp-sidebar__footer">
        {onOpenRightPanel && !hideTabBarEntry && (
          <Button
            type="text"
            block
            icon={<Icon icon={PanelRightOpen} size={14} />}
            onClick={onOpenRightPanel}
            style={{ marginBottom: 6 }}
          >
            打开标签栏
          </Button>
        )}
        <Button
          type="dashed"
          block
          icon={<Icon icon={Plus} size={14} />}
          onClick={onOpenCreatePanel}
          style={{ marginBottom: 6 }}
        >
          新建工作流（图 / YAML）
        </Button>
        <Button
          type="text"
          block
          icon={<Icon icon={MessageSquare} size={14} />}
          onClick={onNewSession}
        >
          用对话创建
        </Button>
      </div>
    </div>
  )
})

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  return new Date(ts).toLocaleDateString()
}
