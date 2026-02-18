/**
 * SettingsListItem — Settings 页管理型列表项的统一组件
 * 基于 LobeUI Flexbox + antd-style createStyles，自动跟随 accent color
 */
import type { ReactNode } from 'react'
import { Flexbox, Text } from '@lobehub/ui'
import { createStyles } from 'antd-style'

const useStyles = createStyles(({ css, token }) => ({
  root: css`
    padding: 10px 14px;
    border-radius: ${token.borderRadiusLG}px;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorFillQuaternary};
    transition: all 0.2s;

    &:hover {
      background: ${token.colorFillTertiary};
      box-shadow: inset 3px 0 0 ${token.colorPrimary};
    }
  `,
  disabled: css`
    opacity: 0.6;
    border-color: ${token.colorBorder};
    background: transparent;
  `
}))

export interface SettingsListItemProps {
  icon?: ReactNode
  title: ReactNode
  badges?: ReactNode
  description?: ReactNode
  enabled?: boolean
  actions?: ReactNode
  onClick?: () => void
  className?: string
}

export function SettingsListItem({
  icon,
  title,
  badges,
  description,
  enabled = true,
  actions,
  onClick,
  className
}: SettingsListItemProps) {
  const { styles, cx } = useStyles()

  return (
    <Flexbox
      horizontal
      align="center"
      justify="space-between"
      className={cx(styles.root, !enabled && styles.disabled, className)}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Flexbox horizontal gap={8} align="center">
          {icon}
          <Text style={{ fontWeight: 600 }}>{title}</Text>
          {badges}
        </Flexbox>
        {description && (
          <Text
            type="secondary"
            style={{
              fontSize: 12,
              marginLeft: icon ? 22 : 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {description}
          </Text>
        )}
      </Flexbox>
      {actions && (
        <Flexbox horizontal gap={4} style={{ flexShrink: 0, marginLeft: 8 }}>
          {actions}
        </Flexbox>
      )}
    </Flexbox>
  )
}
