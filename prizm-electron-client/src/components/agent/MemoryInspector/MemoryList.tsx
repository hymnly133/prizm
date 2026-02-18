import { ActionIcon } from '@lobehub/ui'
import { Empty, Popconfirm, Tag, Collapse, Tooltip, Spin } from 'antd'
import { Trash2, ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { EASE_SMOOTH } from '../../../theme/motionPresets'
import { useNavigation } from '../../../context/NavigationContext'
import type { MemoryItemWithGroup, SubCategory } from './types'
import {
  MEMORY_TYPE_LABELS,
  MEMORY_TYPE_COLORS,
  DOC_SUB_TYPE_LABELS,
  SOURCE_TYPE_LABELS,
  PARTITION_LABELS
} from './constants'
import {
  partitionMemories,
  subdivideUser,
  subdivideScope,
  subdivideSession
} from './partitionUtils'
import { useMemoryStyles } from './styles'

interface MemoryListProps {
  memories: MemoryItemWithGroup[]
  loading: boolean
  currentScope: string
  onDelete: (id: string) => void
}

export function MemoryList({ memories, loading, currentScope, onDelete }: MemoryListProps) {
  const { styles } = useMemoryStyles()
  const { navigateToAgentMessage } = useNavigation()

  if (memories.length === 0) {
    return (
      <div className={styles.empty}>
        {loading ? (
          <Spin tip="加载中..." />
        ) : (
          <Empty description="暂无记忆" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>
    )
  }

  const totalCount = memories.length
  const {
    user: userList,
    scope: scopeList,
    session: sessionList
  } = partitionMemories(memories, currentScope)

  const renderItem = (item: MemoryItemWithGroup) => (
    <motion.div
      key={item.id}
      className={styles.item}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={styles.content}>{item.memory}</div>
        <div className={styles.meta}>
          {item.memory_type && (
            <Tag variant="filled" color={MEMORY_TYPE_COLORS[item.memory_type] ?? 'default'}>
              {MEMORY_TYPE_LABELS[item.memory_type] ?? item.memory_type}
            </Tag>
          )}
          {(item as any).sub_type && (
            <Tag variant="filled" color="lime">
              {DOC_SUB_TYPE_LABELS[(item as any).sub_type] ?? (item as any).sub_type}
            </Tag>
          )}
          {(item as any).source_type && (
            <Tag variant="filled" className={styles.smallTag}>
              来源: {SOURCE_TYPE_LABELS[(item as any).source_type] ?? (item as any).source_type}
            </Tag>
          )}
          <span title={item.created_at}>
            {item.created_at ? new Date(item.created_at).toLocaleString() : '未知时间'}
          </span>
          {item.score != null && (
            <Tag variant="filled">相似度: {Number(item.score).toFixed(2)}</Tag>
          )}
          {item.ref_count != null && item.ref_count > 0 && (
            <Tooltip
              title={
                item.last_ref_at
                  ? `最近引用: ${new Date(item.last_ref_at).toLocaleString()}`
                  : undefined
              }
            >
              <Tag
                variant="filled"
                color="geekblue"
                style={{ cursor: item.last_ref_at ? 'help' : undefined }}
              >
                引用 {item.ref_count}次
              </Tag>
            </Tooltip>
          )}
          {item.updated_at && item.updated_at !== item.created_at && (
            <span title={`更新于: ${item.updated_at}`} className={styles.updatedAt}>
              更新: {new Date(item.updated_at).toLocaleDateString()}
            </span>
          )}
          {(item as any).source_session_id &&
            ((item as any).source_round_id || (item as any).source_round_ids?.length > 0) && (
              <Tooltip
                title={`来源会话: ${(item as any).source_session_id.slice(0, 8)}... → ${
                  (item as any).source_round_ids?.length > 1
                    ? `${(item as any).source_round_ids.length} 轮对话`
                    : `消息 ${(
                        (item as any).source_round_id ?? (item as any).source_round_ids?.[0]
                      )?.slice(0, 8)}...`
                }`}
              >
                <Tag
                  variant="filled"
                  color="purple"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    const sessionId = (item as any).source_session_id as string
                    const messageId =
                      (item as any).source_round_id ?? (item as any).source_round_ids?.[0]
                    if (sessionId && messageId) {
                      navigateToAgentMessage(sessionId, messageId)
                    }
                  }}
                >
                  <ExternalLink size={10} style={{ marginRight: 2 }} />
                  查看来源
                </Tag>
              </Tooltip>
            )}
        </div>
      </div>
      <div className={styles.actions}>
        {(item as any).source_session_id &&
          ((item as any).source_round_id || (item as any).source_round_ids?.length > 0) && (
            <Tooltip title="跳转到来源对话">
              <ActionIcon
                icon={ExternalLink}
                size="small"
                title="查看来源对话"
                onClick={() => {
                  const sessionId = (item as any).source_session_id as string
                  const messageId =
                    (item as any).source_round_id ?? (item as any).source_round_ids?.[0]
                  if (sessionId && messageId) {
                    navigateToAgentMessage(sessionId, messageId)
                  }
                }}
              />
            </Tooltip>
          )}
        <Popconfirm
          title="确定删除这条记忆吗？"
          onConfirm={() => onDelete(item.id)}
          okText="删除"
          cancelText="取消"
        >
          <ActionIcon icon={Trash2} size="small" title="删除" />
        </Popconfirm>
      </div>
    </motion.div>
  )

  const renderSubList = (subs: SubCategory[]) =>
    subs.length === 0 ? (
      <div className={styles.emptySection}>暂无</div>
    ) : (
      <Collapse
        ghost
        size="small"
        defaultActiveKey={subs.map((s) => s.key)}
        className={styles.subCollapse}
        items={subs.map((sub) => ({
          key: sub.key,
          label: (
            <span className={styles.subCategoryHeader}>
              {sub.label}（{sub.list.length}）
            </span>
          ),
          children: (
            <div className={styles.partitionList}>{sub.list.map((item) => renderItem(item))}</div>
          )
        }))}
      />
    )

  const userSubs = subdivideUser(userList)
  const scopeSubs = subdivideScope(scopeList, currentScope)
  const sessionSubs = subdivideSession(sessionList, currentScope)

  const mainItems: { key: string; label: ReactNode; children: ReactNode }[] = [
    {
      key: 'user',
      label: `${PARTITION_LABELS.user}（${userList.length}）`,
      children:
        userList.length === 0 ? (
          <div className={styles.emptySection}>暂无</div>
        ) : (
          renderSubList(userSubs)
        )
    },
    {
      key: 'scope',
      label: `${PARTITION_LABELS.scope}（${scopeList.length}）`,
      children:
        scopeList.length === 0 ? (
          <div className={styles.emptySection}>暂无</div>
        ) : (
          renderSubList(scopeSubs)
        )
    },
    {
      key: 'session',
      label: `${PARTITION_LABELS.session}（${sessionList.length}）`,
      children:
        sessionList.length === 0 ? (
          <div className={styles.emptySection}>暂无</div>
        ) : (
          renderSubList(sessionSubs)
        )
    }
  ]

  return (
    <Spin spinning={loading} wrapperClassName={styles.listSpin}>
      <div className={styles.summaryBar}>
        <span>共 {totalCount} 条记忆</span>
        {userList.length > 0 && (
          <Tag variant="filled" color="gold" className={styles.smallTag}>
            User {userList.length}
          </Tag>
        )}
        {scopeList.length > 0 && (
          <Tag variant="filled" color="blue" className={styles.smallTag}>
            Scope {scopeList.length}
          </Tag>
        )}
        {sessionList.length > 0 && (
          <Tag variant="filled" color="cyan" className={styles.smallTag}>
            Session {sessionList.length}
          </Tag>
        )}
      </div>
      <Collapse
        defaultActiveKey={['user', 'scope', 'session']}
        ghost
        size="small"
        items={mainItems}
        className={styles.subCollapse}
      />
    </Spin>
  )
}
