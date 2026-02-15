/**
 * Agent 总览面板 — 卡片式布局，展示 scope 级统计信息
 * 数据来自 useAgentOverviewData，与 AgentRightSidebar 共享同一套数据源
 */
import { useCallback, useState } from 'react'
import { Flexbox } from '@lobehub/ui'
import { Modal } from '@lobehub/ui'
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
import { TokenUsagePanel } from './TokenUsagePanel'
import { Select } from '../ui/Select'
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
    threeLevelMemories,
    threeLevelLoading,
    loadThreeLevelMemories,
    sessionsCount,
    sessionsCountLoading,
    loadSessionsCount
  } = useAgentOverviewData()

  const [contextModalOpen, setContextModalOpen] = useState(false)

  const handleRefreshAll = useCallback(() => {
    void loadScopeContext()
    void loadDocuments()
    void loadThreeLevelMemories()
    void loadSessionsCount()
  }, [loadScopeContext, loadDocuments, loadThreeLevelMemories, loadSessionsCount])

  return (
    <div className="overview-panel">
      {/* Header */}
      <div className="overview-panel-header">
        <Flexbox horizontal align="center" gap={8}>
          <BarChart3 size={20} />
          <h2 className="overview-panel-title">工作区总览</h2>
          <Tag color="blue">{currentScope || 'default'}</Tag>
        </Flexbox>
        <button
          type="button"
          className="overview-refresh-btn"
          onClick={handleRefreshAll}
          title="刷新所有数据"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Grid of cards */}
      <div className="overview-grid">
        {/* ---------- 统计概览卡片 ---------- */}
        <div className="overview-card overview-card-stats">
          <div className="overview-card-head">
            <Layers size={16} />
            <span>Scope 概览</span>
          </div>
          <div className="overview-card-body">
            <div className="overview-stat-grid">
              <StatBlock
                icon={<MessageSquare size={18} />}
                label="会话数"
                value={sessionsCountLoading ? '...' : String(sessionsCount)}
                color="var(--ant-color-primary)"
              />
              <StatBlock
                icon={<FileText size={18} />}
                label="文档数"
                value={documentsLoading ? '...' : String(documents.length)}
                color="var(--ant-color-success)"
              />
              <StatBlock
                icon={<Brain size={18} />}
                label="User 记忆"
                value={threeLevelLoading ? '...' : String(threeLevelMemories?.user.length ?? 0)}
                color="var(--ant-color-warning)"
              />
              <StatBlock
                icon={<Sparkles size={18} />}
                label="Scope 记忆"
                value={threeLevelLoading ? '...' : String(threeLevelMemories?.scope.length ?? 0)}
                color="var(--ant-geekblue-6, #2f54eb)"
              />
            </div>
          </div>
        </div>

        {/* ---------- 模型选择卡片 ---------- */}
        {onModelChange && (
          <div className="overview-card overview-card-model">
            <div className="overview-card-head">
              <Sparkles size={16} />
              <span>模型</span>
            </div>
            <div className="overview-card-body">
              <Select
                options={[
                  {
                    label: defaultModel ? `默认 (${defaultModel})` : '默认',
                    value: ''
                  },
                  ...models.map((m: AvailableModel) => ({ label: m.label, value: m.id }))
                ]}
                value={selectedModel ?? ''}
                onChange={(v) => onModelChange(v || undefined)}
                style={{ width: '100%' }}
              />
            </div>
          </div>
        )}

        {/* ---------- 记忆状态卡片 ---------- */}
        <div className="overview-card overview-card-memory">
          <div className="overview-card-head">
            <Brain size={16} />
            <span>记忆状态</span>
            <button
              type="button"
              className="overview-card-action"
              onClick={() => void loadThreeLevelMemories()}
              disabled={threeLevelLoading}
              title="刷新记忆"
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="overview-card-body">
            {threeLevelLoading ? (
              <LoadingPlaceholder />
            ) : threeLevelMemories ? (
              <div className="overview-memory-tiers">
                <MemoryTierBar
                  label="User"
                  count={threeLevelMemories.user.length}
                  color="var(--ant-color-warning)"
                />
                <MemoryTierBar
                  label="Scope"
                  count={threeLevelMemories.scope.length}
                  color="var(--ant-color-primary)"
                />
                <MemoryTierBar
                  label="Session"
                  count={threeLevelMemories.session.length}
                  color="var(--ant-color-success)"
                />
              </div>
            ) : (
              <p className="overview-empty-text">暂无记忆或未启用</p>
            )}
          </div>
        </div>

        {/* ---------- 工作区上下文卡片 ---------- */}
        <div className="overview-card overview-card-context">
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
              <p className="overview-empty-text">当前 scope 无便签/待办/文档</p>
            )}
          </div>
        </div>

        {/* ---------- 记忆库卡片 ---------- */}
        <div className="overview-card overview-card-inspector">
          <div className="overview-card-head">
            <Brain size={16} />
            <span>记忆库</span>
          </div>
          <div className="overview-card-body overview-card-body-scroll">
            <MemoryInspector />
          </div>
        </div>

        {/* ---------- Token 使用卡片 ---------- */}
        <div className="overview-card overview-card-token">
          <div className="overview-card-head">
            <Coins size={16} />
            <span>Token 使用</span>
          </div>
          <div className="overview-card-body overview-card-body-scroll">
            <TokenUsagePanel />
          </div>
        </div>
      </div>

      {/* ---------- 文档列表（独立底部全宽） ---------- */}
      <div className="overview-card overview-card-docs-bottom">
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
            <LoadingPlaceholder />
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
      </div>

      {/* 上下文预览 Modal */}
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

/* ========== 子组件 ========== */

function StatBlock({
  icon,
  label,
  value,
  color
}: {
  icon: React.ReactNode
  label: string
  value: string
  color: string
}) {
  return (
    <div className="overview-stat-block">
      <div className="overview-stat-icon" style={{ color }}>
        {icon}
      </div>
      <div className="overview-stat-info">
        <span className="overview-stat-value">{value}</span>
        <span className="overview-stat-label">{label}</span>
      </div>
    </div>
  )
}

function MemoryTierBar({ label, count, color }: { label: string; count: number; color: string }) {
  const maxWidth = 100
  const barWidth = Math.min(count * 8, maxWidth)

  return (
    <div className="overview-memory-row">
      <span className="overview-memory-label">{label}</span>
      <div className="overview-memory-bar-bg">
        <div
          className="overview-memory-bar-fill"
          style={{ width: `${barWidth}%`, backgroundColor: color }}
        />
      </div>
      <span className="overview-memory-count">{count}</span>
    </div>
  )
}

function LoadingPlaceholder() {
  return (
    <Flexbox horizontal align="center" gap={6} style={{ color: 'var(--ant-color-text-tertiary)' }}>
      <Loader2 size={14} className="spinning" />
      <span>加载中</span>
    </Flexbox>
  )
}
