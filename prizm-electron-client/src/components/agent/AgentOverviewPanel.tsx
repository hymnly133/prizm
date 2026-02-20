/**
 * Agent 总览面板 — 仪表盘风格
 * SpotlightCard 统计 + Token 仪表盘 + 记忆面板 + 上下文预览
 */
import { useCallback, useState } from 'react'
import { motion } from 'motion/react'
import { Flexbox } from '@lobehub/ui'
import { Modal } from '@lobehub/ui'
import { AccentSpotlightCard } from '../ui/AccentSpotlightCard'
import { Tag } from 'antd'
import {
  Activity,
  BarChart3,
  Brain,
  Coins,
  Eye,
  FileText,
  Layers,
  MessageSquare,
  Sparkles,
  User as UserIcon,
  Zap
} from 'lucide-react'
import { useNavigation } from '../../context/NavigationContext'
import { useAgentOverviewData } from '../../hooks/useAgentOverviewData'
import { MemoryInspector } from './MemoryInspector'
import { MemorySidebarPanel } from './MemorySidebarPanel'
import { TokenDashboard } from './TokenDashboard'
import { BackgroundTasksPanel } from './BackgroundTasksPanel'
import { AnimatedCounter } from './AnimatedCounter'
import { Select } from '../ui/Select'
import { EmptyState } from '../ui/EmptyState'
import { RefreshIconButton } from '../ui/RefreshIconButton'
import { LoadingPlaceholder } from '../ui/LoadingPlaceholder'
import { fadeUp, STAGGER_DELAY } from '../../theme/motionPresets'
import type { AvailableModel } from '@prizm/client-core'

interface AgentOverviewPanelProps {
  selectedModel?: string
  onModelChange?: (model: string | undefined) => void
  onLoadSession?: (id: string) => void
}

export function AgentOverviewPanel({ selectedModel, onModelChange, onLoadSession }: AgentOverviewPanelProps) {
  const { navigateToDocs } = useNavigation()
  const {
    currentScope,
    scopeContext,
    scopeContextLoading,
    loadScopeContext,
    documents,
    documentsLoading,
    loadDocuments,
    models,
    defaultModel,
    memoryEnabled,
    userMemoryCount,
    scopeMemoryCount,
    scopeChatMemoryCount,
    scopeDocumentMemoryCount,
    sessionMemoryCount,
    memoryByType,
    memoryCountsLoading,
    loadMemoryCounts,
    sessionsCount,
    sessionsCountLoading,
    loadSessionsCount
  } = useAgentOverviewData()

  const [contextModalOpen, setContextModalOpen] = useState(false)
  const [memoryInspectorOpen, setMemoryInspectorOpen] = useState(false)

  const handleRefreshAll = useCallback(() => {
    void loadScopeContext()
    void loadDocuments()
    void loadMemoryCounts()
    void loadSessionsCount()
  }, [loadScopeContext, loadDocuments, loadMemoryCounts, loadSessionsCount])

  let idx = 0

  return (
    <div className="overview-panel">
      {/* Hero Header */}
      <motion.div className="overview-panel-header" {...fadeUp(idx++ * STAGGER_DELAY)}>
        <Flexbox horizontal align="center" gap={12}>
          <BarChart3 size={22} style={{ color: 'var(--ant-color-primary)' }} />
          <div>
            <h2 className="overview-panel-title">工作区总览</h2>
            <Flexbox horizontal align="center" gap={8} style={{ marginTop: 2 }}>
              <Tag color="blue">{currentScope || 'default'}</Tag>
              {onModelChange && (
                <Select
                  options={[
                    { label: defaultModel ? `默认 (${defaultModel})` : '默认', value: '' },
                    ...models.map((m: AvailableModel) => ({ label: m.label, value: m.id }))
                  ]}
                  value={selectedModel ?? ''}
                  onChange={(v) => onModelChange(v || undefined)}
                  style={{ width: 160 }}
                />
              )}
            </Flexbox>
          </div>
        </Flexbox>
        <RefreshIconButton onClick={handleRefreshAll} title="刷新所有数据" />
      </motion.div>

      {/* Statistics - SpotlightCard grid */}
      <motion.div {...fadeUp(idx++ * STAGGER_DELAY)}>
        <AccentSpotlightCard
          items={[
            { id: 'sessions' },
            { id: 'documents' },
            { id: 'profile' },
            { id: 'narrative' },
            { id: 'foresight' },
            { id: 'docMem' },
            { id: 'eventLog' }
          ]}
          renderItem={({ id }) => {
            const configs: Record<
              string,
              {
                icon: React.ReactNode
                label: string
                value: number
                loading: boolean
                color: string
                desc?: string
              }
            > = {
              sessions: {
                icon: <MessageSquare size={20} />,
                label: '会话数',
                value: sessionsCount,
                loading: sessionsCountLoading,
                color: 'var(--ant-color-primary)'
              },
              documents: {
                icon: <FileText size={20} />,
                label: '文档数',
                value: documents.length,
                loading: documentsLoading,
                color: 'var(--ant-color-success)'
              },
              profile: {
                icon: <UserIcon size={20} />,
                label: '画像',
                value: memoryByType.profile,
                loading: memoryCountsLoading,
                color: 'var(--ant-color-warning)',
                desc: 'profile'
              },
              narrative: {
                icon: <Sparkles size={20} />,
                label: '叙事',
                value: memoryByType.narrative,
                loading: memoryCountsLoading,
                color: 'var(--ant-geekblue-6, #2f54eb)',
                desc: 'narrative'
              },
              foresight: {
                icon: <Eye size={20} />,
                label: '前瞻',
                value: memoryByType.foresight,
                loading: memoryCountsLoading,
                color: 'var(--ant-cyan-6, #13c2c2)',
                desc: 'foresight'
              },
              docMem: {
                icon: <Brain size={20} />,
                label: '文档记忆',
                value: memoryByType.document,
                loading: memoryCountsLoading,
                color: 'var(--ant-color-success)',
                desc: 'document'
              },
              eventLog: {
                icon: <Activity size={20} />,
                label: '事件日志',
                value: memoryByType.event_log,
                loading: memoryCountsLoading,
                color: 'var(--ant-magenta-6, #eb2f96)',
                desc: 'event_log'
              }
            }
            const c = configs[id as string]
            if (!c) return null
            return (
              <div className="stat-card">
                <div className="stat-card__icon" style={{ color: c.color }}>
                  {c.icon}
                </div>
                <div className="stat-card__info">
                  {c.loading ? (
                    <span className="stat-card__value">...</span>
                  ) : (
                    <AnimatedCounter
                      value={c.value}
                      format={(n) => String(Math.round(n))}
                      className="stat-card__value"
                    />
                  )}
                  <span className="stat-card__label">{c.label}</span>
                  {c.desc && <span className="stat-card__desc">{c.desc}</span>}
                </div>
              </div>
            )
          }}
          columns={4}
          gap="12px"
          size={400}
          borderRadius={12}
        />
      </motion.div>

      {/* Two-column: Token Dashboard + Memory Panel */}
      <div className="overview-grid" style={{ marginTop: 16 }}>
        {/* Token Dashboard */}
        <motion.div className="content-card content-card--default content-card--hoverable" {...fadeUp(idx++ * STAGGER_DELAY)}>
          <div className="content-card__header">
            <Coins size={16} />
            <span>Token 使用</span>
          </div>
          <div className="content-card__body overview-card-body-scroll">
            <TokenDashboard />
          </div>
        </motion.div>

        {/* Memory Panel */}
        <motion.div className="content-card content-card--default content-card--hoverable" {...fadeUp(idx++ * STAGGER_DELAY)}>
          <div className="content-card__header">
            <Brain size={16} />
            <span>记忆系统</span>
            <span style={{ marginLeft: 'auto' }}>
              <RefreshIconButton
                onClick={() => void loadMemoryCounts()}
                disabled={memoryCountsLoading}
                title="刷新记忆"
                size={12}
              />
            </span>
          </div>
          <div className="content-card__body overview-card-body-scroll">
            <MemorySidebarPanel
              memoryEnabled={memoryEnabled}
              userMemoryCount={userMemoryCount}
              scopeMemoryCount={scopeMemoryCount}
              scopeChatMemoryCount={scopeChatMemoryCount}
              scopeDocumentMemoryCount={scopeDocumentMemoryCount}
              sessionMemoryCount={sessionMemoryCount}
              memoryByType={memoryByType}
              memoryCountsLoading={memoryCountsLoading}
              onOpenInspector={() => setMemoryInspectorOpen(true)}
            />
          </div>
        </motion.div>

        {/* Background Tasks Panel */}
        <motion.div className="content-card content-card--default content-card--hoverable" {...fadeUp(idx++ * STAGGER_DELAY)}>
          <div className="content-card__header">
            <Zap size={16} />
            <span>后台任务</span>
          </div>
          <div className="content-card__body overview-card-body-scroll">
            <BackgroundTasksPanel onLoadSession={onLoadSession} />
          </div>
        </motion.div>

        {/* Context Preview */}
        <motion.div className="content-card content-card--default content-card--hoverable" {...fadeUp(idx++ * STAGGER_DELAY)}>
          <div className="content-card__header">
            <Layers size={16} />
            <span>工作区上下文</span>
            <span style={{ marginLeft: 'auto' }}>
              <RefreshIconButton
                onClick={() => void loadScopeContext()}
                disabled={scopeContextLoading}
                title="刷新上下文"
                size={12}
              />
            </span>
          </div>
          <div className="content-card__body">
            {scopeContextLoading ? (
              <LoadingPlaceholder />
            ) : scopeContext ? (
              <div
                className="overview-context-preview"
                role="button"
                tabIndex={0}
                onClick={() => setContextModalOpen(true)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setContextModalOpen(true)}
              >
                <pre className="overview-context-text">{scopeContext}</pre>
                <span className="overview-context-hint">点击查看完整预览</span>
              </div>
            ) : (
              <EmptyState description="当前 scope 无便签/待办/文档" />
            )}
          </div>
        </motion.div>

        {/* Documents List */}
        <motion.div className="content-card content-card--default content-card--hoverable" {...fadeUp(idx++ * STAGGER_DELAY)}>
          <div className="content-card__header">
            <FileText size={16} />
            <span>文档</span>
            <Tag style={{ marginLeft: 'auto', marginRight: 0 }}>
              {documentsLoading ? '...' : documents.length}
            </Tag>
            <RefreshIconButton
              onClick={() => void loadDocuments()}
              disabled={documentsLoading}
              title="刷新文档"
              size={12}
            />
          </div>
          <div className="content-card__body">
            {documentsLoading ? (
              <LoadingPlaceholder />
            ) : documents.length === 0 ? (
              <EmptyState description="暂无文档" />
            ) : (
              <ul className="overview-doc-list overview-doc-list-horizontal">
                {documents.map((doc) => (
                  <li
                    key={doc.id}
                    className="overview-doc-item overview-doc-item--clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => navigateToDocs(doc.id)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && navigateToDocs(doc.id)}
                  >
                    <FileText size={13} />
                    <span className="overview-doc-title" title={doc.title}>
                      {doc.title || '未命名'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </motion.div>
      </div>

      {/* Memory Inspector Drawer */}
      <MemoryInspector
        externalOpen={memoryInspectorOpen}
        onExternalClose={() => setMemoryInspectorOpen(false)}
      />

      {/* Context Preview Modal */}
      <Modal
        open={contextModalOpen}
        onCancel={() => setContextModalOpen(false)}
        title="工作区上下文完整预览"
        footer={null}
        width={640}
        styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
      >
        <pre className="agent-context-modal-text">{scopeContext}</pre>
      </Modal>
    </div>
  )
}
