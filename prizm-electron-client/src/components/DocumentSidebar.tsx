/**
 * DocumentSidebar - 现代化文档侧边栏
 * 搜索 + 文档列表（LobeUI List + Dropdown 右键菜单）+ 折叠筛选面板
 */
import { useState, useCallback, useMemo } from 'react'
import { Dropdown, Select, type MenuProps } from 'antd'
import { ActionIcon, Button, Empty, Flexbox, Skeleton } from '@lobehub/ui'
import { AccentList } from './ui/AccentList'
import { Segmented } from './ui/Segmented'
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
  Filter
} from 'lucide-react'
import SearchInput from './ui/SearchInput'
import { useDocumentSearch } from '../hooks/useDocumentSearch'
import type { Document } from '@prizm/client-core'
import { createStyles } from 'antd-style'

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

function extractPreview(content?: string): string {
  if (!content) return ''
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#')) continue
    if (trimmed.startsWith('---')) continue
    if (trimmed.startsWith('```')) continue
    const cleaned = trimmed
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/[*_~`[\]]/g, '')
      .trim()
    if (cleaned.length > 0) return cleaned.slice(0, 80)
  }
  return ''
}

const useStyles = createStyles(({ css, token }) => ({
  filterPanel: css`
    padding: 6px 12px 8px;
    border-top: 1px solid ${token.colorBorderSecondary};
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: ${token.colorFillQuaternary};
  `,
  filterRow: css`
    display: flex;
    gap: 4px;
    align-items: center;
  `,
  emptyWrap: css`
    padding: 40px 20px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  `,
  emptyIcon: css`
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: ${token.colorFillQuaternary};
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${token.colorTextQuaternary};
  `
}))

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
  const { styles, cx } = useStyles()
  const [tab, setTab] = useState<SidebarTab>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('updatedAt')
  const [filterTag, setFilterTag] = useState<string | null>('')
  const [showFilters, setShowFilters] = useState(false)
  const { results: searchResults, loading: searchLoading, search } = useDocumentSearch(scope)

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

  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    documents.forEach((d) => d.tags?.forEach((t) => tagSet.add(t)))
    return Array.from(tagSet).sort()
  }, [documents])

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
          break
      }
    },
    [onRenameDoc, onDeleteDoc]
  )

  const hasActiveFilters = filterTag !== '' && filterTag !== null

  return (
    <Flexbox style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* Top action area */}
      <Flexbox
        gap={6}
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--ant-color-border-secondary)',
          flexShrink: 0
        }}
      >
        <Flexbox horizontal align="center" gap={4}>
          <SearchInput
            onSearch={handleSearch}
            placeholder="搜索文档..."
            loading={searchLoading}
            value={searchQuery}
            onChange={setSearchQuery}
          />
          <ActionIcon icon={Plus} title="新建文档" onClick={onCreateDoc} size="small" />
          <ActionIcon
            icon={RefreshCw}
            title="刷新"
            onClick={onRefresh}
            loading={loading}
            size="small"
          />
        </Flexbox>

        <Flexbox horizontal align="center" gap={4}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Segmented
              block
              size="small"
              value={tab === 'search' ? 'all' : tab}
              onChange={(v) => {
                setTab(v as SidebarTab)
                setSearchQuery('')
              }}
              options={[
                { label: '全部', value: 'all', icon: <FolderOpen size={12} /> },
                { label: '最近', value: 'recent', icon: <Clock size={12} /> }
              ]}
            />
          </div>
          {tab === 'all' && (
            <ActionIcon
              icon={Filter}
              title="筛选排序"
              size="small"
              onClick={() => setShowFilters((v) => !v)}
              style={
                hasActiveFilters
                  ? { color: 'var(--ant-color-primary)', background: 'var(--ant-color-primary-bg)' }
                  : undefined
              }
            />
          )}
        </Flexbox>
      </Flexbox>

      {/* Collapsible filter panel */}
      {tab === 'all' && showFilters && (
        <div className={styles.filterPanel}>
          <div className={styles.filterRow}>
            <Select
              size="small"
              value={sortMode}
              onChange={setSortMode}
              style={{ flex: 1, fontSize: 11 }}
              options={[
                { value: 'updatedAt', label: '更新时间' },
                { value: 'createdAt', label: '创建时间' },
                { value: 'title', label: '名称' }
              ]}
              suffixIcon={<SortAsc size={10} />}
              variant="borderless"
            />
            {allTags.length > 0 && (
              <Select
                size="small"
                value={filterTag}
                onChange={setFilterTag}
                style={{ flex: 1, fontSize: 11 }}
                options={[
                  { value: '', label: '全部标签' },
                  ...allTags.map((t) => ({ value: t, label: t }))
                ]}
                suffixIcon={<Tag size={10} />}
                allowClear
                placeholder="标签"
                variant="borderless"
              />
            )}
          </div>
        </div>
      )}

      {/* Document list */}
      <Flexbox flex={1} style={{ overflow: 'auto', minHeight: 0 }}>
        {loading && documents.length === 0 ? (
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
        ) : displayDocs.length === 0 ? (
          <div className={styles.emptyWrap}>
            <div className={styles.emptyIcon}>
              <FileText size={22} />
            </div>
            <Empty
              title={tab === 'search' ? '无搜索结果' : '暂无文档'}
              description={tab !== 'search' ? '创建你的第一个知识库文档' : undefined}
            />
            {tab !== 'search' && (
              <Button type="primary" size="small" icon={<Plus size={14} />} onClick={onCreateDoc}>
                创建文档
              </Button>
            )}
          </div>
        ) : (
          <Flexbox className="accent-list" gap={4} style={{ padding: 4 }}>
            {displayDocs.map((doc) => {
              const preview = extractPreview(doc.content)
              const isActive = activeDocId === doc.id
              return (
                <Dropdown
                  key={doc.id}
                  menu={{
                    items: getContextMenu(doc),
                    onClick: ({ key }) => handleContextMenuClick(doc, key)
                  }}
                  trigger={['contextMenu']}
                >
                  <div>
                    <AccentList.Item
                      key={doc.id}
                      active={isActive}
                      avatar={<FileText size={14} />}
                      title={doc.title || '无标题'}
                      description={
                        <>
                          {preview && (
                            <div style={{ fontSize: 11, lineHeight: 1.4 }}>{preview}</div>
                          )}
                          <div style={{ fontSize: 11, marginTop: 1 }}>
                            {new Date(doc.updatedAt).toLocaleDateString('zh-CN', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                            {doc.tags && doc.tags.length > 0 && (
                              <> · {doc.tags.slice(0, 2).join(', ')}</>
                            )}
                          </div>
                        </>
                      }
                      actions={
                        onDeleteDoc ? (
                          <ActionIcon
                            icon={Trash2}
                            title="删除"
                            size={{ blockSize: 24 }}
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation()
                              onDeleteDoc(doc)
                            }}
                          />
                        ) : undefined
                      }
                      showAction
                      onClick={() => onSelectDoc(doc)}
                    />
                  </div>
                </Dropdown>
              )
            })}
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  )
}
