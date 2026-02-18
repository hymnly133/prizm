/**
 * Memory stats visualization using lightweight CSS bar charts.
 * Shows distribution by type and layer without requiring a charting library.
 */
import { useCallback, useEffect, useState } from 'react'
import { Tag } from '@lobehub/ui'
import { usePrizmContext } from '../../context/PrizmContext'
import { useScope } from '../../hooks/useScope'
import type { MemoryItem } from '@prizm/client-core'
import { createStyles } from 'antd-style'

const MEMORY_TYPE_COLORS: Record<string, string> = {
  narrative: '#1677ff',
  foresight: '#722ed1',
  document: '#52c41a',
  event_log: '#13c2c2',
  profile: '#faad14'
}

const MEMORY_TYPE_LABELS: Record<string, string> = {
  narrative: '叙事记忆',
  foresight: '前瞻记忆',
  document: '文档记忆',
  event_log: '事件日志',
  profile: '用户画像'
}

const LAYER_COLORS: Record<string, string> = {
  user: '#faad14',
  scope: '#1677ff',
  session: '#13c2c2'
}

const LAYER_LABELS: Record<string, string> = {
  user: 'User',
  scope: 'Scope',
  session: 'Session'
}

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 20px;
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  sectionTitle: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
  `,
  barList: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  barRow: css`
    display: flex;
    align-items: center;
    gap: 10px;
  `,
  barLabel: css`
    font-size: 12px;
    color: ${token.colorTextSecondary};
    width: 72px;
    flex-shrink: 0;
    text-align: right;
  `,
  barTrack: css`
    flex: 1;
    height: 20px;
    background: ${token.colorFillQuaternary};
    border-radius: 4px;
    overflow: hidden;
    position: relative;
  `,
  barFill: css`
    height: 100%;
    border-radius: 4px;
    transition: width 0.4s ease;
    min-width: 2px;
  `,
  barCount: css`
    font-size: 12px;
    font-weight: 600;
    color: ${token.colorText};
    width: 36px;
    flex-shrink: 0;
    text-align: right;
  `,
  totalRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    font-size: 13px;
    color: ${token.colorTextSecondary};
  `,
  empty: css`
    font-size: 13px;
    color: ${token.colorTextQuaternary};
    padding: 16px 0;
    text-align: center;
  `
}))

type DistributionItem = { key: string; label: string; count: number; color: string }

export function MemoryStatsChart() {
  const { styles } = useStyles()
  const { manager } = usePrizmContext()
  const { currentScope } = useScope()
  const [byType, setByType] = useState<DistributionItem[]>([])
  const [byLayer, setByLayer] = useState<DistributionItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const loadStats = useCallback(async () => {
    const http = manager?.getHttpClient()
    if (!http) return
    setLoading(true)
    try {
      const res = await http.getMemories(currentScope)
      if (!res.enabled) {
        setByType([])
        setByLayer([])
        setTotal(0)
        return
      }
      const memories = res.memories as (MemoryItem & { group_id?: string; memory_layer?: string })[]
      setTotal(memories.length)

      const typeCounts: Record<string, number> = {}
      const layerCounts: Record<string, number> = { user: 0, scope: 0, session: 0 }

      for (const m of memories) {
        const mt = m.memory_type || 'narrative'
        typeCounts[mt] = (typeCounts[mt] || 0) + 1

        let layer = 'scope'
        if (m.memory_layer === 'user') layer = 'user'
        else if (m.memory_layer === 'session') layer = 'session'
        else if (m.memory_layer === 'scope') layer = 'scope'
        else {
          const gid = m.group_id ?? ''
          if (!gid || gid === 'user') layer = 'user'
          else if (gid.includes(':session:')) layer = 'session'
        }
        layerCounts[layer]++
      }

      setByType(
        Object.entries(typeCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([key, count]) => ({
            key,
            label: MEMORY_TYPE_LABELS[key] ?? key,
            count,
            color: MEMORY_TYPE_COLORS[key] ?? '#999'
          }))
      )

      setByLayer(
        ['user', 'scope', 'session'].map((key) => ({
          key,
          label: LAYER_LABELS[key],
          count: layerCounts[key] || 0,
          color: LAYER_COLORS[key]
        }))
      )
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [manager, currentScope])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  if (loading) {
    return <div className={styles.empty}>加载中...</div>
  }

  if (total === 0) {
    return <div className={styles.empty}>暂无记忆数据</div>
  }

  function renderBars(items: DistributionItem[]) {
    const max = Math.max(...items.map((i) => i.count), 1)
    return (
      <div className={styles.barList}>
        {items.map((item) => (
          <div key={item.key} className={styles.barRow}>
            <span className={styles.barLabel}>{item.label}</span>
            <div className={styles.barTrack}>
              <div
                className={styles.barFill}
                style={{
                  width: `${(item.count / max) * 100}%`,
                  backgroundColor: item.color
                }}
              />
            </div>
            <span className={styles.barCount}>{item.count}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.totalRow}>
        共 <Tag size="small">{total}</Tag> 条记忆
      </div>

      <div className={styles.section}>
        <span className={styles.sectionTitle}>按类型分布</span>
        {renderBars(byType)}
      </div>

      <div className={styles.section}>
        <span className={styles.sectionTitle}>按层级分布</span>
        {renderBars(byLayer)}
      </div>
    </div>
  )
}
