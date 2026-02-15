import type { StateCreator } from 'zustand/vanilla'

import type { PublicState, State } from './initialState'
import type { OverlayReplacement } from './initialState'
import { initialState } from './initialState'

export interface Action {
  getJSONState: () => unknown
  getMarkdownContent: () => string
  handleSendButton: () => void
  handleStop: () => void
  setApplyOverlayReplacement: (fn: OverlayReplacement | null) => void
  setDocument: (type: string, content: unknown, options?: Record<string, unknown>) => void
  setExpand: (expand: boolean) => void
  setFocusBlockInput: (fn: (() => void) | null) => void
  setJSONState: (content: unknown) => void
  setMarkdownContent: (content: string) => void
  setOverlayKeyHandler: (handler: ((e: KeyboardEvent) => void) | null) => void
  setShowTypoBar: (show: boolean) => void
  updateMarkdownContent: () => void
}

export type Store = Action & State

type CreateStore = (initState?: Partial<PublicState>) => StateCreator<Store>

export const store: CreateStore = (publicState) => (set, get) => ({
  ...initialState,
  ...publicState,

  getJSONState: () => {
    return get().editor?.getDocument('json')
  },
  getMarkdownContent: () => {
    return get().markdownContent
  },
  handleSendButton: () => {
    const editor = get().editor

    const result = get().onSend?.({
      clearContent: () => {
        get().setMarkdownContent('')
      },
      editor: editor ?? null,
      getMarkdownContent: get().getMarkdownContent
    })
    const focusEditor = () => get().editor?.focus() ?? get().focusBlockInput?.()
    if (result && typeof (result as Promise<unknown>)?.then === 'function') {
      ;(result as Promise<void>).then(focusEditor)
    } else {
      focusEditor()
    }
  },

  handleStop: () => {
    if (!get().editor) return

    get().sendButtonProps?.onStop?.({ editor: get().editor! })
  },

  setDocument: (type, content, options) => {
    const editor = get().editor
    if (editor) {
      editor.setDocument(type, content, options)
      set({ markdownContent: String(editor.getDocument('markdown') || '').trimEnd() })
    }
  },

  setExpand: (expand) => {
    set({ expand })
  },

  setMarkdownContent: (content) => {
    set({ markdownContent: content })
  },

  setApplyOverlayReplacement: (fn: OverlayReplacement | null) => {
    set({ applyOverlayReplacement: fn })
  },

  setFocusBlockInput: (fn: (() => void) | null) => {
    set({ focusBlockInput: fn })
  },

  setOverlayKeyHandler: (handler) => {
    set({ overlayKeyHandler: handler })
  },

  setJSONState: (content) => {
    get().editor?.setDocument('json', content)
  },

  setShowTypoBar: (showTypoBar) => {
    set({ showTypoBar })
  },

  updateMarkdownContent: () => {
    const fromEditor = get().editor
      ? String(get().editor?.getDocument('markdown') || '').trimEnd()
      : get().markdownContent
    if (fromEditor === get().markdownContent) return
    get().onMarkdownContentChange?.(fromEditor)
    set({ markdownContent: fromEditor })
  }
})
