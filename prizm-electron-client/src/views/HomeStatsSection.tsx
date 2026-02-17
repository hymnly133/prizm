/**
 * HomeStatsSection - 工作区概览统计卡片（SpotlightCard）
 */
import { motion } from 'motion/react'
import { Icon } from '@lobehub/ui'
import { SpotlightCard } from '@lobehub/ui/awesome'
import { Sparkles } from 'lucide-react'

const STAGGER_DELAY = 0.06
const EASE_SMOOTH = [0.33, 1, 0.68, 1] as const

function fadeUp(index: number) {
  return {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: index * STAGGER_DELAY, duration: 0.4, ease: EASE_SMOOTH }
  }
}

export interface StatItem {
  icon: React.ReactNode
  label: string
  value: string
  color: string
  description?: string
}

export interface HomeStatsSectionProps {
  /** 统计项（会话、文档、User 记忆、Scope 记忆等） */
  items: StatItem[]
  /** 用于 stagger 动画的序号 */
  animationIndex?: number
}

export default function HomeStatsSection({
  items,
  animationIndex = 0
}: HomeStatsSectionProps) {
  const renderStatItem = (item: StatItem) => (
    <div className="home-stat-card">
      <div className="home-stat-card__icon" style={{ color: item.color }}>
        {item.icon}
      </div>
      <div className="home-stat-card__info">
        <span className="home-stat-card__value">{item.value}</span>
        <span className="home-stat-card__label">{item.label}</span>
        {item.description != null && (
          <span className="home-stat-card__desc">{item.description}</span>
        )}
      </div>
    </div>
  )

  return (
    <motion.div {...fadeUp(animationIndex)}>
      <div className="home-section-header">
        <Icon icon={Sparkles} size="small" />
        <span className="home-section-title">工作区概览</span>
      </div>
      <SpotlightCard
        items={items}
        renderItem={renderStatItem}
        columns={4}
        gap="12px"
        size={400}
        borderRadius={12}
        className="home-spotlight-stats"
      />
    </motion.div>
  )
}
