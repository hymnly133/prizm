import { EditorProvider, useEditor } from '@lobehub/editor/react'
import type { ReactNode } from 'react'
import { memo, useRef, useEffect } from 'react'

import { createStore, Provider } from './store'
import type { StoreUpdaterProps } from './StoreUpdater'
import StoreUpdater from './StoreUpdater'

interface ChatInputProviderProps extends StoreUpdaterProps {
  children: ReactNode
}

export const ChatInputProvider = memo<ChatInputProviderProps>(
  ({
    agentId,
    children,
    leftActions,
    rightActions,
    mobile,
    sendButtonProps,
    onSend,
    chatInputEditorRef,
    onMarkdownContentChange,
    allowExpand = true,
    scopeItems,
    scopeSlashCommands,
    ...rest
  }) => {
    const editor = useEditor()
    const slashMenuRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
      console.log('[ImportAI-Chip] ChatInputProvider 已挂载')
      return () => console.log('[ImportAI-Chip] ChatInputProvider 已卸载')
    }, [])

    return (
      <EditorProvider>
        <Provider
          createStore={() =>
            createStore({
              allowExpand,
              editor,
              leftActions,
              mobile,
              rightActions,
              scopeItems,
              scopeSlashCommands,
              sendButtonProps,
              slashMenuRef,
              onSend,
              onMarkdownContentChange,
              ...rest
            })
          }
        >
          <StoreUpdater
            agentId={agentId}
            allowExpand={allowExpand}
            chatInputEditorRef={chatInputEditorRef}
            leftActions={leftActions}
            mobile={mobile}
            rightActions={rightActions}
            scopeItems={scopeItems}
            scopeSlashCommands={scopeSlashCommands}
            sendButtonProps={sendButtonProps}
            onMarkdownContentChange={onMarkdownContentChange}
            onSend={onSend}
          />
          {children}
        </Provider>
      </EditorProvider>
    )
  }
)

ChatInputProvider.displayName = 'ChatInputProvider'
