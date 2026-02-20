/**
 * scopeDataStore — scope 级别的文档/TodoList/Clipboard/会话/记忆计数单一数据源
 *
 * 响应式增量更新：WS 事件按类型分发 —
 *   删除 → 直接移除（零网络请求）
 *   锁变更 → 直接 patch lockInfo（零网络请求）
 *   创建/更新 → 单条 fetch 后 upsert（替代全量 re-fetch）
 *   记忆变更 → 全量 re-fetch（聚合指标无法增量）
 *   todo_list/todo_item → 增量 upsert/remove/patch
 *   clipboard → 增量 add/remove
 *
 * 初始化和 scope 切换时仍做一次全量 fetch 确保一致性。
 */
import { create } from 'zustand'
import type {
  EnrichedDocument,
  PrizmClient,
  TodoList,
  TodoItem,
  ClipboardItem
} from '@prizm/client-core'
import { subscribeSyncEvents, type SyncEventPayload } from '../events/syncEventEmitter'
import { createClientLogger } from '@prizm/client-core'

const log = createClientLogger('ScopeData')

export interface MemoryCounts {
  enabled: boolean
  userCount: number
  scopeCount: number
  scopeChatCount: number
  scopeDocumentCount: number
  sessionCount: number
  byType: Record<string, number>
}

const EMPTY_MEMORY_COUNTS: MemoryCounts = {
  enabled: false,
  userCount: 0,
  scopeCount: 0,
  scopeChatCount: 0,
  scopeDocumentCount: 0,
  sessionCount: 0,
  byType: {}
}

export interface ScopeDataState {
  documents: EnrichedDocument[]
  documentsLoading: boolean
  todoLists: TodoList[]
  todoListsLoading: boolean
  clipboard: ClipboardItem[]
  clipboardLoading: boolean
  memoryCounts: MemoryCounts
  memoryCountsLoading: boolean

  currentScope: string | null

  // --- 全量刷新（初始化/fallback）---
  refreshDocuments(): Promise<void>
  refreshTodoLists(): Promise<void>
  refreshClipboard(): Promise<void>
  refreshMemoryCounts(): Promise<void>
  refreshAll(): Promise<void>

  // --- 增量操作 ---
  /** 单条 upsert：按 id 插入或替换文档 */
  upsertDocument(doc: EnrichedDocument): void
  /** 按 id 移除文档 */
  removeDocument(id: string): void
  /** patch 文档的 lockInfo 字段 */
  patchDocumentLock(resourceId: string, lockInfo: EnrichedDocument['lockInfo']): void
  /** 单条 upsert TodoList */
  upsertTodoList(list: TodoList): void
  /** 按 id 移除 TodoList */
  removeTodoList(id: string): void
  /** patch TodoList 内的单个 item */
  patchTodoItem(listId: string, itemId: string, patch: Partial<TodoItem>): void
  /** 向 TodoList 添加 item */
  addTodoItem(listId: string, item: TodoItem): void
  /** 从 TodoList 移除 item */
  removeTodoItem(listId: string, itemId: string): void
  /** 添加剪贴板条目（插入到头部） */
  addClipboardItem(item: ClipboardItem): void
  /** 按 id 移除剪贴板条目 */
  removeClipboardItem(id: string): void

  bind(http: PrizmClient, scope: string): void
  reset(): void
}

let _http: PrizmClient | null = null

export const useScopeDataStore = create<ScopeDataState>()((set, get) => ({
  documents: [],
  documentsLoading: false,
  todoLists: [],
  todoListsLoading: false,
  clipboard: [],
  clipboardLoading: false,
  memoryCounts: EMPTY_MEMORY_COUNTS,
  memoryCountsLoading: false,
  currentScope: null,

  // ---- 全量刷新 ----

  async refreshDocuments() {
    const scope = get().currentScope
    if (!_http || !scope) return
    set({ documentsLoading: true })
    try {
      const docs = await _http.listDocuments({ scope })
      set({ documents: docs ?? [] })
    } catch {
      set({ documents: [] })
    } finally {
      set({ documentsLoading: false })
    }
  },

  async refreshTodoLists() {
    const scope = get().currentScope
    if (!_http || !scope) return
    set({ todoListsLoading: true })
    try {
      const lists = await _http.getTodoLists(scope)
      set({ todoLists: lists ?? [] })
    } catch {
      set({ todoLists: [] })
    } finally {
      set({ todoListsLoading: false })
    }
  },

  async refreshClipboard() {
    const scope = get().currentScope
    if (!_http || !scope) return
    set({ clipboardLoading: true })
    try {
      const items = await _http.getClipboardHistory({ scope })
      set({ clipboard: items ?? [] })
    } catch {
      set({ clipboard: [] })
    } finally {
      set({ clipboardLoading: false })
    }
  },

  async refreshMemoryCounts() {
    const scope = get().currentScope
    if (!_http || !scope) return
    set({ memoryCountsLoading: true })
    try {
      const res = await _http.getMemoryCounts(scope)
      set({ memoryCounts: res })
    } catch {
      set({ memoryCounts: EMPTY_MEMORY_COUNTS })
    } finally {
      set({ memoryCountsLoading: false })
    }
  },

  async refreshAll() {
    const { refreshDocuments, refreshTodoLists, refreshClipboard, refreshMemoryCounts } = get()
    await Promise.allSettled([
      refreshDocuments(),
      refreshTodoLists(),
      refreshClipboard(),
      refreshMemoryCounts()
    ])
  },

  // ---- 增量操作 ----

  upsertDocument(doc: EnrichedDocument) {
    set((s) => {
      const idx = s.documents.findIndex((d) => d.id === doc.id)
      if (idx >= 0) {
        const next = [...s.documents]
        next[idx] = doc
        return { documents: next }
      }
      return { documents: [doc, ...s.documents] }
    })
  },

  removeDocument(id: string) {
    set((s) => {
      const next = s.documents.filter((d) => d.id !== id)
      return next.length !== s.documents.length ? { documents: next } : s
    })
  },

  patchDocumentLock(resourceId: string, lockInfo: EnrichedDocument['lockInfo']) {
    set((s) => {
      const idx = s.documents.findIndex((d) => d.id === resourceId)
      if (idx < 0) return s
      const next = [...s.documents]
      next[idx] = { ...next[idx], lockInfo }
      return { documents: next }
    })
  },

  upsertTodoList(list: TodoList) {
    set((s) => {
      const idx = s.todoLists.findIndex((t) => t.id === list.id)
      if (idx >= 0) {
        const next = [...s.todoLists]
        next[idx] = list
        return { todoLists: next }
      }
      return { todoLists: [list, ...s.todoLists] }
    })
  },

  removeTodoList(id: string) {
    set((s) => {
      const next = s.todoLists.filter((t) => t.id !== id)
      return next.length !== s.todoLists.length ? { todoLists: next } : s
    })
  },

  patchTodoItem(listId: string, itemId: string, patch: Partial<TodoItem>) {
    set((s) => {
      const idx = s.todoLists.findIndex((t) => t.id === listId)
      if (idx < 0) return s
      const list = s.todoLists[idx]
      const itemIdx = list.items.findIndex((it) => it.id === itemId)
      if (itemIdx < 0) return s
      const newItems = [...list.items]
      newItems[itemIdx] = { ...newItems[itemIdx], ...patch }
      const next = [...s.todoLists]
      next[idx] = { ...list, items: newItems, updatedAt: Date.now() }
      return { todoLists: next }
    })
  },

  addTodoItem(listId: string, item: TodoItem) {
    set((s) => {
      const idx = s.todoLists.findIndex((t) => t.id === listId)
      if (idx < 0) return s
      const list = s.todoLists[idx]
      if (list.items.some((it) => it.id === item.id)) return s
      const next = [...s.todoLists]
      next[idx] = { ...list, items: [...list.items, item], updatedAt: Date.now() }
      return { todoLists: next }
    })
  },

  removeTodoItem(listId: string, itemId: string) {
    set((s) => {
      const idx = s.todoLists.findIndex((t) => t.id === listId)
      if (idx < 0) return s
      const list = s.todoLists[idx]
      const newItems = list.items.filter((it) => it.id !== itemId)
      if (newItems.length === list.items.length) return s
      const next = [...s.todoLists]
      next[idx] = { ...list, items: newItems, updatedAt: Date.now() }
      return { todoLists: next }
    })
  },

  addClipboardItem(item: ClipboardItem) {
    set((s) => {
      if (s.clipboard.some((c) => c.id === item.id)) return s
      return { clipboard: [item, ...s.clipboard] }
    })
  },

  removeClipboardItem(id: string) {
    set((s) => {
      const next = s.clipboard.filter((c) => c.id !== id)
      return next.length !== s.clipboard.length ? { clipboard: next } : s
    })
  },

  // ---- 生命周期 ----

  bind(http: PrizmClient, scope: string) {
    const prev = get().currentScope
    _http = http
    if (prev !== scope) {
      set({
        currentScope: scope,
        documents: [],
        todoLists: [],
        clipboard: [],
        memoryCounts: EMPTY_MEMORY_COUNTS
      })
      void get().refreshAll()
    }
  },

  reset() {
    _http = null
    set({
      currentScope: null,
      documents: [],
      todoLists: [],
      clipboard: [],
      memoryCounts: EMPTY_MEMORY_COUNTS,
      documentsLoading: false,
      todoListsLoading: false,
      clipboardLoading: false,
      memoryCountsLoading: false
    })
  }
}))

// ==================== 增量响应式 WS 事件订阅 ====================

/** 批量事件收集窗口（短时间内多个事件合并为一批处理） */
const BATCH_WINDOW_MS = 150
const MEMORY_DEBOUNCE_MS = 2000

interface PendingDocEvent {
  type: 'created' | 'updated' | 'deleted'
  id: string
}
interface PendingLockEvent {
  type: 'locked' | 'unlocked'
  resourceType: string
  resourceId: string
  sessionId?: string
  reason?: string
}
interface PendingTodoEvent {
  eventType: string
  payload: Record<string, unknown>
}

let _subscribed = false
let _docBatchTimer: ReturnType<typeof setTimeout> | null = null
let _todoBatchTimer: ReturnType<typeof setTimeout> | null = null
let _memoryTimer: ReturnType<typeof setTimeout> | null = null

let _pendingDocEvents: PendingDocEvent[] = []
let _pendingLockEvents: PendingLockEvent[] = []
let _pendingTodoEvents: PendingTodoEvent[] = []

/**
 * 处理一批文档增量事件。
 * 删除 → 直接移除；创建/更新 → 单条 fetch → upsert；
 * 锁变更 → 直接 patch lockInfo。
 */
async function flushDocBatch(): Promise<void> {
  const docEvents = _pendingDocEvents
  const lockEvents = _pendingLockEvents
  _pendingDocEvents = []
  _pendingLockEvents = []

  if (docEvents.length === 0 && lockEvents.length === 0) return
  if (!_http) return

  const store = useScopeDataStore.getState()
  const scope = store.currentScope
  if (!scope) return

  // 去重：同一 id 只取最后一个事件
  const docById = new Map<string, PendingDocEvent>()
  for (const ev of docEvents) docById.set(ev.id, ev)

  const deletedIds = new Set<string>()
  const fetchIds = new Set<string>()

  for (const [id, ev] of docById) {
    if (ev.type === 'deleted') {
      deletedIds.add(id)
    } else {
      fetchIds.add(id)
    }
  }

  // 1. 删除：O(1) 直接移除
  for (const id of deletedIds) {
    store.removeDocument(id)
    fetchIds.delete(id)
  }

  // 2. 锁变更：直接 patch（零网络请求）
  for (const ev of lockEvents) {
    if (ev.resourceType !== 'document') continue
    if (ev.type === 'unlocked') {
      store.patchDocumentLock(ev.resourceId, null)
    } else {
      // locked — 构造临时 lockInfo；下次 full refresh 或单条 fetch 会带回完整信息
      store.patchDocumentLock(ev.resourceId, {
        id: `lock-${ev.resourceId}`,
        resourceType: 'document',
        resourceId: ev.resourceId,
        scope,
        sessionId: ev.sessionId ?? '',
        fenceToken: 0,
        reason: ev.reason,
        acquiredAt: Date.now(),
        lastHeartbeat: Date.now(),
        ttlMs: 300000
      })
    }
  }

  // 3. 创建/更新：单条 fetch → upsert
  if (fetchIds.size > 0) {
    const results = await Promise.allSettled(
      [...fetchIds].map((id) => _http!.getDocument(id, scope))
    )
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        useScopeDataStore.getState().upsertDocument(result.value)
      }
    }
  }
}

/**
 * 处理一批 TodoList 增量事件。
 * 直接通过 store 的增量方法更新，无法处理的 fallback 到全量刷新。
 */
async function flushTodoBatch(): Promise<void> {
  const events = _pendingTodoEvents
  _pendingTodoEvents = []
  if (events.length === 0 || !_http) return

  const store = useScopeDataStore.getState()
  const scope = store.currentScope
  if (!scope) return

  let needFullRefresh = false

  for (const { eventType, payload: p } of events) {
    switch (eventType) {
      case 'todo_list:created': {
        const listId = p.listId as string | undefined
        if (listId) {
          try {
            const list = await _http!.getTodoList(scope, listId)
            if (list) useScopeDataStore.getState().upsertTodoList(list)
          } catch {
            needFullRefresh = true
          }
        } else {
          needFullRefresh = true
        }
        break
      }
      case 'todo_list:updated': {
        const listId = p.listId as string | undefined
        if (!listId) {
          needFullRefresh = true
          break
        }
        const existing = store.todoLists.find((t) => t.id === listId)
        if (!existing) {
          needFullRefresh = true
          break
        }
        if (p.itemsOmitted === true) {
          useScopeDataStore.getState().upsertTodoList({
            ...existing,
            title: (p.title as string) ?? existing.title,
            updatedAt: (p.updatedAt as number) ?? Date.now()
          })
        } else if (Array.isArray(p.items)) {
          useScopeDataStore.getState().upsertTodoList({
            ...existing,
            title: (p.title as string) ?? existing.title,
            items: p.items as TodoItem[],
            updatedAt: (p.updatedAt as number) ?? Date.now()
          })
        } else {
          needFullRefresh = true
        }
        break
      }
      case 'todo_list:deleted': {
        const listId = p.listId as string | undefined
        if (listId) {
          useScopeDataStore.getState().removeTodoList(listId)
        } else if (p.deleted === true) {
          set_todoLists_empty()
        }
        break
      }
      case 'todo_item:created': {
        const listId = p.listId as string | undefined
        const itemId = ((p.itemId ?? p.id) as string) || ''
        if (!listId || !itemId) {
          needFullRefresh = true
          break
        }
        // payload 含 title 说明是完整数据（路由广播），否则 fallback 到拉取整个 list
        if (typeof p.title === 'string') {
          const item: TodoItem = {
            id: itemId,
            title: p.title,
            description: p.description as string | undefined,
            status: ((p.status as string) ?? 'todo') as TodoItem['status'],
            createdAt: (p.createdAt as number) ?? Date.now(),
            updatedAt: (p.updatedAt as number) ?? Date.now()
          }
          useScopeDataStore.getState().addTodoItem(listId, item)
        } else {
          try {
            const list = await _http!.getTodoList(scope!, listId)
            if (list) useScopeDataStore.getState().upsertTodoList(list)
          } catch {
            needFullRefresh = true
          }
        }
        break
      }
      case 'todo_item:updated': {
        const listId = p.listId as string | undefined
        const itemId = ((p.itemId ?? p.id) as string) || ''
        if (!listId || !itemId) {
          needFullRefresh = true
          break
        }
        // payload 含可 patch 字段时直接 patch，否则 fallback 到拉取整个 list
        if (p.title !== undefined || p.status !== undefined || p.description !== undefined) {
          useScopeDataStore.getState().patchTodoItem(listId, itemId, {
            title: p.title as string | undefined,
            description: p.description as string | undefined,
            status: p.status as TodoItem['status'] | undefined,
            updatedAt: (p.updatedAt as number) ?? Date.now()
          })
        } else {
          try {
            const list = await _http!.getTodoList(scope!, listId)
            if (list) useScopeDataStore.getState().upsertTodoList(list)
          } catch {
            needFullRefresh = true
          }
        }
        break
      }
      case 'todo_item:deleted': {
        const listId = p.listId as string | undefined
        const itemId = p.itemId as string | undefined
        if (!listId || !itemId) {
          needFullRefresh = true
          break
        }
        useScopeDataStore.getState().removeTodoItem(listId, itemId)
        break
      }
    }
  }

  if (needFullRefresh) {
    void useScopeDataStore.getState().refreshTodoLists()
  }
}

function set_todoLists_empty(): void {
  useScopeDataStore.setState({ todoLists: [] })
}

/**
 * 启动 WS 事件订阅，增量响应 scope 数据变更。
 * 全局只需调用一次（幂等），返回取消订阅函数。
 */
export function subscribeScopeDataEvents(): () => void {
  if (_subscribed) return () => {}
  _subscribed = true

  const unsub = subscribeSyncEvents((eventType, payload?: SyncEventPayload) => {
    const store = useScopeDataStore.getState()
    if (!store.currentScope) return

    const p = payload ?? {}

    if (p.scope && p.scope !== store.currentScope) return

    // --- 文档增量 ---
    if (eventType === 'document:created' || eventType === 'document:updated') {
      const id = p.id as string | undefined
      if (id) {
        _pendingDocEvents.push({
          type: eventType === 'document:created' ? 'created' : 'updated',
          id
        })
        scheduleDocFlush()
      }
    } else if (eventType === 'document:deleted') {
      const id = p.id as string | undefined
      if (id) {
        _pendingDocEvents.push({ type: 'deleted', id })
        scheduleDocFlush()
      }
    }

    // --- 锁增量（直接 patch，归入文档批次） ---
    if (eventType === 'resource:locked' || eventType === 'resource:unlocked') {
      _pendingLockEvents.push({
        type: eventType === 'resource:locked' ? 'locked' : 'unlocked',
        resourceType: ((p as Record<string, unknown>).resourceType as string) ?? 'document',
        resourceId: ((p as Record<string, unknown>).resourceId as string) ?? '',
        sessionId: (p as Record<string, unknown>).sessionId as string | undefined,
        reason: (p as Record<string, unknown>).reason as string | undefined
      })
      scheduleDocFlush()
    }

    // --- TodoList/TodoItem 增量 ---
    if (eventType.startsWith('todo_list:') || eventType.startsWith('todo_item:')) {
      _pendingTodoEvents.push({ eventType, payload: p as Record<string, unknown> })
      scheduleTodoFlush()
    }

    // --- Clipboard 增量（直接处理，无需批量） ---
    if (eventType === 'clipboard:itemAdded') {
      const item = p as Record<string, unknown>
      if (item.id && item.type && item.content) {
        store.addClipboardItem({
          id: item.id as string,
          type: item.type as ClipboardItem['type'],
          content: item.content as string,
          sourceApp: item.sourceApp as string | undefined,
          createdAt: (item.createdAt as number) ?? Date.now()
        })
      } else {
        void store.refreshClipboard()
      }
    } else if (eventType === 'clipboard:itemDeleted') {
      const id = (p as Record<string, unknown>).id as string | undefined
      if (id) {
        store.removeClipboardItem(id)
      }
    }

    // --- 记忆计数：聚合指标，仍全量刷新（低频，长防抖） ---
    if (
      eventType === 'agent:message.completed' ||
      eventType === 'document:created' ||
      eventType === 'document:deleted'
    ) {
      if (_memoryTimer) clearTimeout(_memoryTimer)
      _memoryTimer = setTimeout(() => {
        _memoryTimer = null
        void useScopeDataStore.getState().refreshMemoryCounts()
      }, MEMORY_DEBOUNCE_MS)
    }
  })

  return () => {
    unsub()
    _subscribed = false
    if (_docBatchTimer) clearTimeout(_docBatchTimer)
    if (_todoBatchTimer) clearTimeout(_todoBatchTimer)
    if (_memoryTimer) clearTimeout(_memoryTimer)
    _pendingDocEvents = []
    _pendingLockEvents = []
    _pendingTodoEvents = []
  }
}

function scheduleDocFlush(): void {
  if (_docBatchTimer) clearTimeout(_docBatchTimer)
  _docBatchTimer = setTimeout(() => {
    _docBatchTimer = null
    flushDocBatch().catch((err) => {
      log.warn('Doc incremental update failed, falling back to full refresh:', err)
      void useScopeDataStore.getState().refreshDocuments()
    })
  }, BATCH_WINDOW_MS)
}

function scheduleTodoFlush(): void {
  if (_todoBatchTimer) clearTimeout(_todoBatchTimer)
  _todoBatchTimer = setTimeout(() => {
    _todoBatchTimer = null
    flushTodoBatch().catch((err) => {
      log.warn('Todo incremental update failed, falling back to full refresh:', err)
      void useScopeDataStore.getState().refreshTodoLists()
    })
  }, BATCH_WINDOW_MS)
}
