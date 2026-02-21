import { memo, useMemo, useCallback } from 'react'
import type { EnrichedSession } from '@prizm/client-core'
import type { PendingInitialRunRef } from '../../hooks/useWorkflowPageState'
import { ChatInputProvider, type ActionKeys } from '../../features/ChatInput'
import { AgentChatZone } from '../../components/agent/AgentChatZone'
import { useAgentChatActions } from '../../hooks/useAgentChatActions'
import { useAgentScopeData, WORKFLOW_MANAGEMENT_REF_TYPES } from '../../hooks/useAgentScopeData'
import { useAgentSessionStore } from '../../store/agentSessionStore'
import { usePrizmContext } from '../../context/PrizmContext'

interface WorkflowChatZoneProps {
  sessionId: string
  session: EnrichedSession | null
  scope: string
  /** 打开管理会话时预填的 run 引用（如从「在管理会话中打开此次 run」进入） */
  initialRunRef?: PendingInitialRunRef | null
  onClearInitialRunRef?: () => void
}

const LEFT_ACTIONS: ActionKeys[] = ['fileUpload', 'thinking', 'toolCompact', 'skills', 'clear']
const RIGHT_ACTIONS: ActionKeys[] = []

export const WorkflowChatZone = memo(function WorkflowChatZone({
  sessionId,
  session,
  scope,
  initialRunRef,
  onClearInitialRunRef
}: WorkflowChatZoneProps) {
  const { manager } = usePrizmContext()
  const { scopeItems, slashCommands } = useAgentScopeData(scope, {
    types: WORKFLOW_MANAGEMENT_REF_TYPES
  })

  // Grab necessary state from agentSessionStore (since we don't have the full useAgent hook here)
  const loading = useAgentSessionStore((s) => s.loading)
  const streamingState = useAgentSessionStore((s) => s.streamingStates[sessionId])
  const sending = streamingState?.sending ?? false
  const error = useAgentSessionStore((s) => s.error)

  const sendMessage = useCallback(
    (content: string) => {
      // The core sendMessage handles the store update
      return useAgentSessionStore.getState().sendMessage(sessionId, content, scope)
    },
    [sessionId, scope]
  )

  const stopGeneration = useCallback(() => {
    return useAgentSessionStore.getState().stopGeneration(sessionId, scope)
  }, [sessionId, scope])

  const {
    handleSend,
    handleClear,
    handleQuickPrompt,
    handleMarkdownContentChange,
    sendButtonProps
  } = useAgentChatActions({
    currentSession: session,
    sending,
    createSession: async () => null, // disabled in workflow context
    sendMessage,
    stopGeneration,
    setCurrentSession: () => {},
    shouldCreateNewSession: () => false,
    onBeforeCreateSession: () => {}
  })

  // We need to keep the session id in an array for AgentChatZone's KeepAlive pool
  const aliveSessionIds = useMemo(() => [sessionId], [sessionId])

  return (
    <ChatInputProvider
      leftActions={LEFT_ACTIONS}
      rightActions={RIGHT_ACTIONS}
      scopeItems={scopeItems}
      scopeSlashCommands={slashCommands}
      sendButtonProps={sendButtonProps}
      onSend={handleSend}
      onMarkdownContentChange={handleMarkdownContentChange}
      allowExpand
      initialRunRef={initialRunRef}
      onClearInitialRunRef={onClearInitialRunRef}
    >
      <div
        className="agent-main workflow-chat-zone"
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        <AgentChatZone
          scope={scope}
          currentSession={session}
          aliveSessionIds={aliveSessionIds}
          error={error}
          loading={loading}
          onQuickPrompt={handleQuickPrompt}
          onClear={handleClear}
          inputStyle={{
            minHeight: 72,
            borderRadius: 16,
            boxShadow: '0 8px 24px rgba(0,0,0,.03)'
          }}
        />
      </div>
    </ChatInputProvider>
  )
})
