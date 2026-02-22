/**
 * Prizm Client Core - 通用工具函数
 */

import type { NotificationPayload, EventPushPayload } from './types'

/** 事件类型到通知展示文案的映射 */
export const EVENT_LABELS: Record<string, { title: string; body?: string }> = {
  notification: { title: '', body: '' },
  'smtc:change': { title: '媒体控制', body: '状态变更' },
  'note:created': { title: '新便签', body: '已创建' },
  'note:updated': { title: '便签已更新', body: '' },
  'note:deleted': { title: '便签已删除', body: '' },
  'todo_list:created': { title: 'TODO 列表', body: '已创建' },
  'todo_list:updated': { title: 'TODO 列表', body: '' },
  'todo_list:deleted': { title: 'TODO 列表', body: '已删除' },
  'todo_item:created': { title: 'TODO 项', body: '已添加' },
  'todo_item:updated': { title: 'TODO 项', body: '已更新' },
  'todo_item:deleted': { title: 'TODO 项', body: '已删除' },
  'clipboard:itemAdded': { title: '剪贴板', body: '新内容已记录' },
  'clipboard:itemDeleted': { title: '剪贴板', body: '记录已删除' },
  'document:created': { title: '新文档', body: '' },
  'document:updated': { title: '文档已更新', body: '' },
  'document:deleted': { title: '文档已删除', body: '' }
}

/** 事件类型到 UI 展示标签的映射（用于设置页等） */
export const EVENT_LABELS_UI: Record<string, string> = {
  notification: '主动通知 (MCP/Agent)',
  'smtc:change': '媒体控制',
  'note:created': '新便签',
  'note:updated': '便签更新',
  'note:deleted': '便签删除',
  'todo_list:created': 'TODO 列表创建',
  'todo_list:updated': 'TODO 列表更新',
  'todo_list:deleted': 'TODO 列表删除',
  'todo_item:created': 'TODO 项添加',
  'todo_item:updated': 'TODO 项更新',
  'todo_item:deleted': 'TODO 项删除',
  'clipboard:itemAdded': '剪贴板新增',
  'clipboard:itemDeleted': '剪贴板删除',
  'document:created': '新文档',
  'document:updated': '文档更新',
  'document:deleted': '文档删除'
}

/**
 * 构建服务器 URL
 */
export function buildServerUrl(host: string, port: string): string {
  if (host.startsWith('http://') || host.startsWith('https://')) {
    return host.includes(':') ? host : `${host}:${port}`
  }
  return `http://${host}:${port}`
}

/** 截断长文本用于通知展示 */
function truncateForNotif(s: string, maxLen: number): string {
  const str = String(s).trim()
  if (!str) return ''
  return str.length <= maxLen ? str : str.slice(0, maxLen) + '…'
}

/**
 * 将 WebSocket 事件载荷格式化为通知展示内容
 */
export function formatEventToNotification(ev: EventPushPayload): NotificationPayload {
  const payload = ev.payload as Record<string, unknown>
  const sourceClientId = payload?.sourceClientId as string | undefined

  if (ev.eventType === 'notification') {
    const p = ev.payload as NotificationPayload
    return { title: p.title || '通知', body: p.body, sourceClientId }
  }
  const labels = EVENT_LABELS[ev.eventType]
  if (labels) {
    const extra = payload?.title ?? payload?.content
    const body = extra
      ? labels.body
        ? `${labels.body} · ${truncateForNotif(String(extra), 50)}`
        : truncateForNotif(String(extra), 80)
      : labels.body ?? ''
    const base = { title: labels.title, body, sourceClientId }
    if (
      ev.eventType === 'todo_list:created' ||
      ev.eventType === 'todo_list:updated' ||
      ev.eventType === 'todo_list:deleted'
    ) {
      const scope = (payload?.scope as string) ?? ''
      const listId = (payload?.listId as string) ?? (payload?.id as string) ?? ''
      const itemCount = payload?.itemCount as number | undefined
      const doneCount = payload?.doneCount as number | undefined
      const listTitle = (payload?.title as string) || '待办'
      const bodyText =
        typeof itemCount === 'number' && typeof doneCount === 'number'
          ? `${doneCount}/${itemCount} 已完成`
          : labels.body ?? '已更新'
      return {
        ...base,
        title: listTitle,
        body: bodyText,
        updateId: listId ? `todo_list:${scope}:${listId}` : undefined
      }
    }
    if (
      ev.eventType === 'todo_item:created' ||
      ev.eventType === 'todo_item:updated' ||
      ev.eventType === 'todo_item:deleted'
    ) {
      const scope = (payload?.scope as string) ?? ''
      const listId = (payload?.listId as string) ?? ''
      const itemTitle = (payload?.title as string) ?? ''
      return {
        ...base,
        title: base.title,
        body: itemTitle
          ? `${base.body ?? ''} · ${truncateForNotif(itemTitle, 50)}`.trim()
          : base.body,
        updateId: listId ? `todo_list:${scope}:${listId}` : undefined
      }
    }
    return base
  }
  return { title: ev.eventType, body: '', sourceClientId }
}

/**
 * 获取事件类型的 UI 标签
 */
export function getEventLabel(eventType: string): string {
  return EVENT_LABELS_UI[eventType] ?? eventType
}
