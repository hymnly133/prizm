import { ActionIcon } from '@lobehub/ui'
import { Button, Empty, Popconfirm, Tag, Tooltip } from 'antd'
import { Undo2 } from 'lucide-react'
import type { DedupLogEntry } from '@prizm/client-core'
import { useMemoryStyles } from './styles'

interface DedupLogProps {
  entries: DedupLogEntry[]
  loading: boolean
  undoingId: string | null
  onRefresh: () => void
  onUndo: (id: string) => void
}

export function DedupLog({ entries, loading, undoingId, onRefresh, onUndo }: DedupLogProps) {
  const { styles } = useMemoryStyles()

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.dedupHintText}>
          当记忆被判定为重复时，系统会抑制新记忆并保留已有记忆。你可以在此查看并回退。
        </span>
        <Button size="small" onClick={onRefresh} loading={loading}>
          刷新
        </Button>
      </div>

      <div className={styles.partition}>
        {loading ? (
          <div className={styles.empty}>加载中...</div>
        ) : entries.length === 0 ? (
          <div className={styles.empty}>
            <Empty description="暂无去重记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={styles.dedupItem}>
              <div className={styles.dedupHeader}>
                <div className={styles.dedupMemoryPair}>
                  <div>
                    <span className={styles.dedupLabel}>已保留</span>
                    <div className={styles.dedupContent}>
                      {entry.kept_memory_content || '(内容不可用)'}
                    </div>
                  </div>
                  <div>
                    <span className={styles.dedupLabel}>被抑制（新）</span>
                    <div className={styles.dedupContent}>{entry.new_memory_content}</div>
                  </div>
                </div>
                <div className={styles.actions}>
                  <Popconfirm
                    title="恢复被抑制的记忆？"
                    description="这将重新插入被去重的记忆到记忆库中。"
                    onConfirm={() => onUndo(entry.id)}
                    okText="恢复"
                    cancelText="取消"
                  >
                    <Tooltip title="恢复被抑制的记忆">
                      <ActionIcon icon={Undo2} size="small" loading={undoingId === entry.id} />
                    </Tooltip>
                  </Popconfirm>
                </div>
              </div>
              <div className={styles.dedupMeta}>
                <Tag variant="filled" color="blue">
                  {entry.new_memory_type}
                </Tag>
                {entry.text_similarity != null && Number(entry.text_similarity) >= 0 && (
                  <Tooltip title="文本相似度分数 (Dice/Jaccard max)">
                    <Tag variant="filled" color="cyan" style={{ cursor: 'help' }}>
                      文本: {Number(entry.text_similarity).toFixed(3)}
                    </Tag>
                  </Tooltip>
                )}
                {entry.vector_distance != null && Number(entry.vector_distance) >= 0 && (
                  <Tooltip title="向量 L2 距离（越小越相似）">
                    <Tag variant="filled" color="geekblue" style={{ cursor: 'help' }}>
                      向量: {Number(entry.vector_distance).toFixed(3)}
                    </Tag>
                  </Tooltip>
                )}
                {entry.llm_reasoning && (
                  <Tooltip title={entry.llm_reasoning}>
                    <Tag variant="filled" color="purple" style={{ cursor: 'help' }}>
                      LLM 判定
                    </Tag>
                  </Tooltip>
                )}
                <span>
                  {entry.created_at ? new Date(entry.created_at).toLocaleString() : '未知时间'}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
