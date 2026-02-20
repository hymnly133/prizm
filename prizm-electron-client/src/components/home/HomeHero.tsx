/**
 * HomeHero — 统一首页头部
 *
 * 拆分为两个区域（通过 Fragment 返回）：
 * 1. heroTop — 问候/身份/状态，随页面自然滚动
 * 2. heroNav — Tabs + Quick Actions，position:sticky 吸顶常驻
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Icon, Tag } from '@lobehub/ui'
import { Clock, FileText, Import, ListTodo, Plus, User as UserIcon, Wifi, WifiOff } from 'lucide-react'
import { createStyles } from 'antd-style'
import { Segmented } from '../ui/Segmented'
import { usePrizmContext } from '../../context/PrizmContext'
import { useScope } from '../../hooks/useScope'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

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

const useStyles = createStyles(({ css, token }) => ({
  heroTop: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 28px 14px;
    background: linear-gradient(
      135deg,
      ${token.colorPrimaryBg} 0%,
      ${token.colorPrimaryBgHover} 100%
    );
    flex-shrink: 0;
  `,
  heroNav: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 28px;
    background: linear-gradient(
      135deg,
      ${token.colorPrimaryBg} 0%,
      ${token.colorPrimaryBgHover} 100%
    );
    border-bottom: 1px solid ${token.colorPrimaryBorder};
    position: sticky;
    top: 0;
    z-index: 10;
    flex-shrink: 0;
    transition: box-shadow 0.2s;

    &[data-stuck='true'] {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }
  `,
  identity: css`
    display: flex;
    align-items: center;
    gap: 14px;
    flex: 1;
    min-width: 0;
  `,
  avatar: css`
    width: 44px;
    height: 44px;
    border-radius: 12px;
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
    gap: 2px;
    min-width: 0;
  `,
  greetingRow: css`
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 20px;
    font-weight: 700;
    color: ${token.colorText};
    letter-spacing: -0.3px;
    line-height: 1.3;
  `,
  clientName: css`
    font-size: 20px;
    font-weight: 700;
    color: ${token.colorText};
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
    align-items: center;
    gap: 10px;
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
    padding: 4px 8px;
    border-radius: 12px;
    background: ${token.colorBgContainer};
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  `,
  quickActions: css`
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  `
}))

interface HomeHeroProps {
  activeTab: string
  onTabChange: (val: string | number) => void
  tabOptions: { label: string; value: string }[]
  onNewChat: () => void
  onNavigateToWork: () => void
  onImport: () => void
  extra?: ReactNode
}

export function HomeHero({
  activeTab,
  onTabChange,
  tabOptions,
  onNewChat,
  onNavigateToWork,
  onImport
}: HomeHeroProps) {
  const { styles, cx } = useStyles()
  const { manager, config } = usePrizmContext()
  const { currentScope, getScopeLabel } = useScope()
  const [connectedSince] = useState(() => Date.now())
  const [uptime, setUptime] = useState('0秒')
  const [stuck, setStuck] = useState(false)
  const [navEl, setNavEl] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    const id = setInterval(() => {
      setUptime(formatDuration(Date.now() - connectedSince))
    }, 10_000)
    setUptime(formatDuration(Date.now() - connectedSince))
    return () => clearInterval(id)
  }, [connectedSince])

  useEffect(() => {
    if (!navEl) return
    const sentinel = document.createElement('div')
    sentinel.style.height = '1px'
    sentinel.style.marginBottom = '-1px'
    sentinel.style.pointerEvents = 'none'
    navEl.parentElement?.insertBefore(sentinel, navEl)
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 1, rootMargin: '-1px 0px 0px 0px' }
    )
    observer.observe(sentinel)
    return () => {
      observer.disconnect()
      sentinel.remove()
    }
  }, [navEl])

  const isConnected = !!manager
  const clientName = config?.client?.name || 'Prizm Client'

  return (
    <>
      <div className={styles.heroTop}>
        <div className={styles.identity}>
          <div className={styles.avatar}>
            <UserIcon size={22} />
          </div>
          <div className={styles.info}>
            <div className={styles.greetingRow}>
              <span>{getGreeting()},</span>
              <span className={styles.clientName}>{clientName}</span>
            </div>
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

      <div
        ref={setNavEl}
        className={styles.heroNav}
        data-stuck={stuck}
      >
        <Segmented value={activeTab} onChange={onTabChange} options={tabOptions} size="middle" />
        <div className={styles.quickActions}>
          <Button icon={<Icon icon={Plus} size="small" />} onClick={onNewChat} type="primary" size="small">新对话</Button>
          <Button icon={<Icon icon={FileText} size="small" />} onClick={onNavigateToWork} size="small">文档</Button>
          <Button icon={<Icon icon={ListTodo} size="small" />} onClick={onNavigateToWork} size="small">待办</Button>
          <Button icon={<Icon icon={Import} size="small" />} onClick={onImport} size="small">导入</Button>
        </div>
      </div>
    </>
  )
}
