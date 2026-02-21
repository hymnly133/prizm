/**
 * AgentSessionList — 会话列表侧边栏内容（共享组件）
 *
 * 被 AgentPage 和 CollaborationPage 的 AgentPane 共同使用。
 * 支持可选的"总览"标签页和可选的侧边栏 header。
 * 自动过滤：隐藏工具会话（Tool LLM、工作流管理等）；仅显示交互式和直接触发的 BG session。
 */
import { ActionIcon, Empty } from '@lobehub/ui'
import { Modal } from 'antd'
import { AccentList } from '../ui/AccentList'
import { LayoutDashboard, Plus, Trash2, Zap } from 'lucide-react'
import { memo, useMemo, useCallback } from 'react'
import type { EnrichedSession } from '@prizm/client-core'
import type { BgStatus } from '@prizm/shared'
import { isChatListSession } from '@prizm/shared'
import { useAgentSessionStore } from '../../store/agentSessionStore'

const BG_STATUS_TAG: Record<string, { label: string; color: string; bgColor: string }> = {
  pending: {
    label: '等待',
    color: 'var(--ant-color-text-tertiary)',
    bgColor: 'var(--ant-color-fill-tertiary)'
  },
  running: {
    label: '运行中',
    color: 'var(--ant-color-primary)',
    bgColor: 'var(--ant-color-primary-bg)'
  },
  completed: {
    label: '完成',
    color: 'var(--ant-color-success)',
    bgColor: 'var(--ant-color-success-bg)'
  },
  failed: { label: '失败', color: 'var(--ant-color-error)', bgColor: 'var(--ant-color-error-bg)' },
  timeout: {
    label: '超时',
    color: 'var(--ant-color-warning)',
    bgColor: 'var(--ant-color-warning-bg)'
  },
  cancelled: {
    label: '已取消',
    color: 'var(--ant-color-text-tertiary)',
    bgColor: 'var(--ant-color-fill-tertiary)'
  },
  interrupted: {
    label: '已中断',
    color: 'var(--ant-color-warning)',
    bgColor: 'var(--ant-color-warning-bg)'
  }
}

export interface AgentSessionListProps {
  sessions: EnrichedSession[]
  activeSessionId?: string
  loading: boolean
  pendingInteractSessionIds: Set<string>
  onDeleteSession: (id: string) => void
  onLoadSession: (id: string) => void
  /** 是否显示侧边栏头部（包含标题和新建按钮） */
  showHeader?: boolean
  onNewSession?: () => void
  /** 是否显示总览标签 */
  showOverviewTab?: boolean
  overviewActive?: boolean
  onOverviewClick?: () => void
}

export const AgentSessionList = memo(function AgentSessionList({
  sessions,
  activeSessionId,
  loading,
  pendingInteractSessionIds,
  onDeleteSession,
  onLoadSession,
  showHeader = true,
  onNewSession,
  showOverviewTab,
  overviewActive,
  onOverviewClick
}: AgentSessionListProps) {
  const streamingStates = useAgentSessionStore((s) => s.streamingStates)

  const visibleSessions = useMemo(() => sessions.filter((s) => isChatListSession(s)), [sessions])

  const confirmDeleteSession = useCallback(
    (id: string, label: string) => {
      Modal.confirm({
        title: '确认删除',
        content: `确定要删除会话「${label}」吗？`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: () => onDeleteSession(id)
      })
    },
    [onDeleteSession]
  )

  const sessionListItems = useMemo(
    () =>
      visibleSessions.map((s) => {
        const needsInteract = pendingInteractSessionIds.has(s.id)
        const isBg = s.kind === 'background'
        const bgTag = isBg ? BG_STATUS_TAG[s.bgStatus as BgStatus] ?? BG_STATUS_TAG.pending : null
        const label = isBg
          ? s.bgMeta?.label || s.llmSummary?.trim() || '后台任务'
          : s.llmSummary?.trim() || '新会话'

        const isChatting = !isBg && (streamingStates[s.id]?.sending || s.chatStatus === 'chatting')

        return {
          key: s.id,
          title: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              {needsInteract && <span className="agent-session-interact-badge" title="需要确认" />}
              {isChatting && <span className="agent-session-chatting-badge" title="正在对话" />}
              {isBg && (
                <Zap
                  size={12}
                  style={{ flexShrink: 0, color: bgTag?.color ?? 'var(--ant-color-text-tertiary)' }}
                  fill={s.bgStatus === 'running' ? bgTag?.color : 'none'}
                />
              )}
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1
                }}
              >
                {label}
              </span>
              {isChatting && !isBg && <span className="agent-session-chatting-tag">对话中</span>}
              {bgTag && (
                <span
                  style={{
                    fontSize: 10,
                    lineHeight: 1,
                    padding: '1px 4px',
                    borderRadius: 3,
                    backgroundColor: bgTag.bgColor,
                    color: bgTag.color,
                    flexShrink: 0
                  }}
                >
                  {bgTag.label}
                </span>
              )}
            </span>
          ),
          actions: (
            <span style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <ActionIcon
                icon={Trash2}
                title="删除"
                size="small"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation()
                  confirmDeleteSession(s.id, label)
                }}
              />
            </span>
          ),
          showAction: true,
          onClick: () => onLoadSession(s.id)
        }
      }),
    [
      visibleSessions,
      pendingInteractSessionIds,
      streamingStates,
      confirmDeleteSession,
      onLoadSession
    ]
  )

  return (
    <div className="agent-sidebar">
      {showHeader && (
        <div className="agent-sidebar-header">
          <span className="agent-sidebar-title">会话</span>
          {onNewSession && (
            <ActionIcon icon={Plus} title="新建会话" onClick={onNewSession} disabled={loading} />
          )}
        </div>
      )}
      <div className="agent-sessions-list">
        {showOverviewTab && (
          <div
            className={`agent-overview-tab${overviewActive ? ' active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={onOverviewClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onOverviewClick?.()
            }}
          >
            <LayoutDashboard size={14} />
            <span>总览</span>
          </div>
        )}
        {loading && visibleSessions.length === 0 ? (
          <div className="agent-sessions-loading">加载中...</div>
        ) : visibleSessions.length === 0 ? (
          <Empty title="暂无会话" description={showHeader ? '点击 + 新建会话' : '点击 + 新建'} />
        ) : (
          <AccentList activeKey={activeSessionId} items={sessionListItems} />
        )}
      </div>
    </div>
  )
})
