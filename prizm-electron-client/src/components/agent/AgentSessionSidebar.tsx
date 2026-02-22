/**
 * Agent 右侧边栏 - 会话模式：状态、活动、系统提示词、记忆面板、会话统计
 * 增强版：集成 MemorySidebarPanel + motion 动画
 */
import { memo } from 'react'
import { Modal } from '@lobehub/ui'
import { motion } from 'motion/react'
import {
  AlertCircle,
  BarChart3,
  Brain,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Activity
} from 'lucide-react'
import { useState } from 'react'
import type { EnrichedSession, AvailableModel, ResourceLockInfo } from '@prizm/client-core'
import type { SessionStats } from './agentSidebarTypes'
import type { ActivityItem } from './agentSidebarTypes'
import type { ToolCallRecord } from '@prizm/client-core'
import { Select } from '../ui/Select'
import { buildModelSelectOptionsFromAvailable } from '../../utils/modelSelectOptions'
import { MEMORY_LAYER_DESCRIPTIONS } from './agentSidebarTypes'
import { SessionActivityTimeline } from './SessionActivityTimeline'
import { SessionStatsPanel } from './SessionStatsPanel'
import { MemorySidebarPanel } from './MemorySidebarPanel'
import { MemoryInspector } from './MemoryInspector'
import { EmptyState } from '../ui/EmptyState'
import { LoadingPlaceholder } from '../ui/LoadingPlaceholder'
import { fadeUp, STAGGER_DELAY } from '../../theme/motionPresets'

export interface AgentSessionSidebarProps {
  sending: boolean
  error: string | null
  currentSession: EnrichedSession | null
  isNewConversationReady: boolean
  models: AvailableModel[]
  defaultModel: string
  /** 系统默认模型展示名，用于第一项「系统默认（当前: X）」 */
  systemDefaultLabel?: string
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
  scopeChatMemoryCount: number
  scopeDocumentMemoryCount: number
  sessionMemoryCount: number
  memoryByType?: Record<string, number>
  memoryCountsLoading: boolean
  sessionLocks?: ResourceLockInfo[]
}

export const AgentSessionSidebar = memo(function AgentSessionSidebar({
  sending,
  error,
  currentSession,
  isNewConversationReady,
  models,
  defaultModel,
  systemDefaultLabel,
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
  scopeChatMemoryCount,
  scopeDocumentMemoryCount,
  sessionMemoryCount,
  memoryByType,
  memoryCountsLoading,
  sessionLocks
}: AgentSessionSidebarProps) {
  const [memoryInspectorOpen, setMemoryInspectorOpen] = useState(false)
  let idx = 0

  return (
    <>
      {/* 模型选择 */}
      {onModelChange && (
        <motion.section className="agent-right-section" {...fadeUp(idx++ * STAGGER_DELAY)}>
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
        </motion.section>
      )}

      {/* 状态 */}
      <motion.section className="agent-right-section" {...fadeUp(idx++ * STAGGER_DELAY)}>
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
      </motion.section>

      {/* 系统提示词 - 仅会话模式显示 */}
      {!isNewConversationReady && (
        <motion.section className="agent-right-section" {...fadeUp(idx++ * STAGGER_DELAY)}>
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
              <LoadingPlaceholder />
            ) : systemPrompt ? (
              <>
                <pre className="agent-context-text agent-system-prompt-preview">
                  {systemPrompt.length > 200 ? `${systemPrompt.slice(0, 200)}…` : systemPrompt}
                </pre>
                <span className="agent-context-click-hint">点击查看完整内容</span>
              </>
            ) : (
              <EmptyState description="暂无" />
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
        </motion.section>
      )}

      {/* 会话活动 - 仅会话模式显示 */}
      {!isNewConversationReady && (
        <motion.section className="agent-right-section" {...fadeUp(idx++ * STAGGER_DELAY)}>
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
            sessionLocks={sessionLocks}
          />
        </motion.section>
      )}

      {/* 记忆面板（替代纯计数展示） */}
      <motion.section className="agent-right-section" {...fadeUp(idx++ * STAGGER_DELAY)}>
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
      </motion.section>

      {/* 会话统计 - 仅会话模式显示 */}
      {!isNewConversationReady && (
        <motion.section className="agent-right-section" {...fadeUp(idx++ * STAGGER_DELAY)}>
          <h3 className="agent-right-section-title">
            <BarChart3 size={14} className="agent-right-section-icon" />
            会话统计
          </h3>
          <SessionStatsPanel
            currentSession={currentSession}
            sessionStats={sessionStats}
            sessionStatsLoading={sessionStatsLoading}
          />
        </motion.section>
      )}

      {/* Memory Inspector Drawer */}
      <MemoryInspector
        externalOpen={memoryInspectorOpen}
        onExternalClose={() => setMemoryInspectorOpen(false)}
      />
    </>
  )
})
