/**
 * collabTabStore — per-session tab state management.
 *
 * Each agent session maintains its own array of open tabs.
 * Tabs are persisted to localStorage with debounced writes so
 * switching sessions restores the previously open tab set.
 */
import { create } from 'zustand'
import type { CollabTab, CollabTabType } from '../components/collaboration/collabTabTypes'
import { makeTabId } from '../components/collaboration/collabTabTypes'

const STORAGE_PREFIX = 'prizm-collab-tabs'
const PERSIST_DEBOUNCE_MS = 500

/** Stable empty array to avoid new-reference-per-render in selectors. */
export const EMPTY_TABS: CollabTab[] = []

let _persistTimer: ReturnType<typeof setTimeout> | null = null

function storageKey(sessionId: string | null): string {
  return sessionId ? `${STORAGE_PREFIX}:${sessionId}` : `${STORAGE_PREFIX}:__global__`
}

function loadTabs(sessionId: string | null): { tabs: CollabTab[]; activeTabId: string | null } {
  try {
    const raw = localStorage.getItem(storageKey(sessionId))
    if (!raw) return { tabs: [], activeTabId: null }
    const data = JSON.parse(raw)
    return {
      tabs: Array.isArray(data.tabs) ? data.tabs : [],
      activeTabId: typeof data.activeTabId === 'string' ? data.activeTabId : null
    }
  } catch {
    return { tabs: [], activeTabId: null }
  }
}

function persistSession(
  sessionId: string | null,
  tabs: CollabTab[],
  activeTabId: string | null
): void {
  if (_persistTimer) clearTimeout(_persistTimer)
  _persistTimer = setTimeout(() => {
    _persistTimer = null
    try {
      const key = storageKey(sessionId)
      if (tabs.length === 0) {
        localStorage.removeItem(key)
      } else {
        localStorage.setItem(key, JSON.stringify({ tabs, activeTabId }))
      }
    } catch {
      /* quota exceeded — ignore */
    }
  }, PERSIST_DEBOUNCE_MS)
}

function getTabs(state: CollabTabStoreState, sessionId: string | null): CollabTab[] {
  return sessionId ? state.tabsBySession[sessionId] ?? EMPTY_TABS : state.globalTabs
}

function getActiveTabId(state: CollabTabStoreState, sessionId: string | null): string | null {
  return sessionId ? state.activeTabBySession[sessionId] ?? null : state.globalActiveTab
}

export interface CollabTabStoreState {
  tabsBySession: Record<string, CollabTab[]>
  activeTabBySession: Record<string, string | null>

  globalTabs: CollabTab[]
  globalActiveTab: string | null

  /** Ensure tabs for a session are loaded from storage (call on session switch). */
  ensureLoaded(sessionId: string | null): void

  /** Open a tab (or activate if it already exists). */
  openTab(sessionId: string | null, tab: CollabTab): void

  /** Close a tab. Activates an adjacent tab if closing the active one. */
  closeTab(sessionId: string | null, tabId: string): void

  /** Activate a tab. */
  activateTab(sessionId: string | null, tabId: string): void

  /** Move a tab to a new index. */
  moveTab(sessionId: string | null, tabId: string, newIndex: number): void

  /** Replace the tab array with a reordered version (used by drag-and-drop). */
  reorderTabs(sessionId: string | null, reordered: CollabTab[]): void

  /** Update a tab's label. */
  updateTabLabel(sessionId: string | null, tabId: string, label: string): void

  /** Set dirty flag on a tab. */
  setTabDirty(sessionId: string | null, tabId: string, dirty: boolean): void

  /** Remove all tabs for a session (e.g. on session delete). */
  clearSessionTabs(sessionId: string): void

  /** Check whether any tab of a given type exists. */
  hasTabOfType(sessionId: string | null, type: CollabTabType, entityId?: string): boolean

  /** Get tabs + activeTabId for a session (selector-friendly). */
  getSessionTabs(sessionId: string | null): { tabs: CollabTab[]; activeTabId: string | null }
}

const _loadedSessions = new Set<string>()

export const useCollabTabStore = create<CollabTabStoreState>()((set, get) => ({
  tabsBySession: {},
  activeTabBySession: {},
  globalTabs: [],
  globalActiveTab: null,

  ensureLoaded(sessionId: string | null) {
    const key = sessionId ?? '__global__'
    if (_loadedSessions.has(key)) return
    _loadedSessions.add(key)

    const { tabs, activeTabId } = loadTabs(sessionId)
    if (tabs.length === 0) return

    if (sessionId) {
      set((s) => ({
        tabsBySession: { ...s.tabsBySession, [sessionId]: tabs },
        activeTabBySession: { ...s.activeTabBySession, [sessionId]: activeTabId }
      }))
    } else {
      set({ globalTabs: tabs, globalActiveTab: activeTabId })
    }
  },

  openTab(sessionId: string | null, tab: CollabTab) {
    set((s) => {
      const current = getTabs(s, sessionId)
      const existing = current.find((t) => t.id === tab.id)
      if (existing) {
        if (sessionId) {
          return { activeTabBySession: { ...s.activeTabBySession, [sessionId]: tab.id } }
        }
        return { globalActiveTab: tab.id }
      }

      const next = [...current, tab]
      if (sessionId) {
        const st = {
          tabsBySession: { ...s.tabsBySession, [sessionId]: next },
          activeTabBySession: { ...s.activeTabBySession, [sessionId]: tab.id }
        }
        persistSession(sessionId, next, tab.id)
        return st
      }
      persistSession(null, next, tab.id)
      return { globalTabs: next, globalActiveTab: tab.id }
    })
  },

  closeTab(sessionId: string | null, tabId: string) {
    set((s) => {
      const current = getTabs(s, sessionId)
      const idx = current.findIndex((t) => t.id === tabId)
      if (idx === -1) return {}

      const next = current.filter((t) => t.id !== tabId)
      const wasActive = getActiveTabId(s, sessionId) === tabId
      let nextActive = getActiveTabId(s, sessionId)

      if (wasActive) {
        if (next.length === 0) {
          nextActive = null
        } else {
          const newIdx = Math.min(idx, next.length - 1)
          nextActive = next[newIdx].id
        }
      }

      if (sessionId) {
        persistSession(sessionId, next, nextActive)
        return {
          tabsBySession: { ...s.tabsBySession, [sessionId]: next },
          activeTabBySession: { ...s.activeTabBySession, [sessionId]: nextActive }
        }
      }
      persistSession(null, next, nextActive)
      return { globalTabs: next, globalActiveTab: nextActive }
    })
  },

  activateTab(sessionId: string | null, tabId: string) {
    set((s) => {
      if (sessionId) {
        persistSession(sessionId, getTabs(s, sessionId), tabId)
        return { activeTabBySession: { ...s.activeTabBySession, [sessionId]: tabId } }
      }
      persistSession(null, s.globalTabs, tabId)
      return { globalActiveTab: tabId }
    })
  },

  moveTab(sessionId: string | null, tabId: string, newIndex: number) {
    set((s) => {
      const current = [...getTabs(s, sessionId)]
      const oldIdx = current.findIndex((t) => t.id === tabId)
      if (oldIdx === -1 || oldIdx === newIndex) return {}
      const [tab] = current.splice(oldIdx, 1)
      current.splice(newIndex, 0, tab)
      if (sessionId) {
        persistSession(sessionId, current, getActiveTabId(s, sessionId))
        return { tabsBySession: { ...s.tabsBySession, [sessionId]: current } }
      }
      persistSession(null, current, s.globalActiveTab)
      return { globalTabs: current }
    })
  },

  reorderTabs(sessionId: string | null, reordered: CollabTab[]) {
    set((s) => {
      if (sessionId) {
        persistSession(sessionId, reordered, getActiveTabId(s, sessionId))
        return { tabsBySession: { ...s.tabsBySession, [sessionId]: reordered } }
      }
      persistSession(null, reordered, s.globalActiveTab)
      return { globalTabs: reordered }
    })
  },

  updateTabLabel(sessionId: string | null, tabId: string, label: string) {
    set((s) => {
      const current = getTabs(s, sessionId)
      const next = current.map((t) => (t.id === tabId ? { ...t, label } : t))
      if (sessionId) {
        persistSession(sessionId, next, getActiveTabId(s, sessionId))
        return { tabsBySession: { ...s.tabsBySession, [sessionId]: next } }
      }
      persistSession(null, next, s.globalActiveTab)
      return { globalTabs: next }
    })
  },

  setTabDirty(sessionId: string | null, tabId: string, dirty: boolean) {
    set((s) => {
      const current = getTabs(s, sessionId)
      const next = current.map((t) => (t.id === tabId ? { ...t, dirty } : t))
      if (sessionId) {
        return { tabsBySession: { ...s.tabsBySession, [sessionId]: next } }
      }
      return { globalTabs: next }
    })
  },

  clearSessionTabs(sessionId: string) {
    _loadedSessions.delete(sessionId)
    try {
      localStorage.removeItem(storageKey(sessionId))
    } catch {
      /* ignore */
    }
    set((s) => {
      const { [sessionId]: _, ...rest } = s.tabsBySession
      const { [sessionId]: __, ...restActive } = s.activeTabBySession
      return { tabsBySession: rest, activeTabBySession: restActive }
    })
  },

  hasTabOfType(sessionId: string | null, type: CollabTabType, entityId?: string): boolean {
    const tabs = getTabs(get(), sessionId)
    const targetId = makeTabId(type, entityId)
    return tabs.some((t) => t.id === targetId)
  },

  getSessionTabs(sessionId: string | null) {
    const s = get()
    return {
      tabs: getTabs(s, sessionId),
      activeTabId: getActiveTabId(s, sessionId)
    }
  }
}))
