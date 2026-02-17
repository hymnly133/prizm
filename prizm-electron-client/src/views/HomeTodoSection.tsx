/**
 * HomeTodoSection - 待办列表卡片（按列表分组）
 */
import { motion } from 'motion/react'
import { Icon, Tag, Text } from '@lobehub/ui'
import { ListTodo } from 'lucide-react'
import type { TodoList, TodoItem } from '@prizm/client-core'
import TodoItemRow from '../components/todo/TodoItemRow'

const STAGGER_DELAY = 0.06
const EASE_SMOOTH = [0.33, 1, 0.68, 1] as const

function fadeUp(index: number) {
  return {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: index * STAGGER_DELAY, duration: 0.4, ease: EASE_SMOOTH }
  }
}

export interface TodoListGroup {
  list: TodoList
  activeItems: TodoItem[]
}

export interface HomeTodoSectionProps {
  todoLists: TodoListGroup[]
  loading: boolean
  onOpenTodoList: (listId: string) => void
  animationIndex?: number
}

export default function HomeTodoSection({
  todoLists,
  loading,
  onOpenTodoList,
  animationIndex = 0
}: HomeTodoSectionProps) {
  return (
    <motion.div className="home-card home-card--todos" {...fadeUp(animationIndex)}>
      <div className="home-card__header">
        <Icon icon={ListTodo} size="small" />
        <span className="home-card__title">待办列表</span>
      </div>
      <div className="home-card__body">
        {loading ? (
          <div className="home-loading-placeholder">加载中...</div>
        ) : todoLists.length === 0 ? (
          <div className="home-empty-state">
            <Text type="secondary">没有活跃的待办列表</Text>
          </div>
        ) : (
          <div className="home-todolist-groups">
            {todoLists.map(({ list, activeItems }) => {
              const activeCount = list.items.filter(
                (i) => i.status === 'todo' || i.status === 'doing'
              ).length
              return (
                <div
                  key={list.id}
                  className="home-todolist-group"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenTodoList(list.id)}
                  onKeyDown={(e) => e.key === 'Enter' && onOpenTodoList(list.id)}
                >
                  <div className="home-todolist-group__header">
                    <ListTodo size={14} />
                    <span className="home-todolist-group__title">{list.title || '待办'}</span>
                    <Tag size="small">
                      {activeItems.length}/{list.items.length}
                    </Tag>
                  </div>
                  <div className="home-todolist-group__items">
                    {activeItems.map((item) => (
                      <TodoItemRow key={item.id} item={item} compact />
                    ))}
                    {activeCount > 4 && (
                      <span className="home-todolist-group__more">
                        还有 {activeCount - 4} 项...
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </motion.div>
  )
}
