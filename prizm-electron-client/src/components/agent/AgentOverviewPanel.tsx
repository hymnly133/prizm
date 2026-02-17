/**
 * Agent 总览面板 — 仪表盘风格
 * SpotlightCard 统计 + Token 仪表盘 + 记忆面板 + 上下文预览
 */
import { useCallback, useState } from 'react'
import { motion } from 'motion/react'
import { Flexbox } from '@lobehub/ui'
import { Modal } from '@lobehub/ui'
import { SpotlightCard } from '@lobehub/ui/awesome'
import { Tag } from 'antd'
import {
  BarChart3,
  Brain,
  Coins,
  FileText,
  Layers,
  Loader2,
  MessageSquare,
  RefreshCw,
  Sparkles
} from 'lucide-react'
import { useAgentOverviewData } from '../../hooks/useAgentOverviewData'
import { MemoryInspector } from './MemoryInspector'
import { MemorySidebarPanel } from './MemorySidebarPanel'
import { TokenDashboard } from './TokenDashboard'
import { AnimatedCounter } from './AnimatedCounter'
import { Select } from '../ui/Select'
import { fadeUp, STAGGER_DELAY } from '../../theme/motionPresets'
import type { AvailableModel } from '@prizm/client-core'

interface AgentOverviewPanelProps {
  selectedModel?: string
  onModelChange?: (model: string | undefined) => void
}

export function AgentOverviewPanel({ selectedModel, onModelChange }: AgentOverviewPanelProps) {
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
        <button
          type="button"
          className="overview-refresh-btn"
          onClick={handleRefreshAll}
          title="刷新所有数据"
        >
          <RefreshCw size={14} />
        </button>
      </motion.div>

      {/* Statistics - SpotlightCard grid */}
      <motion.div {...fadeUp(idx++ * STAGGER_DELAY)}>
        <SpotlightCard
          items={[
            { key: 'sessions' },
            { key: 'documents' },
            { key: 'userMem' },
            { key: 'scopeMem' }
          ]}
          renderItem={({ key }) => {
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
              userMem: {
                icon: <Brain size={20} />,
                label: 'User 记忆',
                value: userMemoryCount,
                loading: memoryCountsLoading,
                color: 'var(--ant-color-warning)',
                desc: '画像 / 偏好'
              },
              scopeMem: {
                icon: <Sparkles size={20} />,
                label: 'Scope 记忆',
                value: scopeMemoryCount,
                loading: memoryCountsLoading,
                color: 'var(--ant-geekblue-6, #2f54eb)',
                desc: '叙事 / 文档'
              }
            }
            const c = configs[key as string]
            if (!c) return null
            return (
              <div className="overview-stat-block">
                <div className="overview-stat-icon" style={{ color: c.color }}>
                  {c.icon}
                </div>
                <div className="overview-stat-info">
                  {c.loading ? (
                    <span className="overview-stat-value">...</span>
                  ) : (
                    <AnimatedCounter
                      value={c.value}
                      format={(n) => String(Math.round(n))}
                      className="overview-stat-value"
                    />
                  )}
                  <span className="overview-stat-label">{c.label}</span>
                  {c.desc && (
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--ant-color-text-quaternary)',
                        lineHeight: 1,
                        marginTop: 1
                      }}
                    >
                      {c.desc}
                    </span>
                  )}
                </div>
              </div>
            )
          }}
          columns={4}
          gap="12px"
          borderRadius={12}
        />
      </motion.div>

      {/* Two-column: Token Dashboard + Memory Panel */}
      <div className="overview-grid" style={{ marginTop: 16 }}>
        {/* Token Dashboard */}
        <motion.div className="overview-card" {...fadeUp(idx++ * STAGGER_DELAY)}>
          <div className="overview-card-head">
            <Coins size={16} />
            <span>Token 使用</span>
          </div>
          <div className="overview-card-body overview-card-body-scroll">
            <TokenDashboard />
          </div>
        </motion.div>

        {/* Memory Panel */}
        <motion.div className="overview-card" {...fadeUp(idx++ * STAGGER_DELAY)}>
          <div className="overview-card-head">
            <Brain size={16} />
            <span>记忆系统</span>
            <button
              type="button"
              className="overview-card-action"
              onClick={() => void loadMemoryCounts()}
              disabled={memoryCountsLoading}
              title="刷新记忆"
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="overview-card-body overview-card-body-scroll">
            <MemorySidebarPanel
              memoryEnabled={memoryEnabled}
              userMemoryCount={userMemoryCount}
              scopeMemoryCount={scopeMemoryCount}
              memoryCountsLoading={memoryCountsLoading}
              onOpenInspector={() => setMemoryInspectorOpen(true)}
            />
          </div>
        </motion.div>

        {/* Context Preview */}
        <motion.div className="overview-card" {...fadeUp(idx++ * STAGGER_DELAY)}>
          <div className="overview-card-head">
            <Layers size={16} />
            <span>工作区上下文</span>
            <button
              type="button"
              className="overview-card-action"
              onClick={() => void loadScopeContext()}
              disabled={scopeContextLoading}
              title="刷新上下文"
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="overview-card-body">
            {scopeContextLoading ? (
              <Flexbox
                horizontal
                align="center"
                gap={6}
                style={{ color: 'var(--ant-color-text-tertiary)' }}
              >
                <Loader2 size={14} className="spinning" />
                <span>加载中</span>
              </Flexbox>
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
              <p className="overview-empty-text">当前 scope 无便签/待办/文档</p>
            )}
          </div>
        </motion.div>

        {/* Documents List */}
        <motion.div className="overview-card" {...fadeUp(idx++ * STAGGER_DELAY)}>
          <div className="overview-card-head">
            <FileText size={16} />
            <span>文档</span>
            <Tag style={{ marginLeft: 'auto', marginRight: 0 }}>
              {documentsLoading ? '...' : documents.length}
            </Tag>
            <button
              type="button"
              className="overview-card-action"
              onClick={() => void loadDocuments()}
              disabled={documentsLoading}
              title="刷新文档"
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="overview-card-body">
            {documentsLoading ? (
              <Flexbox
                horizontal
                align="center"
                gap={6}
                style={{ color: 'var(--ant-color-text-tertiary)' }}
              >
                <Loader2 size={14} className="spinning" />
                <span>加载中</span>
              </Flexbox>
            ) : documents.length === 0 ? (
              <p className="overview-empty-text">暂无文档</p>
            ) : (
              <ul className="overview-doc-list overview-doc-list-horizontal">
                {documents.map((doc) => (
                  <li key={doc.id} className="overview-doc-item">
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
