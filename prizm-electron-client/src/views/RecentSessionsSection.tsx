/**
 * RecentSessionsSection - 最近对话卡片
 * 使用 LobeUI List 统一列表风格
 */
import { useMemo } from 'react'
import { motion } from 'motion/react'
import { Button, Icon } from '@lobehub/ui'
import type { ListItemProps } from '@lobehub/ui'
import { AccentList } from '../components/ui/AccentList'
import { ArrowRight, MessageSquare, Plus, Clock } from 'lucide-react'
import { getTextContent } from '@prizm/client-core'
import type { AgentSession } from '@prizm/client-core'
import { formatRelativeTime } from '../utils/formatRelativeTime'
import { fadeUpStagger } from '../theme/motionPresets'
import { SectionHeader } from '../components/ui/SectionHeader'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingPlaceholder } from '../components/ui/LoadingPlaceholder'

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
  onViewAll?: () => void
  animationIndex?: number
}

export default function RecentSessionsSection({
  sessions,
  sessionsLoading,
  sessionsCount,
  onNewChat,
  onOpenSession,
  onViewAll,
  animationIndex = 0
}: RecentSessionsSectionProps) {
  const listItems: ListItemProps[] = useMemo(() => {
    const newItem: ListItemProps = {
      key: '__new__',
      avatar: <Plus size={18} />,
      title: '新建对话',
      description: '开始一段新的 AI 对话',
      onClick: onNewChat
    }
    const sessionItems: ListItemProps[] = sessions.map((s) => {
      const msgCount = s.messages?.length ?? 0
      return {
        key: s.id,
        avatar: <MessageSquare size={16} />,
        title: getSessionTitle(s),
        description: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Clock size={11} />
            {formatRelativeTime(s.updatedAt)}
            {msgCount > 0 && <span> · {msgCount} 条消息</span>}
          </span>
        ),
        onClick: () => onOpenSession(s.id)
      }
    })
    return [newItem, ...sessionItems]
  }, [sessions, onNewChat, onOpenSession])

  return (
    <motion.div
      className="content-card content-card--default content-card--hoverable home-card--sessions"
      {...fadeUpStagger(animationIndex)}
    >
      <SectionHeader
        icon={MessageSquare}
        title="最近对话"
        count={sessionsCount}
        className="content-card__header home-card__header"
        extra={
          onViewAll && (
            <Button
              size="small"
              type="text"
              icon={<Icon icon={ArrowRight} size="small" />}
              iconPlacement="end"
              onClick={onViewAll}
            >
              查看全部
            </Button>
          )
        }
      />
      <div className="content-card__body">
        {sessionsLoading ? (
          <LoadingPlaceholder />
        ) : sessions.length === 0 ? (
          <EmptyState
            description="暂无对话"
            actions={
              <Button size="small" type="primary" onClick={onNewChat}>
                开始第一个对话
              </Button>
            }
          />
        ) : (
          <AccentList items={listItems} />
        )}
      </div>
    </motion.div>
  )
}
