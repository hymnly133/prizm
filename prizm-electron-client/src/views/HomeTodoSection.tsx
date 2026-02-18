/**
 * HomeTodoSection - 待办列表卡片（按列表分组）
 */
import { motion } from 'motion/react'
import { Button, Icon, Tag } from '@lobehub/ui'
import { ArrowRight, ListTodo } from 'lucide-react'
import type { TodoList, TodoItem } from '@prizm/client-core'
import TodoItemRow from '../components/todo/TodoItemRow'
import { fadeUpStagger } from '../theme/motionPresets'
import { SectionHeader } from '../components/ui/SectionHeader'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingPlaceholder } from '../components/ui/LoadingPlaceholder'

export interface TodoListGroup {
  list: TodoList
  activeItems: TodoItem[]
}

export interface HomeTodoSectionProps {
  todoLists: TodoListGroup[]
  loading: boolean
  onOpenTodoList: (listId: string) => void
  onViewAll?: () => void
  animationIndex?: number
}

export default function HomeTodoSection({
  todoLists,
  loading,
  onOpenTodoList,
  onViewAll,
  animationIndex = 0
}: HomeTodoSectionProps) {
  return (
    <motion.div
      className="content-card content-card--default content-card--hoverable home-card--todos"
      {...fadeUpStagger(animationIndex)}
    >
      <SectionHeader
        icon={ListTodo}
        title="待办列表"
        className="content-card__header home-card__header"
        extra={
          onViewAll && (
            <Button
              size="small"
              type="text"
              icon={<Icon icon={ArrowRight} size="small" />}
              iconPosition="end"
              onClick={onViewAll}
            >
              查看全部
            </Button>
          )
        }
      />
      <div className="content-card__body">
        {loading ? (
          <LoadingPlaceholder />
        ) : todoLists.length === 0 ? (
          <EmptyState description="没有活跃的待办列表" />
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
