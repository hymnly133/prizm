/**
 * AgentPane — 协作页 Agent 半屏面板
 *
 * 使用与 AgentPage 相同的共享组件：AgentChatZone、AgentSessionList、
 * AgentDetailSidebar、useKeepAlivePool、useAgentChatActions。
 */
import { ActionIcon, Flexbox } from '@lobehub/ui'
import {
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PanelRight,
  PanelRightDashed,
  Maximize2
} from 'lucide-react'
import { useState, useCallback, memo, useMemo } from 'react'
import { isToolSession } from '@prizm/shared'
import { useAgent } from '../../hooks/useAgent'
import { useAgentScopeData } from '../../hooks/useAgentScopeData'
import { useAgentChatActions } from '../../hooks/useAgentChatActions'
import { useKeepAlivePool } from '../../hooks/useKeepAlivePool'
import { useScope } from '../../hooks/useScope'
import { usePendingInteractSessionIds } from '../../events/agentBackgroundStore'
import { AgentSessionList } from '../agent/AgentSessionList'
import { AgentDetailSidebar } from '../agent/AgentDetailSidebar'
import { AgentChatZone } from '../agent/AgentChatZone'
import { ResizableSidebar } from '../layout'
import {
  ChatInputProvider,
  type ActionKeys
} from '../../features/ChatInput'
import '../../components/agent/TerminalToolCards'

const LEFT_ACTIONS: ActionKeys[] = ['fileUpload', 'thinking', 'toolCompact', 'skills', 'clear']
const RIGHT_ACTIONS: ActionKeys[] = []

const COMPACT_INPUT_STYLE = {
  minHeight: 72,
  borderRadius: 16,
  boxShadow: '0 8px 24px rgba(0,0,0,.03)'
}

export interface AgentPaneProps {
  onOpenFullPage?: () => void
  sidebarSide?: 'left' | 'right'
}

function AgentPane({ onOpenFullPage, sidebarSide = 'left' }: AgentPaneProps) {
  const { currentScope } = useScope()
  const { scopeItems, slashCommands } = useAgentScopeData(currentScope)
  const {
    sessions,
    currentSession,
    loading,
    sending,
    error,
    createSession,
    deleteSession,
    loadSession,
    sendMessage,
    stopGeneration,
    setCurrentSession,
    optimisticMessages,
    selectedModel,
    setSelectedModel
  } = useAgent(currentScope)

  const pendingInteractSessionIds = usePendingInteractSessionIds()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [detailCollapsed, setDetailCollapsed] = useState(true)

  const aliveSessionIds = useKeepAlivePool(currentSession?.id, sessions, 2)

  /** 协作会话列表仅展示聊天会话，过滤掉工具会话（如工作流管理、Tool LLM 等） */
  const chatSessions = useMemo(
    () => sessions.filter((s) => !isToolSession(s)),
    [sessions]
  )

  const { handleSend, handleClear, handleQuickPrompt, handleMarkdownContentChange, sendButtonProps } =
    useAgentChatActions({
      currentSession,
      sending,
      createSession,
      sendMessage,
      stopGeneration,
      setCurrentSession
    })

  const handleLoadSession = useCallback(
    (id: string) => loadSession(id),
    [loadSession]
  )

  const handleNewSession = useCallback(() => {
    setCurrentSession(null)
  }, [setCurrentSession])

  return (
    <section className="collab-agent-pane">
      {/* Panel header */}
      <div className="collab-pane-header">
        <Flexbox horizontal align="center" gap={4}>
          {sidebarSide === 'left' && (
            <ActionIcon
              icon={sidebarCollapsed ? PanelLeftOpen : PanelLeftClose}
              size="small"
              title={sidebarCollapsed ? '展开会话列表' : '收起会话列表'}
              onClick={() => setSidebarCollapsed((c) => !c)}
            />
          )}
          <span className="collab-pane-title">Agent</span>
        </Flexbox>
        <Flexbox horizontal align="center" gap={2}>
          <ActionIcon
            icon={Plus}
            title="新建会话"
            size="small"
            onClick={handleNewSession}
            disabled={loading}
          />
          <ActionIcon
            icon={detailCollapsed ? PanelRightDashed : PanelRight}
            size="small"
            title={detailCollapsed ? '展开详情面板' : '收起详情面板'}
            onClick={() => setDetailCollapsed((c) => !c)}
          />
          {onOpenFullPage && (
            <ActionIcon
              icon={Maximize2}
              title="在完整页面中打开"
              size="small"
              onClick={onOpenFullPage}
            />
          )}
          {sidebarSide === 'right' && (
            <ActionIcon
              icon={sidebarCollapsed ? PanelRightOpen : PanelRightClose}
              size="small"
              title={sidebarCollapsed ? '展开会话列表' : '收起会话列表'}
              onClick={() => setSidebarCollapsed((c) => !c)}
            />
          )}
        </Flexbox>
      </div>

      <div className="collab-pane-body">
        {/* Session list sidebar */}
        <ResizableSidebar
          side={sidebarSide}
          storageKey={`collab-agent-sessions-${sidebarSide}`}
          defaultWidth={180}
          minWidth={140}
          maxWidth={300}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          style={{ order: sidebarSide === 'left' ? 0 : 2 }}
        >
          <AgentSessionList
            sessions={chatSessions}
            activeSessionId={currentSession?.id}
            loading={loading}
            pendingInteractSessionIds={pendingInteractSessionIds}
            onDeleteSession={deleteSession}
            onLoadSession={handleLoadSession}
            showHeader={false}
          />
        </ResizableSidebar>

        {/* Chat area */}
        <div style={{ order: 1, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ChatInputProvider
            leftActions={LEFT_ACTIONS}
            rightActions={RIGHT_ACTIONS}
            scopeItems={scopeItems}
            scopeSlashCommands={slashCommands}
            sendButtonProps={sendButtonProps}
            onSend={handleSend}
            onMarkdownContentChange={handleMarkdownContentChange}
            allowExpand
          >
            <div className="collab-agent-chat-area">
              <AgentChatZone
                scope={currentScope}
                currentSession={currentSession}
                aliveSessionIds={aliveSessionIds}
                error={error}
                loading={loading}
                onQuickPrompt={handleQuickPrompt}
                onClear={handleClear}
                inputStyle={COMPACT_INPUT_STYLE}
              />
            </div>
          </ChatInputProvider>
        </div>

        {/* Detail sidebar */}
        <ResizableSidebar
          side="right"
          storageKey="collab-agent-detail"
          defaultWidth={260}
          minWidth={200}
          maxWidth={400}
          collapsed={detailCollapsed}
          onCollapsedChange={setDetailCollapsed}
          style={{ order: 3 }}
        >
          <AgentDetailSidebar
            sending={sending}
            error={error}
            currentSession={currentSession}
            optimisticMessages={optimisticMessages}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            scope={currentScope}
          />
        </ResizableSidebar>
      </div>
    </section>
  )
}

export default memo(AgentPane)
