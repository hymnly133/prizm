/**
 * HomeStatsSection - 工作区概览统计卡片（SpotlightCard）
 */
import { motion } from 'motion/react'
import { SpotlightCard } from '@lobehub/ui/awesome'
import { Sparkles } from 'lucide-react'
import { fadeUpStagger } from '../theme/motionPresets'
import { SectionHeader } from '../components/ui/SectionHeader'
import { StatCard } from '../components/ui/StatCard'

export interface StatItem {
  icon: React.ReactNode
  label: string
  value: string
  color: string
  description?: string
  onClick?: () => void
}

export interface HomeStatsSectionProps {
  /** 统计项（会话、文档、User 记忆、Scope 记忆等） */
  items: StatItem[]
  /** 用于 stagger 动画的序号 */
  animationIndex?: number
}

export default function HomeStatsSection({ items, animationIndex = 0 }: HomeStatsSectionProps) {
  const renderStatItem = (item: StatItem) => (
    <StatCard
      icon={item.icon}
      iconColor={item.color}
      label={item.label}
      value={item.value}
      description={item.description}
      onClick={item.onClick}
    />
  )

  const columns = Math.min(items.length, 4)

  return (
    <motion.div {...fadeUpStagger(animationIndex)}>
      <SectionHeader icon={Sparkles} title="工作区概览" />
      <SpotlightCard
        items={items}
        renderItem={renderStatItem}
        columns={columns}
        gap="12px"
        size={400}
        borderRadius={12}
        className="home-spotlight-stats"
      />
    </motion.div>
  )
}
