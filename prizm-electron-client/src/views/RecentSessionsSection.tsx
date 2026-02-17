/**
 * RecentSessionsSection - 最近对话卡片
 */
import { memo } from 'react'
import { motion } from 'motion/react'
import { Button, Icon, Tag, Text } from '@lobehub/ui'
import { MessageSquare, Plus, Clock } from 'lucide-react'
import { getTextContent } from '@prizm/client-core'
import type { AgentSession } from '@prizm/client-core'
import { formatRelativeTime } from '../utils/formatRelativeTime'

const STAGGER_DELAY = 0.06
const EASE_SMOOTH = [0.33, 1, 0.68, 1] as const

function fadeUp(index: number) {
  return {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: index * STAGGER_DELAY, duration: 0.4, ease: EASE_SMOOTH }
  }
}

function getSessionTitle(session: AgentSession): string {
  if (session.llmSummary) return session.llmSummary.slice(0, 60)
  const firstUserMsg = session.messages?.find((m) => m.role === 'user')
  if (firstUserMsg) return getTextContent(firstUserMsg).slice(0, 60) || '新对话'
  return '新对话'
}

export interface RecentSessionsSectionProps {
  sessions: AgentSession[]
  sessionsLoading: boolean
  sessionsCount: number
  onNewChat: () => void
  onOpenSession: (sessionId: string) => void
  animationIndex?: number
}

const SessionItem = memo(function SessionItem({
  session,
  onClick
}: {
  session: AgentSession
  onClick: () => void
}) {
  const title = getSessionTitle(session)
  const msgCount = session.messages?.length ?? 0

  return (
    <div
      className="home-session-item"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <div className="home-session-item__icon">
        <MessageSquare size={16} />
      </div>
      <div className="home-session-item__content">
        <span className="home-session-item__title">{title}</span>
        <span className="home-session-item__meta">
          <Clock size={11} />
          {formatRelativeTime(session.updatedAt)}
          {msgCount > 0 && <span> · {msgCount} 条消息</span>}
        </span>
      </div>
    </div>
  )
})

export default function RecentSessionsSection({
  sessions,
  sessionsLoading,
  sessionsCount,
  onNewChat,
  onOpenSession,
  animationIndex = 0
}: RecentSessionsSectionProps) {
  return (
    <motion.div className="home-card home-card--sessions" {...fadeUp(animationIndex)}>
      <div className="home-card__header">
        <Icon icon={MessageSquare} size="small" />
        <span className="home-card__title">最近对话</span>
        <Tag size="small">{sessionsCount}</Tag>
      </div>
      <div className="home-card__body">
        {sessionsLoading ? (
          <div className="home-loading-placeholder">加载中...</div>
        ) : sessions.length === 0 ? (
          <div className="home-empty-state">
            <Text type="secondary">暂无对话</Text>
            <Button size="small" type="primary" onClick={onNewChat}>
              开始第一个对话
            </Button>
          </div>
        ) : (
          <div className="home-session-list">
            <div
              className="home-session-item home-session-item--new"
              role="button"
              tabIndex={0}
              onClick={onNewChat}
              onKeyDown={(e) => e.key === 'Enter' && onNewChat()}
            >
              <div className="home-session-item__icon home-session-item__icon--new">
                <Plus size={18} />
              </div>
              <div className="home-session-item__content">
                <span className="home-session-item__title">新建对话</span>
                <span className="home-session-item__meta">开始一段新的 AI 对话</span>
              </div>
            </div>
            {sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                onClick={() => onOpenSession(session.id)}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
