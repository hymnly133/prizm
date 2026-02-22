/**
 * FeedbackOverview — 首页反馈概览区块
 *
 * 展示总反馈数、好评率环形进度、最近反馈列表
 */
import { useEffect, useState, useMemo, memo } from 'react'
import { Progress, Tag, Empty } from 'antd'
import { Flexbox } from '@lobehub/ui'
import { ThumbsUp, ThumbsDown, Minus, MessageSquareHeart } from 'lucide-react'
import { createStyles } from 'antd-style'
import type { FeedbackEntry, FeedbackStats } from '@prizm/shared'
import { usePrizmContext } from '../../context/PrizmContext'
import { useScope } from '../../hooks/useScope'
import { SectionHeader } from '../ui/SectionHeader'
import { formatRelativeTime } from '../../utils/formatRelativeTime'

const useStyles = createStyles(({ css, token, isDarkMode }) => ({
  root: css`
    padding: 0;
  `,
  statsRow: css`
    display: flex;
    gap: 20px;
    align-items: center;
    flex-wrap: wrap;
  `,
  ringBox: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 80px;
  `,
  ringLabel: css`
    font-size: 11px;
    color: ${token.colorTextSecondary};
    font-weight: 500;
  `,
  countsRow: css`
    display: flex;
    gap: 16px;
    flex: 1;
    flex-wrap: wrap;
  `,
  countItem: css`
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: ${token.colorText};
    font-variant-numeric: tabular-nums;
  `,
  countDot: css`
    width: 8px;
    height: 8px;
    border-radius: 4px;
    flex-shrink: 0;
  `,
  recentList: css`
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  recentItem: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 8px;
    background: ${isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)'};
    font-size: 12px;
    transition: background 0.15s;
    &:hover {
      background: ${isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)'};
    }
  `,
  recentRating: css`
    flex-shrink: 0;
    display: flex;
    align-items: center;
  `,
  recentTarget: css`
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: ${token.colorText};
  `,
  recentComment: css`
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: ${token.colorTextSecondary};
    font-style: italic;
  `,
  recentTime: css`
    flex-shrink: 0;
    color: ${token.colorTextQuaternary};
    font-size: 11px;
  `
}))

const TARGET_LABELS: Record<string, string> = {
  chat_message: '对话',
  document: '文档',
  workflow_run: '工作流',
  workflow_step: '步骤',
  task_run: '任务'
}

const RATING_ICON_MAP = {
  like: { icon: ThumbsUp, color: 'var(--ant-color-success)' },
  neutral: { icon: Minus, color: 'var(--ant-color-text-tertiary)' },
  dislike: { icon: ThumbsDown, color: 'var(--ant-color-error)' }
} as const

export const FeedbackOverview = memo(function FeedbackOverview() {
  const { styles } = useStyles()
  const { manager } = usePrizmContext() ?? {}
  const { currentScope } = useScope()
  const http = manager?.getHttpClient()

  const [stats, setStats] = useState<FeedbackStats | null>(null)
  const [recent, setRecent] = useState<FeedbackEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!http) return
    setLoading(true)
    Promise.all([
      http.getFeedbackStats({}, currentScope),
      http.getFeedback({ limit: 5 }, currentScope)
    ])
      .then(([s, r]) => {
        setStats(s)
        setRecent(r)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [http, currentScope])

  const likeRate = useMemo(() => {
    if (!stats || stats.total === 0) return 0
    return Math.round((stats.like / stats.total) * 100)
  }, [stats])

  if (loading || !stats || stats.total === 0) {
    return null
  }

  return (
    <div className={styles.root}>
      <SectionHeader icon={MessageSquareHeart} title="反馈概览" count={stats.total} />

      <div className="content-card content-card--default" style={{ padding: '16px 20px' }}>
        <div className={styles.statsRow}>
          <div className={styles.ringBox}>
            <Progress
              type="circle"
              percent={likeRate}
              size={56}
              strokeColor="var(--ant-color-success)"
              trailColor="var(--ant-color-fill-quaternary)"
              format={(p) => `${p}%`}
            />
            <span className={styles.ringLabel}>好评率</span>
          </div>

          <div className={styles.countsRow}>
            <div className={styles.countItem}>
              <span className={styles.countDot} style={{ background: 'var(--ant-color-success)' }} />
              喜欢 {stats.like}
            </div>
            <div className={styles.countItem}>
              <span className={styles.countDot} style={{ background: 'var(--ant-color-text-tertiary)' }} />
              一般 {stats.neutral}
            </div>
            <div className={styles.countItem}>
              <span className={styles.countDot} style={{ background: 'var(--ant-color-error)' }} />
              不喜欢 {stats.dislike}
            </div>
          </div>
        </div>

        {recent.length > 0 && (
          <div className={styles.recentList}>
            {recent.map((entry) => {
              const cfg = RATING_ICON_MAP[entry.rating]
              const IconComp = cfg.icon
              return (
                <div key={entry.id} className={styles.recentItem}>
                  <span className={styles.recentRating}>
                    <IconComp size={13} style={{ color: cfg.color }} />
                  </span>
                  <Tag color="default" style={{ fontSize: 11, lineHeight: 1.4, margin: 0 }}>
                    {TARGET_LABELS[entry.targetType] ?? entry.targetType}
                  </Tag>
                  <span className={styles.recentTarget}>
                    {entry.targetId.slice(0, 12)}
                  </span>
                  {entry.comment && (
                    <span className={styles.recentComment} title={entry.comment}>
                      {entry.comment}
                    </span>
                  )}
                  <span className={styles.recentTime}>
                    {formatRelativeTime(entry.createdAt)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})
