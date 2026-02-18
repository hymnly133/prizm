/**
 * AccentSegmented — 包装 @lobehub/ui Segmented，让选中项使用主题 accent color
 *
 * LobeUI 的 Segmented 选中项默认使用中性白/灰背景，不响应 primaryColor 设置。
 * 此包装通过 antd-style 注入 colorPrimaryBg / colorPrimaryText 样式，
 * 使选中项的背景和文字颜色跟随主题 accent color。
 */
import { Segmented as LobeSegmented } from '@lobehub/ui'
import type { SegmentedProps } from '@lobehub/ui'
import { createStyles } from 'antd-style'
import { cx } from 'antd-style'

const useStyles = createStyles(({ css, token }) => ({
  accent: css`
    .ant-segmented-thumb {
      background-color: ${token.colorPrimaryBg} !important;
    }
    .ant-segmented-item-selected {
      background-color: ${token.colorPrimaryBg} !important;
      color: ${token.colorPrimaryText} !important;
    }
    .ant-segmented-item:hover:not(.ant-segmented-item-selected) {
      color: ${token.colorPrimaryText} !important;
      background-color: ${token.colorPrimaryBgHover} !important;
    }
  `
}))

export function Segmented(props: SegmentedProps) {
  const { styles } = useStyles()
  const { className, ...rest } = props
  return <LobeSegmented className={cx(styles.accent, className)} {...rest} />
}

export type { SegmentedProps }
