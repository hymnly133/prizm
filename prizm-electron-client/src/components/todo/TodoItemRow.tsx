import { Flexbox, Select, Tag, Text } from '@lobehub/ui'
import type { TodoItem, TodoItemStatus } from '@prizm/client-core'
import { STATUS_LABELS, STATUS_OPTIONS } from '../../constants/todo'

interface TodoItemRowProps {
  item: TodoItem
  onStatusChange?: (itemId: string, status: TodoItemStatus) => void
  compact?: boolean
}

const STATUS_TAG_COLOR: Record<TodoItemStatus, 'default' | 'processing' | 'success'> = {
  todo: 'default',
  doing: 'processing',
  done: 'success'
}

export default function TodoItemRow({ item, onStatusChange, compact }: TodoItemRowProps) {
  const tagColor = STATUS_TAG_COLOR[item.status] ?? 'default'

  return (
    <Flexbox
      align="flex-start"
      distribution="space-between"
      gap={12}
      horizontal
      className="todo-item-row"
      style={{
        padding: compact ? '8px 12px' : '10px 14px',
        borderRadius: 'var(--ant-border-radius)',
        border: '1px solid var(--ant-color-border-secondary)',
        background: 'var(--ant-color-fill-quaternary)'
      }}
    >
      <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
        <Text>{item.title}</Text>
        {item.description && !compact && (
          <Text style={{ fontSize: 13 }} type="secondary">
            {item.description}
          </Text>
        )}
      </Flexbox>
      {onStatusChange ? (
        <Select
          onChange={(v) => onStatusChange(item.id, v as TodoItemStatus)}
          options={STATUS_OPTIONS}
          size="small"
          value={item.status}
          style={{ minWidth: 90, flexShrink: 0 }}
        />
      ) : (
        <Tag color={tagColor} size="small">
          {STATUS_LABELS[item.status] ?? item.status}
        </Tag>
      )}
    </Flexbox>
  )
}
