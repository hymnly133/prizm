/**
 * UserOverviewCard — Hero 身份卡片
 * 渐变背景，展示用户身份、工作区、连接状态和连接时长
 * 统计数据已移至 UserPage 的 SpotlightCard
 */
import { Tag } from '@lobehub/ui'
import { Clock, User as UserIcon, Wifi, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { useScope } from '../hooks/useScope'
import { useUserProfile } from '../hooks/useUserProfile'
import { createStyles } from 'antd-style'

const useStyles = createStyles(({ css, token }) => ({
  hero: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 24px 28px;
    border-radius: 16px;
    background: linear-gradient(
      135deg,
      ${token.colorPrimaryBg} 0%,
      ${token.colorPrimaryBgHover} 100%
    );
    border: 1px solid ${token.colorPrimaryBorder};
  `,
  identity: css`
    display: flex;
    align-items: center;
    gap: 14px;
    flex: 1;
    min-width: 0;
  `,
  avatar: css`
    width: 48px;
    height: 48px;
    border-radius: 14px;
    background: ${token.colorBgContainer};
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${token.colorPrimary};
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  `,
  info: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  `,
  clientName: css`
    font-size: 22px;
    font-weight: 700;
    color: ${token.colorText};
    letter-spacing: -0.3px;
    line-height: 1.2;
  `,
  scopeRow: css`
    font-size: 13px;
    color: ${token.colorTextSecondary};
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  statusGroup: css`
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    flex-shrink: 0;
  `,
  connectionBadge: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 20px;
    background: ${token.colorBgContainer};
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  `,
  connected: css`
    color: ${token.colorSuccess};
  `,
  disconnected: css`
    color: ${token.colorTextQuaternary};
  `,
  uptimeBadge: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: ${token.colorTextSecondary};
  `
}))

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟`
  const hours = Math.floor(minutes / 60)
  const remainMin = minutes % 60
  if (hours < 24) return remainMin > 0 ? `${hours}时${remainMin}分` : `${hours}小时`
  const days = Math.floor(hours / 24)
  const remainHours = hours % 24
  return remainHours > 0 ? `${days}天${remainHours}时` : `${days}天`
}

export function UserOverviewCard() {
  const { styles, cx } = useStyles()
  const { manager, config } = usePrizmContext()
  const { currentScope, getScopeLabel } = useScope()
  const { profile } = useUserProfile()
  const [connectedSince] = useState(() => Date.now())
  const [uptime, setUptime] = useState('0秒')

  useEffect(() => {
    const id = setInterval(() => {
      setUptime(formatDuration(Date.now() - connectedSince))
    }, 10_000)
    setUptime(formatDuration(Date.now() - connectedSince))
    return () => clearInterval(id)
  }, [connectedSince])

  const isConnected = !!manager
  const displayName = profile?.displayName?.trim() || config?.client?.name || 'Prizm Client'

  return (
    <div className={styles.hero}>
      <div className={styles.identity}>
        <div className={styles.avatar}>
          <UserIcon size={24} />
        </div>
        <div className={styles.info}>
          <span className={styles.clientName}>{displayName}</span>
          <span className={styles.scopeRow}>
            工作区 <Tag size="small">{getScopeLabel(currentScope)}</Tag>
          </span>
        </div>
      </div>
      <div className={styles.statusGroup}>
        <span
          className={cx(
            styles.connectionBadge,
            isConnected ? styles.connected : styles.disconnected
          )}
        >
          {isConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
          {isConnected ? '已连接' : '未连接'}
        </span>
        <span className={styles.uptimeBadge}>
          <Clock size={11} />
          {uptime}
        </span>
      </div>
    </div>
  )
}
