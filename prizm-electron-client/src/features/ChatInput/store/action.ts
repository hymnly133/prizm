import type { StateCreator } from 'zustand/vanilla'

import type { PublicState, State } from './initialState'
import { initialState } from './initialState'

export interface Action {
  getJSONState: () => unknown
  getMarkdownContent: () => string
  handleSendButton: () => void
  handleStop: () => void
  setDocument: (type: string, content: unknown, options?: Record<string, unknown>) => void
  setExpand: (expand: boolean) => void
  setJSONState: (content: unknown) => void
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
    return String(get().editor?.getDocument('markdown') || '').trimEnd()
  },
  handleSendButton: () => {
    if (!get().editor) return

    const editor = get().editor

    const result = get().onSend?.({
      clearContent: () => editor?.cleanDocument(),
      editor: editor!,
      getMarkdownContent: get().getMarkdownContent
    })
    // 发送完成后重新聚焦输入框，避免 scrollIntoView 等导致失焦
    const focusEditor = () => get().editor?.focus()
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
    get().editor?.setDocument(type, content, options)
  },

  setExpand: (expand) => {
    set({ expand })
  },

  setJSONState: (content) => {
    get().editor?.setDocument('json', content)
  },

  setShowTypoBar: (showTypoBar) => {
    set({ showTypoBar })
  },

  updateMarkdownContent: () => {
    const content = get().getMarkdownContent()

    if (content === get().markdownContent) return

    get().onMarkdownContentChange?.(content)

    set({ markdownContent: content })
  }
})
