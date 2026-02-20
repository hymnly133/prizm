/**
 * AccentSpotlightCard — 包装 @lobehub/ui SpotlightCard
 *
 * 1. 将聚光灯渐变颜色从中性 colorTextBase 替换为主题 accent / primaryColor
 * 2. 扁平化内部卡片嵌套：移除 renderItem 根元素的 border / background / box-shadow，
 *    由 SpotlightCard 自身的 content 层统一提供卡片外观
 */
import { SpotlightCard } from '@lobehub/ui/awesome'
import type { SpotlightCardProps } from '@lobehub/ui/awesome'
import { createStyles, cx } from 'antd-style'

const useStyles = createStyles(({ css, token, isDarkMode }) => ({
  accent: css`
    /* ── Accent spotlight gradient ── */
    .hover-card::before {
      background: radial-gradient(
        var(--spotlight-card-size, 800px) circle at var(--mouse-x) var(--mouse-y),
        color-mix(in srgb, ${token.colorPrimary} ${isDarkMode ? '10%' : '4%'}, transparent),
        transparent 40%
      ) !important;
    }
    .hover-card::after {
      background: radial-gradient(
        calc(var(--spotlight-card-size, 800px) * 0.75) circle at var(--mouse-x) var(--mouse-y),
        color-mix(in srgb, ${token.colorPrimary} ${isDarkMode ? '45%' : '22%'}, transparent),
        transparent 40%
      ) !important;
    }

    /* ── Flatten inner card nesting ── */
    .hover-card > * > * {
      border: none !important;
      background: transparent !important;
      box-shadow: none !important;
    }
  `
}))

export function AccentSpotlightCard<T>(props: SpotlightCardProps<T>) {
  const { styles } = useStyles()
  const { className, ...rest } = props
  return <SpotlightCard className={cx(styles.accent, className)} {...rest} />
}

export type { SpotlightCardProps }
