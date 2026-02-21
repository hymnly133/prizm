import type { ForwardedRef } from 'react'
import { memo, useEffect, useImperativeHandle } from 'react'
import { createStoreUpdater } from 'zustand-utils'

import type { ChatInputEditor } from './hooks/useChatInputEditor'
import { useChatInputEditor } from './hooks/useChatInputEditor'
import type { PublicState } from './store'
import { useStoreApi } from './store'
import type { PendingInitialRunRef } from '../../hooks/useWorkflowPageState'

export type { PendingInitialRunRef }

export interface StoreUpdaterProps extends Partial<PublicState> {
  chatInputEditorRef?: ForwardedRef<ChatInputEditor | null>
  /** 预填的 run 引用（如从「在管理会话中打开此次 run」进入），应用后由 onClearInitialRunRef 清除 */
  initialRunRef?: PendingInitialRunRef | null
  onClearInitialRunRef?: () => void
}

const StoreUpdater = memo<StoreUpdaterProps>(
  ({
    agentId,
    chatInputEditorRef,
    mobile,
    sendButtonProps,
    leftActions,
    rightActions,
    scopeItems,
    scopeSlashCommands,
    onSend,
    onMarkdownContentChange,
    allowExpand,
    initialRunRef,
    onClearInitialRunRef
  }) => {
    const storeApi = useStoreApi()
    const useStoreUpdater = createStoreUpdater(storeApi)
    const editor = useChatInputEditor()

    useEffect(() => {
      if (!initialRunRef) return
      const ref = {
        type: 'run',
        key: initialRunRef.runId,
        label: initialRunRef.label,
        markdown: `@(run:${initialRunRef.runId})`
      }
      storeApi.getState().setInputRefs([ref])
      onClearInitialRunRef?.()
    }, [initialRunRef, onClearInitialRunRef, storeApi])

    useStoreUpdater('agentId', agentId)
    useStoreUpdater('mobile', mobile ?? false)
    useStoreUpdater('leftActions', leftActions ?? [])
    useStoreUpdater('rightActions', rightActions ?? [])
    useStoreUpdater('allowExpand', allowExpand)
    useStoreUpdater('scopeItems', scopeItems)
    useStoreUpdater('scopeSlashCommands', scopeSlashCommands)
    useStoreUpdater('sendButtonProps', sendButtonProps)
    useStoreUpdater('onSend', onSend)
    useStoreUpdater('onMarkdownContentChange', onMarkdownContentChange)

    useImperativeHandle(chatInputEditorRef, () => editor)

    return null
  }
)

StoreUpdater.displayName = 'StoreUpdater'

export default StoreUpdater
