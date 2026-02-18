/**
 * UserPage — 用户 Dashboard
 * 统一使用 SpotlightCard + motion 动画 + home-card 卡片风格
 */
import { memo, useMemo, useCallback } from 'react'
import { motion } from 'motion/react'
import { SpotlightCard } from '@lobehub/ui/awesome'
import {
  Activity,
  Brain,
  Coins,
  Eye,
  FileText,
  MessageSquare,
  Search,
  Sparkles,
  User as UserIcon
} from 'lucide-react'
import { fadeUpStagger } from '../theme/motionPresets'
import { useScopeStats } from '../hooks/useScopeStats'
import { UserOverviewCard } from '../components/UserOverviewCard'
import { TokenUsagePanel } from '../components/agent/TokenUsagePanel'
import { MemoryStatsChart } from '../components/agent/MemoryStatsChart'
import { MemoryInspector } from '../components/agent/MemoryInspector'
import { ActivityTimeline } from '../components/ActivityTimeline'
import { SectionHeader } from '../components/ui/SectionHeader'
import { StatCard } from '../components/ui/StatCard'
import type { StatItem } from './HomeStatsSection'

function UserPage() {
  const { stats, loading: statsLoading } = useScopeStats()
  const bt = stats.memoryByType

  const statItems = useMemo<StatItem[]>(
    () => [
      {
        icon: <MessageSquare size={20} />,
        label: '会话',
        value: statsLoading ? '...' : String(stats.sessionsCount),
        color: 'var(--ant-color-primary)'
      },
      {
        icon: <FileText size={20} />,
        label: '文档',
        value: statsLoading ? '...' : String(stats.documentsCount),
        color: 'var(--ant-color-success)'
      },
      {
        icon: <UserIcon size={20} />,
        label: '画像',
        value: statsLoading ? '...' : String(bt.profile),
        color: 'var(--ant-color-warning)',
        description: 'profile'
      },
      {
        icon: <Sparkles size={20} />,
        label: '叙事',
        value: statsLoading ? '...' : String(bt.narrative),
        color: 'var(--ant-geekblue-6, #2f54eb)',
        description: 'narrative'
      },
      {
        icon: <Eye size={20} />,
        label: '前瞻',
        value: statsLoading ? '...' : String(bt.foresight),
        color: '#13c2c2',
        description: 'foresight'
      },
      {
        icon: <Brain size={20} />,
        label: '文档记忆',
        value: statsLoading ? '...' : String(bt.document),
        color: 'var(--ant-color-success)',
        description: 'document'
      },
      {
        icon: <Activity size={20} />,
        label: '事件日志',
        value: statsLoading ? '...' : String(bt.event_log),
        color: '#eb2f96',
        description: 'event_log'
      }
    ],
    [statsLoading, stats, bt]
  )

  const renderStatItem = useCallback(
    (item: StatItem) => (
      <StatCard
        icon={item.icon}
        iconColor={item.color}
        label={item.label}
        value={item.value}
        description={item.description}
        onClick={item.onClick}
      />
    ),
    []
  )

  let sectionIdx = 0

  return (
    <div className="home-page">
      <div className="home-scroll-container">
        {/* Hero: 用户身份卡片 */}
        <motion.div {...fadeUpStagger(sectionIdx++)}>
          <UserOverviewCard />
        </motion.div>

        {/* 数据概览: SpotlightCard 统计网格 */}
        <motion.div {...fadeUpStagger(sectionIdx++)}>
          <SectionHeader icon={Sparkles} title="数据概览" />
          <SpotlightCard
            items={statItems}
            renderItem={renderStatItem}
            columns={Math.min(statItems.length, 4)}
            gap="12px"
            size={400}
            borderRadius={12}
            className="home-spotlight-stats"
          />
        </motion.div>

        {/* Token 用量 */}
        <motion.div className="content-card content-card--default content-card--hoverable" {...fadeUpStagger(sectionIdx++)}>
          <SectionHeader icon={Coins} title="Token 用量" className="content-card__header" />
          <div className="content-card__body">
            <TokenUsagePanel />
          </div>
        </motion.div>

        {/* 两栏网格: 活动时间线 + 记忆统计 */}
        <div className="home-grid">
          <motion.div className="content-card content-card--default content-card--hoverable" {...fadeUpStagger(sectionIdx++)}>
            <SectionHeader icon={Activity} title="活动时间线" className="content-card__header" />
            <div className="content-card__body">
              <ActivityTimeline />
            </div>
          </motion.div>
          <motion.div className="content-card content-card--default content-card--hoverable" {...fadeUpStagger(sectionIdx++)}>
            <SectionHeader icon={Brain} title="记忆统计" className="content-card__header" />
            <div className="content-card__body">
              <MemoryStatsChart />
            </div>
          </motion.div>
        </div>

        {/* 记忆查询 */}
        <motion.div className="content-card content-card--default content-card--hoverable" {...fadeUpStagger(sectionIdx++)}>
          <SectionHeader icon={Search} title="记忆查询" className="content-card__header" />
          <div className="content-card__body">
            <MemoryInspector />
          </div>
        </motion.div>
      </div>
    </div>
  )
}

export default memo(UserPage)
