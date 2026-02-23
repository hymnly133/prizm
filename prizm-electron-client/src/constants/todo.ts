import type { TodoItemStatus } from '@prizm/client-core'
import type { FileKind } from '../hooks/useFileList'

export const STATUS_LABELS: Record<TodoItemStatus, string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成'
}

export const STATUS_OPTIONS = [
  { value: 'todo' as const, label: '待办' },
  { value: 'doing' as const, label: '进行中' },
  { value: 'done' as const, label: '已完成' }
]

export const TODO_KIND_LABEL = '待办'

export function getKindLabel(kind: FileKind): string {
  switch (kind) {
    case 'note':
      return '便签'
    case 'todoList':
      return TODO_KIND_LABEL
    case 'document':
      return '文档'
    default:
      return '未知'
  }
}

/** 搜索结果类型标签（与 @prizm/client-core SearchResultKind 一致） */
export type SearchResultKind = 'document' | 'clipboard' | 'todoList' | 'file'

export function getSearchResultKindLabel(kind: SearchResultKind): string {
  if (kind === 'clipboard') return '剪贴板'
  if (kind === 'file') return '文件'
  return getKindLabel(kind as FileKind)
}

/** 搜索匹配方式：索引（算法）匹配 vs 全文扫描匹配 */
export type SearchMatchSource = 'index' | 'fulltext'

export function getSearchMatchSourceLabel(source: SearchMatchSource | undefined): string {
  if (source === 'fulltext') return '全文匹配'
  return '索引匹配'
}
