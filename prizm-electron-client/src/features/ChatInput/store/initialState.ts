import type { IEditor } from '@lobehub/editor'
import type { ChatInputProps } from '@lobehub/editor/react'

import type { ActionKeys } from '../ActionBar/config'

/** 输入框中的一条引用（显示在引用栏，不嵌入编辑器） */
export interface InputRef {
  /** 引用类型 */
  type: 'doc' | 'note' | 'todo' | 'file' | 'snippet'
  /** 标识：doc/note/todo 为 id，file 为编码后路径，snippet 为 source#timestamp */
  key: string
  /** 显示名称 */
  label: string
  /** 发送时注入消息的 markdown，如 @(doc:id) 或 @(file:path) 或代码块 */
  markdown: string
}

export type SendButtonHandler = (params: {
  clearContent: () => void
  editor: IEditor | null
  getMarkdownContent: () => string
  getInputRefs: () => InputRef[]
}) => Promise<void> | void

export interface SendButtonProps {
  disabled?: boolean
  generating: boolean
  onStop: (params: { editor: IEditor }) => void
  shape?: 'round' | 'default'
}

export const initialSendButtonState: SendButtonProps = {
  disabled: false,
  generating: false,
  onStop: () => {}
}

export interface ScopeRefItem {
  id: string
  kind: string
  title: string
  charCount: number
  isShort: boolean
  updatedAt: number
  groupOrStatus?: string
}

export interface SlashCommandItem {
  name: string
  aliases: string[]
  description: string
  /** 是否内置命令 */
  builtin?: boolean
  /** 命令模式：prompt | action */
  mode?: 'prompt' | 'action'
}

export interface PublicState {
  agentId?: string
  allowExpand?: boolean
  expand?: boolean
  leftActions: ActionKeys[]
  mobile?: boolean
  onMarkdownContentChange?: (content: string) => void
  onSend?: SendButtonHandler
  rightActions: ActionKeys[]
  scopeItems?: ScopeRefItem[]
  scopeSlashCommands?: SlashCommandItem[]
  sendButtonProps?: SendButtonProps
  showTypoBar?: boolean
}

/** 文本替换回调：将 overlay 选中的区间替换为纯文本（不再插入 chip） */
export type OverlayTextReplacer = (replaceStart: number, replaceEnd: number, text: string) => void

export interface State extends PublicState {
  applyOverlayTextReplace: OverlayTextReplacer | null
  editor?: IEditor
  /** 当前输入附带的引用列表（显示在引用栏，不嵌入编辑器） */
  inputRefs: InputRef[]
  focusBlockInput: (() => void) | null
  isContentEmpty: boolean
  markdownContent: string
  overlayKeyHandler: ((e: KeyboardEvent) => void) | null
  slashMenuRef: ChatInputProps['slashMenuRef']
}

export const initialState: State = {
  allowExpand: true,
  applyOverlayTextReplace: null,
  expand: false,
  inputRefs: [],
  focusBlockInput: null,
  isContentEmpty: false,
  leftActions: [],
  markdownContent: '',
  overlayKeyHandler: null,
  rightActions: [],
  scopeItems: [],
  scopeSlashCommands: [],
  slashMenuRef: { current: null }
}
