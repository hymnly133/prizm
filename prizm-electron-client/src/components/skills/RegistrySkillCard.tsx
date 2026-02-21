/**
 * 统一的「Registry 技能」条目卡片
 * 用于精选/搜索、SkillKit、SkillsMP、集合仓库等列表，保证视觉与交互一致。
 */
import { memo } from 'react'
import { ActionIcon, Button, Flexbox, Tag, Text } from '@lobehub/ui'
import { ContentCard } from '../ui/ContentCard'
import { Download, ExternalLink, Star } from 'lucide-react'

export interface RegistrySkillCardItem {
  name: string
  description: string
  owner: string
  repo: string
  skillPath: string
  stars?: number
  htmlUrl?: string
  installed?: boolean
  /** SkillKit 等源的评分 */
  score?: number
}

export interface RegistrySkillCardProps {
  item: RegistrySkillCardItem
  installed?: boolean
  installing?: boolean
  onInstall: () => void
  /** 显示 GitHub stars（精选/搜索） */
  showStars?: boolean
  /** 显示评分（SkillKit） */
  showScore?: boolean
}

function RegistrySkillCardInner({
  item,
  installed = false,
  installing = false,
  onInstall,
  showStars = false,
  showScore = false
}: RegistrySkillCardProps) {
  const isInstalled = installed || item.installed

  return (
    <ContentCard
      variant="default"
      hoverable
      className="skill-entry-card"
      style={{ cursor: 'default' }}
    >
      <div className="skill-entry-card__row" style={{ cursor: 'default' }}>
        <Download
          size={16}
          style={{ color: 'var(--ant-color-primary)', flexShrink: 0 }}
          aria-hidden
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="skill-entry-card__title">{item.name}</div>
          <div className="skill-entry-card__desc">{item.description}</div>
        </div>
        <div className="skill-entry-card__meta">
          {showScore && item.score != null && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {item.score} 分
            </Text>
          )}
          {showStars && item.stars != null && item.stars > 0 && (
            <Flexbox
              horizontal
              gap={4}
              align="center"
              style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)' }}
            >
              <Star size={12} aria-hidden />
              {item.stars >= 1000 ? `${(item.stars / 1000).toFixed(1)}k` : item.stars}
            </Flexbox>
          )}
          {item.htmlUrl && (
            <ActionIcon
              icon={ExternalLink}
              size="small"
              title="在 GitHub 上查看"
              aria-label={`在 GitHub 上查看 ${item.name}`}
              onClick={() => window.open(item.htmlUrl, '_blank')}
            />
          )}
          {isInstalled ? (
            <Tag color="green" style={{ fontSize: 11 }}>
              已安装
            </Tag>
          ) : (
            <Button size="small" type="primary" loading={installing} onClick={onInstall}>
              安装
            </Button>
          )}
        </div>
      </div>
    </ContentCard>
  )
}

export const RegistrySkillCard = memo(RegistrySkillCardInner)
