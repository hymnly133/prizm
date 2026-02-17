/**
 * Agent 右侧边栏 - 总览模式：Scope 统计、模型、文档、记忆概览、工作区上下文
 */
import { Modal } from '@lobehub/ui'
import { BarChart3, Brain, FileText, Layers, Loader2, MessageSquare } from 'lucide-react'
import type { Document, AvailableModel } from '@prizm/client-core'
import { Select } from '../ui/Select'
import { MemoryInspector } from './MemoryInspector'
import { TokenUsagePanel } from './TokenUsagePanel'
import { MEMORY_LAYER_DESCRIPTIONS } from './agentSidebarTypes'

export interface AgentOverviewSidebarProps {
  currentScope: string
  models: AvailableModel[]
  defaultModel: string
  selectedModel: string | undefined
  onModelChange?: (model: string | undefined) => void
  scopeContext: string
  scopeContextLoading: boolean
  onRefreshScopeContext: () => void
  contextModalOpen: boolean
  onContextModalOpenChange: (open: boolean) => void
  documents: Document[]
  documentsLoading: boolean
  onRefreshDocuments: () => void
  sessionsCount: number
  sessionsCountLoading: boolean
  memoryEnabled: boolean
  userMemoryCount: number
  scopeMemoryCount: number
  memoryCountsLoading: boolean
}

export function AgentOverviewSidebar({
  currentScope,
  models,
  defaultModel,
  selectedModel,
  onModelChange,
  scopeContext,
  scopeContextLoading,
  onRefreshScopeContext,
  contextModalOpen,
  onContextModalOpenChange,
  documents,
  documentsLoading,
  onRefreshDocuments,
  sessionsCount,
  sessionsCountLoading,
  memoryEnabled,
  userMemoryCount,
  scopeMemoryCount,
  memoryCountsLoading
}: AgentOverviewSidebarProps) {
  return (
    <>
      {/* Scope 统计概览 */}
      <section className="agent-right-section">
        <h3 className="agent-right-section-title">
          <BarChart3 size={14} className="agent-right-section-icon" />
          Scope 概览
        </h3>
        <div className="agent-overview-stats">
          <div className="agent-overview-stat-row">
            <span className="agent-overview-stat-label">
              <Layers size={12} /> 当前 Scope
            </span>
            <span className="agent-overview-stat-value">{currentScope || 'default'}</span>
          </div>
          <div className="agent-overview-stat-row">
            <span className="agent-overview-stat-label">
              <MessageSquare size={12} /> 会话数
            </span>
            <span className="agent-overview-stat-value">
              {sessionsCountLoading ? '...' : sessionsCount}
            </span>
          </div>
          <div className="agent-overview-stat-row">
            <span className="agent-overview-stat-label">
              <FileText size={12} /> 文档数
            </span>
            <span className="agent-overview-stat-value">
              {documentsLoading ? '...' : documents.length}
            </span>
          </div>
        </div>
      </section>

      {/* 模型 */}
      {onModelChange && (
        <section className="agent-right-section">
          <h3 className="agent-right-section-title">模型</h3>
          <Select
            options={[
              { label: defaultModel ? `默认 (${defaultModel})` : '默认', value: '' },
              ...models.map((m) => ({ label: m.label, value: m.id }))
            ]}
            value={selectedModel ?? ''}
            onChange={(v) => onModelChange(v || undefined)}
            style={{ width: '100%' }}
          />
        </section>
      )}

      {/* 记忆状态 */}
      <section className="agent-right-section">
        <h3 className="agent-right-section-title">
          <Brain size={14} className="agent-right-section-icon" />
          记忆状态
        </h3>
        {memoryCountsLoading ? (
          <div className="agent-right-loading">
            <Loader2 size={14} className="spinning" />
            <span>加载中</span>
          </div>
        ) : memoryEnabled ? (
          <div className="agent-memory-state">
            <div className="agent-memory-tier">
              <span
                className="agent-memory-tier-label"
                title={MEMORY_LAYER_DESCRIPTIONS.user}
              >
                User 层
              </span>
              <span className="agent-memory-tier-count">{userMemoryCount}</span>
            </div>
            <div className="agent-memory-tier">
              <span
                className="agent-memory-tier-label"
                title={MEMORY_LAYER_DESCRIPTIONS.scope}
              >
                Scope 层
              </span>
              <span className="agent-memory-tier-count">{scopeMemoryCount}</span>
            </div>
            <div
              className="agent-memory-tier"
              style={{ borderTop: 'none', paddingTop: 0, marginTop: -2 }}
            >
              <span
                className="agent-memory-tier-label"
                style={{ fontSize: 11, opacity: 0.7 }}
              >
                合计
              </span>
              <span className="agent-memory-tier-count" style={{ fontWeight: 600 }}>
                {userMemoryCount + scopeMemoryCount}
              </span>
            </div>
          </div>
        ) : (
          <p className="agent-right-empty">暂无记忆或未启用</p>
        )}
      </section>

      {/* 记忆库 */}
      <section className="agent-right-section">
        <h3 className="agent-right-section-title">记忆库</h3>
        <MemoryInspector />
      </section>

      {/* Token 使用 */}
      <section className="agent-right-section">
        <h3 className="agent-right-section-title">Token 使用</h3>
        <TokenUsagePanel />
      </section>

      {/* 工作区上下文 */}
      <section className="agent-right-section">
        <h3 className="agent-right-section-title">工作区上下文</h3>
        <div
          className="agent-context-preview agent-context-clickable"
          role="button"
          tabIndex={0}
          onClick={() => scopeContext && onContextModalOpenChange(true)}
          onKeyDown={(e) =>
            scopeContext && (e.key === 'Enter' || e.key === ' ') && onContextModalOpenChange(true)
          }
          aria-label="点击查看完整上下文"
        >
          {scopeContextLoading ? (
            <div className="agent-right-loading">
              <Loader2 size={14} className="spinning" />
              <span>加载中</span>
            </div>
          ) : scopeContext ? (
            <>
              <pre className="agent-context-text">{scopeContext}</pre>
              <span className="agent-context-click-hint">点击查看完整预览</span>
            </>
          ) : (
            <p className="agent-right-empty">当前 scope 无便签/待办/文档</p>
          )}
        </div>
        <button
          type="button"
          className="agent-right-refresh"
          onClick={onRefreshScopeContext}
          disabled={scopeContextLoading}
        >
          刷新
        </button>
        <Modal
          open={contextModalOpen}
          onCancel={() => onContextModalOpenChange(false)}
          title="工作区上下文完整预览"
          footer={null}
          width={640}
          styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
        >
          <pre className="agent-context-modal-text">{scopeContext}</pre>
        </Modal>
      </section>

      {/* 文档列表（简化：仅标题） */}
      <section className="agent-right-section">
        <h3 className="agent-right-section-title">文档</h3>
        <div className="agent-documents-list">
          {documentsLoading ? (
            <div className="agent-right-loading">
              <Loader2 size={14} className="spinning" />
              <span>加载中</span>
            </div>
          ) : documents.length === 0 ? (
            <p className="agent-right-empty">暂无文档</p>
          ) : (
            <ul className="agent-documents-ul agent-documents-compact">
              {documents.map((doc) => (
                <li key={doc.id} className="agent-document-item-compact">
                  <FileText size={12} className="agent-doc-icon" />
                  <span className="agent-document-title" title={doc.title}>
                    {doc.title || '未命名'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          className="agent-right-refresh"
          onClick={onRefreshDocuments}
          disabled={documentsLoading}
        >
          刷新
        </button>
      </section>
    </>
  )
}
