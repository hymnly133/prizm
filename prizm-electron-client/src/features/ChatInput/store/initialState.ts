import type { IEditor } from '@lobehub/editor'
import type { ChatInputProps } from '@lobehub/editor/react'

import type { ActionKeys } from '../ActionBar/config'

export type SendButtonHandler = (params: {
  clearContent: () => void
  editor: IEditor
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

export interface State extends PublicState {
  editor?: IEditor
  isContentEmpty: boolean
  markdownContent: string
  slashMenuRef: ChatInputProps['slashMenuRef']
}

export const initialState: State = {
  allowExpand: true,
  expand: false,
  isContentEmpty: false,
  leftActions: [],
  markdownContent: '',
  rightActions: [],
  scopeItems: [],
  scopeSlashCommands: [],
  slashMenuRef: { current: null }
}
