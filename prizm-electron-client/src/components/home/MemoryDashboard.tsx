/**
 * MemoryDashboard — 首页记忆标签页
 *
 * 与 MemorySidebarPanel / MemoryInspector 设计对齐的仪表盘视图：
 *  - 内联搜索 + 管理入口
 *  - 画像标签云（profile 记忆）
 *  - 双环形分布图（按类型 / 按层级）
 *  - 层级探索卡片（SpotlightCard）
 *  - 最近记忆流（带层级 Segmented 过滤）
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Button, Icon, Popover, Tag } from '@lobehub/ui'
import { AccentSpotlightCard } from '../ui/AccentSpotlightCard'
import { Input } from 'antd'
import {
  Brain,
  ExternalLink,
  FileText,
  Layers,
  MessageSquare,
  RefreshCw,
  Search,
  Sparkles,
  User as UserIcon
} from 'lucide-react'
import { createStyles } from 'antd-style'
import { Segmented } from '../ui/Segmented'
import { usePrizmContext } from '../../context/PrizmContext'
import { useScope } from '../../hooks/useScope'
import { useNavigation } from '../../context/NavigationContext'
import { MemoryInspector } from '../agent/MemoryInspector'
import { MemoryRingChart, type RingSegment } from './MemoryRingChart'
import { SectionHeader } from '../ui/SectionHeader'
import { EmptyState } from '../ui/EmptyState'
import { LoadingPlaceholder } from '../ui/LoadingPlaceholder'
import { EASE_SMOOTH } from '../../theme/motionPresets'
import type { MemoryItem } from '@prizm/client-core'

type MemoryItemExt = MemoryItem & { memory_layer?: string; group_id?: string | null }

const TYPE_COLORS: Record<string, string> = {
  narrative: '#1677ff',
  foresight: '#722ed1',
  document: '#52c41a',
  event_log: '#13c2c2',
  profile: '#faad14'
}

const TYPE_LABELS: Record<string, string> = {
  narrative: '叙事记忆',
  foresight: '前瞻记忆',
  document: '文档记忆',
  event_log: '事件日志',
  profile: '用户画像'
}

const LAYER_KEYS = ['user', 'scopeChat', 'scopeDocument', 'session'] as const
type LayerKey = (typeof LAYER_KEYS)[number]

const LAYER_COLORS: Record<LayerKey, string> = {
  user: '#faad14',
  scopeChat: '#1677ff',
  scopeDocument: '#52c41a',
  session: '#13c2c2'
}

const LAYER_META: Record<LayerKey, { label: string; desc: string; icon: typeof Brain }> = {
  user: { label: 'User 层', desc: '用户画像 / 偏好', icon: UserIcon },
  scopeChat: { label: '对话层', desc: '工作区叙事 / 计划', icon: MessageSquare },
  scopeDocument: { label: '文档层', desc: '文档记忆 / 总览', icon: FileText },
  session: { label: 'Session 层', desc: '本次会话原子事实', icon: Layers }
}

type FeedFilter = 'all' | LayerKey

function classifyLayer(m: MemoryItemExt): LayerKey {
  const mt = m.memory_type || 'narrative'
  if (m.memory_layer === 'user') return 'user'
  if (m.memory_layer === 'session') return 'session'
  if (m.memory_layer === 'scope') return mt === 'document' ? 'scopeDocument' : 'scopeChat'
  const gid = m.group_id ?? ''
  if (!gid || gid === 'user') return 'user'
  if (gid.includes(':session:')) return 'session'
  return mt === 'document' ? 'scopeDocument' : 'scopeChat'
}

const useStyles = createStyles(({ css, token }) => ({
  dashboard: css`
    display: flex;
    flex-direction: column;
    gap: 20px;
  `,
  /* ── 搜索栏 ── */
  searchBar: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  searchInput: css`
    flex: 1;
  `,
  /* ── 搜索结果 ── */
  searchResults: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px;
    border-radius: 12px;
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
  `,
  searchResultsHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: ${token.colorTextSecondary};
    padding-bottom: 8px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    margin-bottom: 4px;
  `,
  /* ── 画像标签云 ── */
  profileCard: css`
    padding: 16px;
    border-radius: 12px;
    background: linear-gradient(
      135deg,
      ${token.colorWarningBg} 0%,
      ${token.colorWarningBgHover ?? token.colorWarningBg} 100%
    );
    border: 1px solid ${token.colorWarningBorder};
  `,
  profileHeader: css`
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  profileIcon: css`
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: ${token.colorBgContainer};
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${token.colorWarning};
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  `,
  profileTags: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  `,
  profileTag: css`
    max-width: 280px;
    padding: 5px 12px;
    border-radius: 16px;
    font-size: 12px;
    line-height: 1.4;
    color: ${token.colorText};
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    transition: all 0.15s;
    cursor: default;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);

    &:hover {
      border-color: ${token.colorWarningBorder};
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
    }
  `,
  profileEmpty: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
    padding: 4px 0;
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  /* ── 双环图 ── */
  ringGrid: css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  `,
  ringCard: css`
    padding: 16px;
    border-radius: 12px;
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
  `,
  /* ── 层级探索 ── */
  layerCard: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    height: 100%;
    cursor: pointer;
  `,
  layerCardHeader: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  layerCardIcon: css`
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  `,
  layerCardTitle: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorText};
    line-height: 1.2;
  `,
  layerCardCount: css`
    font-size: 20px;
    font-weight: 700;
    color: ${token.colorText};
    font-variant-numeric: tabular-nums;
    line-height: 1;
  `,
  layerCardDesc: css`
    font-size: 10px;
    color: ${token.colorTextQuaternary};
  `,
  layerCardSnippets: css`
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-height: 0;
  `,
  layerSnippet: css`
    font-size: 11px;
    line-height: 1.4;
    color: ${token.colorTextSecondary};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 3px 6px;
    border-radius: 4px;
    background: ${token.colorFillQuaternary};
  `,
  layerSnippetEmpty: css`
    font-size: 11px;
    color: ${token.colorTextQuaternary};
    padding: 3px 6px;
  `,
  /* ── 记忆流 ── */
  feedCard: css`
    padding: 16px;
    border-radius: 12px;
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    display: flex;
    flex-direction: column;
    gap: 10px;
  `,
  feedHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  feedFilter: css`
    margin-bottom: 2px;
  `,
  feedList: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  feedItem: css`
    padding: 10px 12px;
    border-radius: 8px;
    background: ${token.colorFillQuaternary};
    transition: background 0.15s;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  feedText: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${token.colorText};
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  `,
  feedMeta: css`
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 5px;
    font-size: 10px;
    color: ${token.colorTextQuaternary};
    flex-wrap: wrap;
  `,
  typeDot: css`
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
  `,
  sourceLink: css`
    display: inline-flex;
    align-items: center;
    gap: 2px;
    cursor: pointer;
    color: ${token.colorPrimary};

    &:hover {
      text-decoration: underline;
    }
  `,
  /* ── 类型汇总条 ── */
  typeSummary: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 11px;
    color: ${token.colorTextTertiary};
  `,
  typeSummaryItem: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
  `
}))

interface MemoryDashboardProps {
  visible: boolean
}

export function MemoryDashboard({ visible }: MemoryDashboardProps) {
  const { styles } = useStyles()
  const { manager } = usePrizmContext()
  const { currentScope } = useScope()
  const { navigateToAgentMessage } = useNavigation()
  const http = manager?.getHttpClient()

  const [memories, setMemories] = useState<MemoryItemExt[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<MemoryItemExt[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all')

  const loadMemories = useCallback(async () => {
    if (!http) return
    setLoading(true)
    try {
      const res = await http.getMemories(currentScope)
      if (res.enabled) {
        setMemories(res.memories as MemoryItemExt[])
      } else {
        setMemories([])
      }
    } catch {
      setMemories([])
    } finally {
      setLoading(false)
    }
  }, [http, currentScope])

  useEffect(() => {
    if (visible) void loadMemories()
  }, [visible, loadMemories])

  const handleSearch = useCallback(async () => {
    if (!http || !searchQuery.trim()) return
    setSearchLoading(true)
    try {
      const res = await http.searchMemories(searchQuery.trim(), currentScope, {
        method: 'hybrid',
        limit: 15
      })
      setSearchResults((res.memories ?? []) as MemoryItemExt[])
    } catch {
      setSearchResults([])
    } finally {
      setSearchLoading(false)
    }
  }, [http, searchQuery, currentScope])

  const clearSearch = useCallback(() => {
    setSearchQuery('')
    setSearchResults(null)
  }, [])

  /* ── 数据派生 ── */
  const profileMemories = useMemo(
    () => memories.filter((m) => m.memory_type === 'profile').slice(0, 12),
    [memories]
  )

  const typeSegments = useMemo<RingSegment[]>(() => {
    const counts: Record<string, number> = {}
    for (const m of memories) {
      const t = m.memory_type || 'narrative'
      counts[t] = (counts[t] || 0) + 1
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => ({
        key,
        label: TYPE_LABELS[key] ?? key,
        value,
        color: TYPE_COLORS[key] ?? '#999'
      }))
  }, [memories])

  const layerSegments = useMemo<RingSegment[]>(() => {
    const counts: Record<string, number> = { user: 0, scopeChat: 0, scopeDocument: 0, session: 0 }
    for (const m of memories) counts[classifyLayer(m)]++
    return LAYER_KEYS.map((key) => ({
      key,
      label: LAYER_META[key].label,
      value: counts[key],
      color: LAYER_COLORS[key]
    }))
  }, [memories])

  const layerGroups = useMemo(() => {
    const groups: Record<LayerKey, MemoryItemExt[]> = {
      user: [],
      scopeChat: [],
      scopeDocument: [],
      session: []
    }
    for (const m of memories) groups[classifyLayer(m)].push(m)
    return groups
  }, [memories])

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const m of memories) {
      const t = m.memory_type || 'narrative'
      counts[t] = (counts[t] || 0) + 1
    }
    return counts
  }, [memories])

  const filteredFeed = useMemo(() => {
    const sorted = [...memories].sort(
      (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
    )
    if (feedFilter === 'all') return sorted.slice(0, 8)
    return sorted.filter((m) => classifyLayer(m) === feedFilter).slice(0, 8)
  }, [memories, feedFilter])

  if (loading) return <LoadingPlaceholder />

  if (memories.length === 0 && !loading) {
    return (
      <div className={styles.dashboard}>
        <EmptyState icon={Brain} description="暂无记忆数据，与 Agent 对话后将自动生成" />
      </div>
    )
  }

  const renderFeedItem = (mem: MemoryItemExt, i: number) => (
    <motion.div
      key={mem.id}
      className={styles.feedItem}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, delay: i * 0.03, ease: EASE_SMOOTH }}
    >
      <div className={styles.feedText}>{mem.memory}</div>
      <div className={styles.feedMeta}>
        {mem.memory_type && (
          <>
            <span
              className={styles.typeDot}
              style={{ background: TYPE_COLORS[mem.memory_type] ?? '#94a3b8' }}
            />
            <span>{TYPE_LABELS[mem.memory_type] ?? mem.memory_type}</span>
          </>
        )}
        <Tag size="small" style={{ fontSize: 10, lineHeight: 1 }}>
          {LAYER_META[classifyLayer(mem)]?.label ?? '未知'}
        </Tag>
        {mem.ref_count != null && mem.ref_count > 0 && <span>引用 {mem.ref_count}次</span>}
        {mem.created_at && <span>{new Date(mem.created_at).toLocaleDateString()}</span>}
        {(mem as any).source_session_id &&
          ((mem as any).source_round_id || (mem as any).source_round_ids?.length > 0) && (
            <Popover
              content={`来源会话: ${((mem as any).source_session_id as string).slice(0, 8)}...`}
            >
              <span
                className={styles.sourceLink}
                onClick={() => {
                  const sessionId = (mem as any).source_session_id as string
                  const messageId =
                    (mem as any).source_round_id ?? (mem as any).source_round_ids?.[0]
                  if (sessionId && messageId) navigateToAgentMessage(sessionId, messageId)
                }}
              >
                <ExternalLink size={9} />
                来源
              </span>
            </Popover>
          )}
      </div>
    </motion.div>
  )

  return (
    <div className={styles.dashboard}>
      {/* ── 内联搜索 + 管理入口 ── */}
      <div className={styles.searchBar}>
        <Input
          className={styles.searchInput}
          placeholder="搜索记忆..."
          prefix={<Search size={14} style={{ color: 'var(--ant-color-text-quaternary)' }} />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onPressEnter={() => void handleSearch()}
          allowClear
          onClear={clearSearch}
        />
        <Button
          type="primary"
          size="middle"
          loading={searchLoading}
          onClick={() => void handleSearch()}
        >
          查询
        </Button>
        <Button size="middle" onClick={() => setInspectorOpen(true)}>
          管理全部记忆
        </Button>
      </div>

      {/* ── 搜索结果 ── */}
      {searchResults != null && (
        <div className={styles.searchResults}>
          <div className={styles.searchResultsHeader}>
            <span>搜索结果: {searchResults.length} 条</span>
            <Button size="small" type="text" onClick={clearSearch}>
              清除搜索
            </Button>
          </div>
          {searchResults.length === 0 ? (
            <EmptyState description="未找到匹配记忆" />
          ) : (
            <AnimatePresence mode="popLayout">
              {searchResults.slice(0, 10).map((mem, i) => renderFeedItem(mem, i))}
            </AnimatePresence>
          )}
        </div>
      )}

      {/* ── 仪表盘内容 ── */}
      {searchResults == null && (
        <>
          {/* 画像标签云 */}
          <div className={styles.profileCard}>
            <div className={styles.profileHeader}>
              <div className={styles.profileIcon}>
                <UserIcon size={14} />
              </div>
              Agent 认识的你
            </div>
            {profileMemories.length === 0 ? (
              <div className={styles.profileEmpty}>
                <Sparkles size={12} />与 Agent 多聊聊，它会逐渐了解你的偏好和习惯
              </div>
            ) : (
              <div className={styles.profileTags}>
                {profileMemories.map((m) => (
                  <Popover key={m.id} content={m.memory}>
                    <div className={styles.profileTag}>{(m.memory ?? '').slice(0, 30)}</div>
                  </Popover>
                ))}
              </div>
            )}
          </div>

          {/* 类型汇总条 */}
          <div className={styles.typeSummary}>
            {Object.entries(typeCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <span key={type} className={styles.typeSummaryItem}>
                  <span
                    className={styles.typeDot}
                    style={{ background: TYPE_COLORS[type] ?? '#94a3b8' }}
                  />
                  {TYPE_LABELS[type] ?? type} {count}
                </span>
              ))}
            <span style={{ marginLeft: 'auto', fontWeight: 600 }}>共 {memories.length} 条</span>
          </div>

          {/* 双环分布图 */}
          <div className={styles.ringGrid}>
            <div className={styles.ringCard}>
              <MemoryRingChart segments={typeSegments} title="按类型分布" size={110} />
            </div>
            <div className={styles.ringCard}>
              <MemoryRingChart segments={layerSegments} title="按层级分布" size={110} />
            </div>
          </div>

          {/* 层级探索卡片 — SpotlightCard */}
          <div>
            <SectionHeader icon={Layers} title="层级探索" />
            <AccentSpotlightCard
              items={LAYER_KEYS.map((k) => ({ layer: k }))}
              renderItem={({ layer }: { layer: LayerKey }) => {
                const meta = LAYER_META[layer]
                const items = layerGroups[layer]
                const LIcon = meta.icon
                return (
                  <div className={styles.layerCard} onClick={() => setInspectorOpen(true)}>
                    <div className={styles.layerCardHeader}>
                      <div
                        className={styles.layerCardIcon}
                        style={{
                          background: LAYER_COLORS[layer] + '18',
                          color: LAYER_COLORS[layer]
                        }}
                      >
                        <LIcon size={16} />
                      </div>
                      <div className={styles.layerCardTitle}>{meta.label}</div>
                    </div>
                    <div className={styles.layerCardCount}>{items.length}</div>
                    <div className={styles.layerCardDesc}>{meta.desc}</div>
                    <div className={styles.layerCardSnippets}>
                      {items.length === 0 ? (
                        <div className={styles.layerSnippetEmpty}>暂无记忆</div>
                      ) : (
                        items.slice(0, 2).map((m) => (
                          <div key={m.id} className={styles.layerSnippet}>
                            {(m.memory ?? '').slice(0, 40)}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )
              }}
              columns={4}
              gap="12px"
              size={400}
              borderRadius={12}
            />
          </div>

          {/* 最近记忆流 */}
          <div className={styles.feedCard}>
            <div className={styles.feedHeader}>
              <SectionHeader icon={Brain} title="最近记忆" />
              <Button
                size="small"
                type="text"
                icon={<Icon icon={RefreshCw} size="small" />}
                onClick={() => void loadMemories()}
              >
                刷新
              </Button>
            </div>
            <Segmented
              className={styles.feedFilter}
              size="small"
              value={feedFilter}
              onChange={(v) => setFeedFilter(v as FeedFilter)}
              options={[
                { label: '全部', value: 'all' },
                { label: `User ${layerGroups.user.length}`, value: 'user' },
                { label: `对话 ${layerGroups.scopeChat.length}`, value: 'scopeChat' },
                { label: `文档 ${layerGroups.scopeDocument.length}`, value: 'scopeDocument' },
                { label: `Session ${layerGroups.session.length}`, value: 'session' }
              ]}
            />
            <div className={styles.feedList}>
              {filteredFeed.length === 0 ? (
                <EmptyState description="该层级暂无记忆" />
              ) : (
                <AnimatePresence mode="popLayout">
                  {filteredFeed.map((mem, i) => renderFeedItem(mem, i))}
                </AnimatePresence>
              )}
            </div>
          </div>
        </>
      )}

      {/* MemoryInspector ModalSidebar */}
      <MemoryInspector
        externalOpen={inspectorOpen}
        onExternalClose={() => setInspectorOpen(false)}
      />
    </div>
  )
}
