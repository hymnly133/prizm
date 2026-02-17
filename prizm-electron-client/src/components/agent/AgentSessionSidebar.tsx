/**
 * Agent 右侧边栏 - 会话模式：状态、活动、系统提示词、记忆、会话统计
 */
import { Modal } from '@lobehub/ui'
import {
  AlertCircle,
  BarChart3,
  Brain,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Activity
} from 'lucide-react'
import type { AgentSession, AvailableModel } from '@prizm/client-core'
import type { SessionStats } from './agentSidebarTypes'
import type { ActivityItem } from './agentSidebarTypes'
import type { ToolCallRecord } from '@prizm/client-core'
import { Select } from '../ui/Select'
import { MEMORY_LAYER_DESCRIPTIONS } from './agentSidebarTypes'
import { SessionActivityTimeline } from './SessionActivityTimeline'
import { SessionStatsPanel } from './SessionStatsPanel'

export interface AgentSessionSidebarProps {
  sending: boolean
  error: string | null
  currentSession: AgentSession | null
  isNewConversationReady: boolean
  models: AvailableModel[]
  defaultModel: string
  selectedModel: string | undefined
  onModelChange?: (model: string | undefined) => void
  systemPrompt: string
  systemPromptLoading: boolean
  onSystemPromptModalOpenChange: (open: boolean) => void
  systemPromptModalOpen: boolean
  sessionContext: {
    provisions: { itemId: string; kind: string; mode: string; charCount: number; stale: boolean }[]
    activities: ActivityItem[]
  } | null
  sessionContextLoading: boolean
  latestToolCalls: ToolCallRecord[]
  provisionsSummary: string | null
  sessionStats: SessionStats | null
  sessionStatsLoading: boolean
  memoryEnabled: boolean
  userMemoryCount: number
  scopeMemoryCount: number
  memoryCountsLoading: boolean
}

export function AgentSessionSidebar({
  sending,
  error,
  currentSession,
  isNewConversationReady,
  models,
  defaultModel,
  selectedModel,
  onModelChange,
  systemPrompt,
  systemPromptLoading,
  onSystemPromptModalOpenChange,
  systemPromptModalOpen,
  sessionContext,
  sessionContextLoading,
  latestToolCalls,
  provisionsSummary,
  sessionStats,
  sessionStatsLoading,
  memoryEnabled,
  userMemoryCount,
  scopeMemoryCount,
  memoryCountsLoading
}: AgentSessionSidebarProps) {
  return (
    <>
      {/* 模型选择 */}
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

      {/* 状态 */}
      <section className="agent-right-section">
        <h3 className="agent-right-section-title">状态</h3>
        <div className="agent-status-row">
          {sending ? (
            <>
              <Loader2 className="agent-status-icon spinning" size={14} />
              <span>生成中</span>
            </>
          ) : error ? (
            <>
              <AlertCircle className="agent-status-icon error" size={14} />
              <span className="agent-status-error">{error}</span>
            </>
          ) : isNewConversationReady ? (
            <>
              <CheckCircle2 className="agent-status-icon idle" size={14} />
              <span>就绪 - 新对话</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="agent-status-icon idle" size={14} />
              <span>就绪</span>
            </>
          )}
        </div>
      </section>

      {/* 系统提示词 - 仅会话模式显示 */}
      {!isNewConversationReady && (
        <section className="agent-right-section">
          <h3 className="agent-right-section-title">
            <MessageSquare size={14} className="agent-right-section-icon" />
            系统提示词
          </h3>
          <div
            className="agent-context-preview agent-context-clickable"
            role="button"
            tabIndex={0}
            onClick={() => systemPrompt && onSystemPromptModalOpenChange(true)}
            onKeyDown={(e) =>
              systemPrompt &&
              (e.key === 'Enter' || e.key === ' ') &&
              onSystemPromptModalOpenChange(true)
            }
            aria-label="点击查看完整系统提示词"
          >
            {systemPromptLoading ? (
              <div className="agent-right-loading">
                <Loader2 size={14} className="spinning" />
                <span>加载中</span>
              </div>
            ) : systemPrompt ? (
              <>
                <pre className="agent-context-text agent-system-prompt-preview">
                  {systemPrompt.length > 200
                    ? `${systemPrompt.slice(0, 200)}…`
                    : systemPrompt}
                </pre>
                <span className="agent-context-click-hint">点击查看完整内容</span>
              </>
            ) : (
              <p className="agent-right-empty">暂无</p>
            )}
          </div>
          <Modal
            open={systemPromptModalOpen}
            onCancel={() => onSystemPromptModalOpenChange(false)}
            title="系统提示词（发送前注入的完整前置提示词）"
            footer={null}
            width={640}
            styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
          >
            <pre className="agent-context-modal-text">{systemPrompt}</pre>
          </Modal>
        </section>
      )}

      {/* 会话活动 - 仅会话模式显示 */}
      {!isNewConversationReady && (
        <section className="agent-right-section">
          <h3 className="agent-right-section-title">
            <Activity size={14} className="agent-right-section-icon" />
            会话活动
          </h3>
          <SessionActivityTimeline
            currentSession={currentSession}
            sessionContext={sessionContext}
            sessionContextLoading={sessionContextLoading}
            latestToolCalls={latestToolCalls}
            provisionsSummary={provisionsSummary}
          />
        </section>
      )}

      {/* 记忆状态（scope 级别，始终显示） */}
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

      {/* 会话统计 - 仅会话模式显示 */}
      {!isNewConversationReady && (
        <section className="agent-right-section">
          <h3 className="agent-right-section-title">
            <BarChart3 size={14} className="agent-right-section-icon" />
            会话统计
          </h3>
          <SessionStatsPanel
            currentSession={currentSession}
            sessionStats={sessionStats}
            sessionStatsLoading={sessionStatsLoading}
          />
        </section>
      )}
    </>
  )
}
