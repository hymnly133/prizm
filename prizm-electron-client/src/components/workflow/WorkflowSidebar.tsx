/**
 * WorkflowSidebar — 左侧定义列表导航
 *
 * 搜索过滤、定义列表（含活跃运行指示器）、右键菜单、新建按钮。
 */

import { memo, useMemo, useCallback, useState, useRef, useEffect } from 'react'
import { Button, Popconfirm } from 'antd'
import { Plus, Play, Pencil, Trash2 } from 'lucide-react'
import { Icon } from '@lobehub/ui'
import type { WorkflowDefRecord, WorkflowRun } from '@prizm/shared'
import SearchInput from '../ui/SearchInput'

export interface WorkflowSidebarProps {
  defs: WorkflowDefRecord[]
  runs: WorkflowRun[]
  selectedDefId: string | null
  searchQuery: string
  onSearch: (q: string) => void
  onSelectDef: (defId: string) => void
  onNewWorkflow: () => void
  onRunWorkflow: (name: string) => void
  onDeleteDef: (defId: string) => void
}

export const WorkflowSidebar = memo(function WorkflowSidebar({
  defs,
  runs,
  selectedDefId,
  searchQuery,
  onSearch,
  onSelectDef,
  onNewWorkflow,
  onRunWorkflow,
  onDeleteDef
}: WorkflowSidebarProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    def: WorkflowDefRecord
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const activeDefNames = useMemo(() => {
    const names = new Set<string>()
    for (const run of runs) {
      if (run.status === 'running' || run.status === 'paused' || run.status === 'pending') {
        names.add(run.workflowName)
      }
    }
    return names
  }, [runs])

  const filteredDefs = useMemo(() => {
    if (!searchQuery.trim()) return defs
    const q = searchQuery.toLowerCase()
    return defs.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.description ?? '').toLowerCase().includes(q)
    )
  }, [defs, searchQuery])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, def: WorkflowDefRecord) => {
      e.preventDefault()
      e.stopPropagation()
      setContextMenu({ x: e.clientX, y: e.clientY, def })
    },
    []
  )

  useEffect(() => {
    if (!contextMenu) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [contextMenu])

  return (
    <div className="wfp-sidebar">
      <div className="wfp-sidebar__search">
        <SearchInput
          placeholder="搜索工作流…"
          value={searchQuery}
          onChange={onSearch}
          onSearch={onSearch}
        />
      </div>
      <div className="wfp-sidebar__list">
        {filteredDefs.length === 0 && (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--ant-color-text-quaternary)', fontSize: 13 }}>
            {searchQuery ? '无匹配结果' : '暂无工作流定义'}
          </div>
        )}
        {filteredDefs.map((def) => {
          const isActive = activeDefNames.has(def.name)
          const isSelected = def.id === selectedDefId
          return (
            <div
              key={def.id}
              className={`wfp-def-item${isSelected ? ' wfp-def-item--selected' : ''}`}
              onClick={() => onSelectDef(def.id)}
              onContextMenu={(e) => handleContextMenu(e, def)}
              role="button"
              tabIndex={0}
            >
              {isActive && <div className="wfp-def-item__dot" title="有活跃运行" />}
              <div className="wfp-def-item__info">
                <span className="wfp-def-item__name">{def.name}</span>
                {def.description && (
                  <span className="wfp-def-item__desc">{def.description}</span>
                )}
              </div>
              <span className="wfp-def-item__time">
                {formatRelativeTime(def.updatedAt)}
              </span>
            </div>
          )
        })}
      </div>
      <div className="wfp-sidebar__footer">
        <Button
          type="dashed"
          block
          icon={<Icon icon={Plus} size={14} />}
          onClick={onNewWorkflow}
        >
          新建工作流
        </Button>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="wfp-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="wfp-context-menu__item"
            onClick={() => {
              onRunWorkflow(contextMenu.def.name)
              setContextMenu(null)
            }}
          >
            <Play size={14} /> 运行
          </button>
          <button
            className="wfp-context-menu__item"
            onClick={() => {
              onSelectDef(contextMenu.def.id)
              setContextMenu(null)
            }}
          >
            <Pencil size={14} /> 编辑
          </button>
          <button
            className="wfp-context-menu__item wfp-context-menu__item--danger"
            onClick={() => {
              onDeleteDef(contextMenu.def.id)
              setContextMenu(null)
            }}
          >
            <Trash2 size={14} /> 删除
          </button>
        </div>
      )}
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
