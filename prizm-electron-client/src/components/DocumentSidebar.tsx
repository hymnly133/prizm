/**
 * DocumentSidebar - 文档侧边栏
 * 搜索 + 排序 + 标签筛选 + 文档列表 + 右键菜单 + 空状态引导
 */
import { useState, useCallback, useMemo, useEffect } from 'react'
import { Button, Tooltip, Dropdown, Select, type MenuProps } from 'antd'
import { Flexbox, Skeleton } from '@lobehub/ui'
import {
  FileText,
  Plus,
  Clock,
  FolderOpen,
  RefreshCw,
  SortAsc,
  Tag,
  Trash2,
  Pencil,
  MessageSquare,
  FilePlus2
} from 'lucide-react'
import SearchInput from './ui/SearchInput'
import { useDocumentSearch } from '../hooks/useDocumentSearch'
import { subscribeSyncEvents } from '../events/syncEventEmitter'
import type { Document } from '@prizm/client-core'

interface DocumentSidebarProps {
  documents: Document[]
  loading: boolean
  activeDocId: string | null
  scope: string
  onSelectDoc: (doc: Document) => void
  onCreateDoc: () => void
  onRefresh: () => void
  onDeleteDoc?: (doc: Document) => void
  onRenameDoc?: (doc: Document) => void
}

type SidebarTab = 'all' | 'recent' | 'search'
type SortMode = 'updatedAt' | 'createdAt' | 'title'

export default function DocumentSidebar({
  documents,
  loading,
  activeDocId,
  scope,
  onSelectDoc,
  onCreateDoc,
  onRefresh,
  onDeleteDoc,
  onRenameDoc
}: DocumentSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('updatedAt')
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const { results: searchResults, loading: searchLoading, search } = useDocumentSearch(scope)

  // WebSocket: 自动刷新
  useEffect(() => {
    const unsub = subscribeSyncEvents((eventType) => {
      if (
        eventType === 'document:created' ||
        eventType === 'document:updated' ||
        eventType === 'document:deleted'
      ) {
        onRefresh()
      }
    })
    return unsub
  }, [onRefresh])

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query)
      if (query.trim()) {
        setTab('search')
        search(query)
      } else {
        setTab('all')
      }
    },
    [search]
  )

  // 提取所有标签
  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    documents.forEach((d) => d.tags?.forEach((t) => tagSet.add(t)))
    return Array.from(tagSet).sort()
  }, [documents])

  // 排序文档
  const sortedDocs = useMemo(() => {
    const docs = [...documents]
    switch (sortMode) {
      case 'updatedAt':
        return docs.sort((a, b) => b.updatedAt - a.updatedAt)
      case 'createdAt':
        return docs.sort((a, b) => b.createdAt - a.createdAt)
      case 'title':
        return docs.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    }
  }, [documents, sortMode])

  // 筛选标签
  const filteredDocs = useMemo(() => {
    if (!filterTag) return sortedDocs
    return sortedDocs.filter((d) => d.tags?.includes(filterTag))
  }, [sortedDocs, filterTag])

  const recentDocs = useMemo(
    () => [...documents].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10),
    [documents]
  )

  const displayDocs = useMemo(() => {
    if (tab === 'search') {
      return searchResults
        .map((r) => documents.find((d) => d.id === r.id))
        .filter(Boolean) as Document[]
    }
    if (tab === 'recent') return recentDocs
    return filteredDocs
  }, [tab, filteredDocs, recentDocs, searchResults, documents])

  // 右键菜单
  const getContextMenu = useCallback(
    (doc: Document): MenuProps['items'] => [
      ...(onRenameDoc ? [{ key: 'rename', icon: <Pencil size={12} />, label: '重命名' }] : []),
      { key: 'chat', icon: <MessageSquare size={12} />, label: '在 Agent 中对话' },
      { type: 'divider' as const },
      ...(onDeleteDoc
        ? [{ key: 'delete', icon: <Trash2 size={12} />, label: '删除', danger: true }]
        : [])
    ],
    [onRenameDoc, onDeleteDoc]
  )

  const handleContextMenuClick = useCallback(
    (doc: Document, key: string) => {
      switch (key) {
        case 'rename':
          onRenameDoc?.(doc)
          break
        case 'delete':
          onDeleteDoc?.(doc)
          break
        case 'chat':
          // 留给未来集成
          break
      }
    },
    [onRenameDoc, onDeleteDoc]
  )

  return (
    <div className="doc-sidebar">
      {/* 顶部操作区 */}
      <div className="doc-sidebar-header">
        <Flexbox horizontal align="center" gap={4} style={{ padding: '8px 12px' }}>
          <SearchInput
            onSearch={handleSearch}
            placeholder="搜索文档..."
            loading={searchLoading}
            value={searchQuery}
            onChange={setSearchQuery}
          />
          <Tooltip title="新建文档">
            <Button type="text" size="small" icon={<Plus size={16} />} onClick={onCreateDoc} />
          </Tooltip>
          <Tooltip title="刷新">
            <Button
              type="text"
              size="small"
              icon={<RefreshCw size={14} />}
              onClick={onRefresh}
              loading={loading}
            />
          </Tooltip>
        </Flexbox>

        {/* 标签切换 */}
        <Flexbox horizontal gap={0} style={{ padding: '0 12px 4px' }}>
          <TabButton
            active={tab === 'all'}
            onClick={() => {
              setTab('all')
              setSearchQuery('')
            }}
            icon={<FolderOpen size={12} />}
            label="全部"
          />
          <TabButton
            active={tab === 'recent'}
            onClick={() => {
              setTab('recent')
              setSearchQuery('')
            }}
            icon={<Clock size={12} />}
            label="最近"
          />
        </Flexbox>

        {/* 排序 + 标签筛选 */}
        {tab === 'all' && (
          <Flexbox horizontal gap={4} align="center" style={{ padding: '0 12px 6px' }}>
            <Tooltip title="排序方式">
              <Select
                size="small"
                value={sortMode}
                onChange={setSortMode}
                style={{ width: 100, fontSize: 11 }}
                options={[
                  { value: 'updatedAt', label: '更新时间' },
                  { value: 'createdAt', label: '创建时间' },
                  { value: 'title', label: '名称' }
                ]}
                suffixIcon={<SortAsc size={10} />}
                variant="borderless"
              />
            </Tooltip>
            {allTags.length > 0 && (
              <Select
                size="small"
                value={filterTag}
                onChange={setFilterTag}
                style={{ flex: 1, fontSize: 11 }}
                options={[
                  { value: null as unknown as string, label: '全部标签' },
                  ...allTags.map((t) => ({ value: t, label: t }))
                ]}
                suffixIcon={<Tag size={10} />}
                allowClear
                placeholder="标签"
                variant="borderless"
              />
            )}
          </Flexbox>
        )}
      </div>

      {/* 文档列表 */}
      <div className="doc-sidebar-list">
        {loading && documents.length === 0 && (
          <div style={{ padding: '8px 12px' }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} style={{ marginBottom: 16 }}>
                <Skeleton
                  active
                  title={{ width: '70%' }}
                  paragraph={{ rows: 1, width: '50%' }}
                  avatar={false}
                />
              </div>
            ))}
          </div>
        )}

        {displayDocs.length === 0 && !loading && (
          <div className="doc-sidebar-empty-guide">
            <FilePlus2 size={28} style={{ opacity: 0.25, marginBottom: 8 }} />
            <p style={{ fontSize: 13, fontWeight: 500 }}>
              {tab === 'search' ? '无搜索结果' : '暂无文档'}
            </p>
            {tab !== 'search' && (
              <>
                <p style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary)', marginTop: 4 }}>
                  创建你的第一个知识库文档
                </p>
                <Button
                  type="primary"
                  size="small"
                  icon={<Plus size={14} />}
                  onClick={onCreateDoc}
                  style={{ marginTop: 12 }}
                >
                  创建文档
                </Button>
              </>
            )}
          </div>
        )}

        {displayDocs.map((doc) => (
          <Dropdown
            key={doc.id}
            menu={{
              items: getContextMenu(doc),
              onClick: ({ key }) => handleContextMenuClick(doc, key)
            }}
            trigger={['contextMenu']}
          >
            <div
              className={`doc-sidebar-item${
                activeDocId === doc.id ? ' doc-sidebar-item--active' : ''
              }`}
              onClick={() => onSelectDoc(doc)}
            >
              <FileText size={14} className="doc-sidebar-item-icon" />
              <div className="doc-sidebar-item-content">
                <div className="doc-sidebar-item-title">{doc.title || '无标题'}</div>
                <div className="doc-sidebar-item-meta">
                  {new Date(doc.updatedAt).toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                  {doc.tags && doc.tags.length > 0 && (
                    <span className="doc-sidebar-item-tags">{doc.tags.slice(0, 2).join(', ')}</span>
                  )}
                </div>
              </div>
            </div>
          </Dropdown>
        ))}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      className={`doc-sidebar-tab${active ? ' doc-sidebar-tab--active' : ''}`}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
