/**
 * Agent 右侧边栏 - 总览模式：Scope 统计、模型、文档、记忆概览、工作区上下文
 */
import { memo, useMemo } from 'react'
import { Modal, Tooltip } from '@lobehub/ui'
import type { ListItemProps } from '@lobehub/ui'
import { AccentList } from '../ui/AccentList'
import {
  BarChart3,
  Brain,
  FileText,
  Layers,
  Loader2,
  Lock,
  MessageSquare,
  ExternalLink
} from 'lucide-react'
import type { EnrichedDocument, AvailableModel, ResourceLockInfo } from '@prizm/client-core'
import { useNavigation } from '../../context/NavigationContext'
import { Select } from '../ui/Select'
import { buildModelSelectOptionsFromAvailable } from '../../utils/modelSelectOptions'
import { MemoryInspector } from './MemoryInspector'
import { TokenUsagePanel } from './TokenUsagePanel'
import { MEMORY_LAYER_DESCRIPTIONS } from './agentSidebarTypes'
import { EmptyState } from '../ui/EmptyState'
import { LoadingPlaceholder } from '../ui/LoadingPlaceholder'

export interface AgentOverviewSidebarProps {
  currentScope: string
  models: AvailableModel[]
  defaultModel: string
  /** 系统默认模型展示名，用于第一项「系统默认（当前: X）」 */
  systemDefaultLabel?: string
  selectedModel: string | undefined
  onModelChange?: (model: string | undefined) => void
  scopeContext: string
  scopeContextLoading: boolean
  onRefreshScopeContext: () => void
  contextModalOpen: boolean
  onContextModalOpenChange: (open: boolean) => void
  documents: EnrichedDocument[]
  documentsLoading: boolean
  onRefreshDocuments: () => void
  sessionsCount: number
  sessionsCountLoading: boolean
  memoryEnabled: boolean
  userMemoryCount: number
  scopeMemoryCount: number
  scopeChatMemoryCount: number
  scopeDocumentMemoryCount: number
  sessionMemoryCount: number
  memoryByType?: Record<string, number>
  memoryCountsLoading: boolean
  activeLocks?: ResourceLockInfo[]
  activeLocksByDoc?: Map<string, ResourceLockInfo>
}

export const AgentOverviewSidebar = memo(function AgentOverviewSidebar({
  currentScope,
  models,
  defaultModel,
  systemDefaultLabel,
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
  scopeChatMemoryCount,
  scopeDocumentMemoryCount,
  sessionMemoryCount,
  memoryByType,
  memoryCountsLoading,
  activeLocks,
  activeLocksByDoc
}: AgentOverviewSidebarProps) {
  const { chatWith, navigateToDocs } = useNavigation()
  const docLocks = (activeLocks ?? []).filter((l) => l.resourceType === 'document')

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
          {models.length === 0 ? (
            <p className="text-sm text-amber-500/90">
              暂无可用模型。请先在 设置 → LLM 配置 中添加提供商并保存。
            </p>
          ) : (
            <Select
              options={buildModelSelectOptionsFromAvailable(models, {
                label: systemDefaultLabel
                  ? `系统默认（当前: ${systemDefaultLabel}）`
                  : defaultModel
                  ? models.find((m) => m.id === defaultModel)?.label ?? `系统默认 (${defaultModel})`
                  : '系统默认',
                value: ''
              })}
              value={selectedModel ?? ''}
              onChange={(v) => onModelChange(v || undefined)}
              style={{ width: '100%' }}
            />
          )}
        </section>
      )}

      {/* 记忆状态 */}
      <section className="agent-right-section">
        <h3 className="agent-right-section-title">
          <Brain size={14} className="agent-right-section-icon" />
          记忆状态
        </h3>
        {memoryCountsLoading ? (
          <LoadingPlaceholder />
        ) : memoryEnabled ? (
          <div className="agent-memory-state">
            <div className="agent-memory-tier" title={MEMORY_LAYER_DESCRIPTIONS.user}>
              <span className="agent-memory-tier-label">User 层</span>
              <span className="agent-memory-tier-count">{userMemoryCount}</span>
            </div>
            {memoryByType && (
              <div
                className="agent-memory-tier"
                style={{ paddingLeft: 16, borderTop: 'none', paddingTop: 0 }}
              >
                <span className="agent-memory-tier-label" style={{ fontSize: 11, opacity: 0.7 }}>
                  画像
                </span>
                <span className="agent-memory-tier-count" style={{ fontSize: 12 }}>
                  {memoryByType.profile ?? 0}
                </span>
              </div>
            )}
            <div className="agent-memory-tier" title={MEMORY_LAYER_DESCRIPTIONS.scope}>
              <span className="agent-memory-tier-label">Scope 层</span>
              <span className="agent-memory-tier-count">{scopeMemoryCount}</span>
            </div>
            <div
              className="agent-memory-tier"
              style={{ paddingLeft: 16, borderTop: 'none', paddingTop: 0 }}
            >
              <span className="agent-memory-tier-label" style={{ fontSize: 11, opacity: 0.7 }}>
                对话
              </span>
              <span className="agent-memory-tier-count" style={{ fontSize: 12 }}>
                {scopeChatMemoryCount}
              </span>
            </div>
            <div
              className="agent-memory-tier"
              style={{ paddingLeft: 16, borderTop: 'none', paddingTop: 0 }}
            >
              <span className="agent-memory-tier-label" style={{ fontSize: 11, opacity: 0.7 }}>
                文档
              </span>
              <span className="agent-memory-tier-count" style={{ fontSize: 12 }}>
                {scopeDocumentMemoryCount}
              </span>
            </div>
            <div className="agent-memory-tier" title={MEMORY_LAYER_DESCRIPTIONS.session}>
              <span className="agent-memory-tier-label">Session 层</span>
              <span className="agent-memory-tier-count">{sessionMemoryCount}</span>
            </div>
            <div
              className="agent-memory-tier"
              style={{ borderTop: 'none', paddingTop: 0, marginTop: -2 }}
            >
              <span className="agent-memory-tier-label" style={{ fontSize: 11, opacity: 0.7 }}>
                合计
              </span>
              <span className="agent-memory-tier-count" style={{ fontWeight: 600 }}>
                {userMemoryCount + scopeMemoryCount + sessionMemoryCount}
              </span>
            </div>
          </div>
        ) : (
          <EmptyState description="暂无记忆或未启用" />
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
            <LoadingPlaceholder />
          ) : scopeContext ? (
            <>
              <pre className="agent-context-text">{scopeContext}</pre>
              <span className="agent-context-click-hint">点击查看完整预览</span>
            </>
          ) : (
            <EmptyState description="当前 scope 无便签/待办/文档" />
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

      {/* 已签出文档 */}
      {docLocks.length > 0 && (
        <section className="agent-right-section">
          <h3 className="agent-right-section-title">
            <Lock size={14} className="agent-right-section-icon" />
            已签出文档
          </h3>
          <AccentList
            items={docLocks.map((lock) => {
              const doc = documents.find((d) => d.id === lock.resourceId)
              return {
                key: lock.id,
                avatar: <Lock size={11} style={{ color: 'var(--ant-color-warning)' }} />,
                title: doc?.title || lock.resourceId.slice(0, 12),
                addon: (
                  <Tooltip title={`会话 ${lock.sessionId}`}>
                    <span
                      className="agent-lock-session-link"
                      onClick={(e) => {
                        e.stopPropagation()
                        chatWith({ sessionId: lock.sessionId })
                      }}
                    >
                      {lock.sessionId.slice(0, 6)}
                      <ExternalLink size={9} style={{ marginLeft: 1, verticalAlign: -1 }} />
                    </span>
                  </Tooltip>
                ),
                onClick: () => navigateToDocs(lock.resourceId)
              }
            })}
            styles={{ item: { padding: '6px 8px' } }}
          />
        </section>
      )}

      {/* 文档列表（简化：仅标题） */}
      <section className="agent-right-section">
        <h3 className="agent-right-section-title">文档</h3>
        <div className="agent-documents-list">
          {documentsLoading ? (
            <LoadingPlaceholder />
          ) : documents.length === 0 ? (
            <EmptyState description="暂无文档" />
          ) : (
            <AccentList
              items={documents.map((doc) => {
                const lockForDoc = activeLocksByDoc?.get(doc.id)
                return {
                  key: doc.id,
                  avatar: <FileText size={12} />,
                  title: doc.title || '未命名',
                  addon: lockForDoc ? (
                    <Tooltip title={`被会话 ${lockForDoc.sessionId.slice(0, 8)} 签出`}>
                      <Lock size={10} style={{ color: 'var(--ant-color-warning)' }} />
                    </Tooltip>
                  ) : undefined,
                  onClick: () => navigateToDocs(doc.id)
                }
              })}
              styles={{ item: { padding: '6px 8px' } }}
            />
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
})
