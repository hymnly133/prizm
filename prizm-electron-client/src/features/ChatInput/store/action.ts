import type { StateCreator } from 'zustand/vanilla'
import { createClientLogger } from '@prizm/client-core'

import type { PublicState, State, InputRef } from './initialState'

const log = createClientLogger('ChatInput')
import type { OverlayTextReplacer } from './initialState'
import { initialState } from './initialState'

export interface Action {
  addInputRef: (ref: InputRef) => void
  clearInputRefs: () => void
  getJSONState: () => unknown
  getMarkdownContent: () => string
  handleSendButton: () => void
  handleStop: () => void
  removeInputRef: (key: string) => void
  setApplyOverlayTextReplace: (fn: OverlayTextReplacer | null) => void
  setDocument: (type: string, content: unknown, options?: Record<string, unknown>) => void
  setExpand: (expand: boolean) => void
  setFocusBlockInput: (fn: (() => void) | null) => void
  setInputRefs: (refs: InputRef[]) => void
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

  addInputRef: (ref: InputRef) => {
    const existing = get().inputRefs
    if (existing.some((r) => r.key === ref.key && r.type === ref.type)) return
    set({ inputRefs: [...existing, ref] })
  },

  clearInputRefs: () => {
    set({ inputRefs: [] })
  },

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
        get().clearInputRefs()
      },
      editor: editor ?? null,
      getMarkdownContent: get().getMarkdownContent,
      getInputRefs: () => get().inputRefs
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

  removeInputRef: (key: string) => {
    set({ inputRefs: get().inputRefs.filter((r) => r.key !== key) })
  },

  setApplyOverlayTextReplace: (fn: OverlayTextReplacer | null) => {
    set({ applyOverlayTextReplace: fn })
  },

  setInputRefs: (refs: InputRef[]) => {
    log.debug('Store.setInputRefs:', refs.length)
    set({ inputRefs: refs })
  },

  setMarkdownContent: (content) => {
    set({ markdownContent: content })
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
