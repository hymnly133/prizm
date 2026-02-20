/**
 * MemoryRingChart — 纯 CSS conic-gradient 环形图
 * 轻量可复用，无需图表库依赖
 */
import { useMemo, useState } from 'react'
import { createStyles } from 'antd-style'

export interface RingSegment {
  key: string
  label: string
  value: number
  color: string
}

interface MemoryRingChartProps {
  segments: RingSegment[]
  title?: string
  size?: number
}

const useStyles = createStyles(({ css, token }) => ({
  wrapper: css`
    display: flex;
    align-items: center;
    gap: 20px;
  `,
  ringOuter: css`
    position: relative;
    flex-shrink: 0;
  `,
  ring: css`
    border-radius: 50%;
    transition: transform 0.2s ease;
  `,
  ringCenter: css`
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  `,
  centerValue: css`
    font-size: 22px;
    font-weight: 700;
    color: ${token.colorText};
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  `,
  centerLabel: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    margin-top: 2px;
  `,
  legend: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  `,
  legendItem: css`
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: ${token.colorTextSecondary};
    padding: 4px 8px;
    border-radius: 6px;
    cursor: default;
    transition: background 0.15s;

    &:hover {
      background: ${token.colorFillQuaternary};
    }
  `,
  legendItemActive: css`
    background: ${token.colorFillTertiary};
  `,
  legendDot: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: transform 0.15s;
  `,
  legendDotActive: css`
    transform: scale(1.3);
  `,
  legendLabel: css`
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  legendValue: css`
    font-weight: 600;
    color: ${token.colorText};
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  `,
  legendPct: css`
    font-size: 10px;
    color: ${token.colorTextQuaternary};
    width: 32px;
    text-align: right;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  `,
  sectionTitle: css`
    font-size: 12px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
    margin-bottom: 4px;
  `
}))

export function MemoryRingChart({ segments, title, size = 120 }: MemoryRingChartProps) {
  const { styles, cx } = useStyles()
  const [hovered, setHovered] = useState<string | null>(null)

  const total = useMemo(() => segments.reduce((s, seg) => s + seg.value, 0), [segments])

  const conicGradient = useMemo(() => {
    if (total === 0) return 'conic-gradient(var(--ant-color-fill-tertiary) 0deg 360deg)'
    const parts: string[] = []
    let acc = 0
    for (const seg of segments) {
      if (seg.value <= 0) continue
      const startDeg = (acc / total) * 360
      acc += seg.value
      const endDeg = (acc / total) * 360
      parts.push(`${seg.color} ${startDeg.toFixed(1)}deg ${endDeg.toFixed(1)}deg`)
    }
    return `conic-gradient(${parts.join(', ')})`
  }, [segments, total])

  const thickness = size * 0.18

  return (
    <div>
      {title && <div className={styles.sectionTitle}>{title}</div>}
      <div className={styles.wrapper}>
        <div className={styles.ringOuter} style={{ width: size, height: size }}>
          <div
            className={styles.ring}
            style={{
              width: size,
              height: size,
              background: conicGradient,
              mask: `radial-gradient(circle ${size / 2 - thickness}px at center, transparent 99%, #000 100%)`,
              WebkitMask: `radial-gradient(circle ${size / 2 - thickness}px at center, transparent 99%, #000 100%)`
            }}
          />
          <div className={styles.ringCenter}>
            <span className={styles.centerValue}>{total}</span>
            <span className={styles.centerLabel}>总计</span>
          </div>
        </div>

        <div className={styles.legend}>
          {segments.map((seg) => {
            const pct = total > 0 ? ((seg.value / total) * 100).toFixed(0) : '0'
            const isActive = hovered === seg.key
            return (
              <div
                key={seg.key}
                className={cx(styles.legendItem, isActive && styles.legendItemActive)}
                onMouseEnter={() => setHovered(seg.key)}
                onMouseLeave={() => setHovered(null)}
              >
                <span
                  className={cx(styles.legendDot, isActive && styles.legendDotActive)}
                  style={{ background: seg.color }}
                />
                <span className={styles.legendLabel}>{seg.label}</span>
                <span className={styles.legendValue}>{seg.value}</span>
                <span className={styles.legendPct}>{pct}%</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
