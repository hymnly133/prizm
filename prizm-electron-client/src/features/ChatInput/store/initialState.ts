import type { IEditor } from '@lobehub/editor'
import type { ChatInputProps } from '@lobehub/editor/react'

import type { ActionKeys } from '../ActionBar/config'

export type SendButtonHandler = (params: {
  clearContent: () => void
  editor: IEditor | null
  getMarkdownContent: () => string
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

export type OverlayReplacement = (
  replaceStart: number,
  replaceEnd: number,
  replacementMarkdown: string,
  chipLabel: string
) => void

export interface State extends PublicState {
  applyOverlayReplacement: OverlayReplacement | null
  editor?: IEditor
  focusBlockInput: (() => void) | null
  isContentEmpty: boolean
  markdownContent: string
  overlayKeyHandler: ((e: KeyboardEvent) => void) | null
  slashMenuRef: ChatInputProps['slashMenuRef']
}

export const initialState: State = {
  allowExpand: true,
  applyOverlayReplacement: null,
  expand: false,
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
