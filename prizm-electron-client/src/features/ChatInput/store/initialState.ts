import type { IEditor } from '@lobehub/editor'
import type { ChatInputProps } from '@lobehub/editor/react'

import type { ActionKeys } from '../ActionBar/config'

/** 输入框中的一条引用（显示在引用栏，不嵌入编辑器） */
export interface InputRef {
  /** 引用类型（支持所有 ResourceType + snippet 兼容） */
  type: string
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
  /** 当前待发送的图片附件（粘贴或上传），用于视觉模型多模态输入 */
  getImageAttachments?: () => import('@prizm/client-core').ChatImageAttachment[]
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
  /** 资源类型（来自 resourceRef 系统） */
  type?: string
  kind: string
  title: string
  charCount: number
  isShort?: boolean
  updatedAt: number
  groupOrStatus?: string
}

export interface SlashSubCommand {
  name: string
  description: string
}

export interface SlashCommandItem {
  name: string
  aliases: string[]
  description: string
  /** 是否内置命令 */
  builtin?: boolean
  /** 命令模式：prompt | action */
  mode?: 'prompt' | 'action'
  /** Sub-command hints for two-level auto-complete */
  subCommands?: SlashSubCommand[]
  /** Dynamic argument hints (e.g., skill names) */
  argHints?: string[]
  /** 分类：用于客户端分组展示 data | search | session | skill | custom */
  category?: string
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

/** 文本替换回调：将 overlay 选中的区间替换为纯文本 */
export type OverlayTextReplacer = (replaceStart: number, replaceEnd: number, text: string) => void

/** 在编辑器指定区间插入资源引用 chip（replaceStart..replaceEnd 替换为 inline chip） */
export type OverlayChipInserter = (
  replaceStart: number,
  replaceEnd: number,
  typeKey: string,
  id: string,
  label: string,
  markdown: string
) => void

export interface State extends PublicState {
  applyOverlayTextReplace: OverlayTextReplacer | null
  applyOverlayChipInsert: OverlayChipInserter | null
  editor?: IEditor
  /** 当前输入附带的引用列表（显示在引用栏，不嵌入编辑器） */
  inputRefs: InputRef[]
  /** 待发送的图片附件（粘贴或上传），发送后清空 */
  pendingImages: import('@prizm/client-core').ChatImageAttachment[]
  focusBlockInput: (() => void) | null
  isContentEmpty: boolean
  markdownContent: string
  overlayKeyHandler: ((e: KeyboardEvent) => void) | null
  slashMenuRef: ChatInputProps['slashMenuRef']
}

export const initialState: State = {
  allowExpand: true,
  applyOverlayTextReplace: null,
  applyOverlayChipInsert: null,
  expand: false,
  inputRefs: [],
  pendingImages: [],
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
