import { Text } from '@lobehub/ui'
import type { TodoItem } from '@prizm/client-core'

interface TodoListPreviewProps {
  items: TodoItem[]
  maxItems?: number
}

export default function TodoListPreview({ items, maxItems = 3 }: TodoListPreviewProps) {
  const preview = items
    .map((it) => it.title)
    .slice(0, maxItems)
    .join(' · ')
  const suffix = items.length > maxItems ? ' …' : ''

  return (
    <Text type="secondary" style={{ margin: 0, fontSize: 13 }} className="data-card__desc">
      {preview}
      {suffix}
    </Text>
  )
}
