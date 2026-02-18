/**
 * AgentPane — 协作页 Agent 半屏面板
 *
 * 使用与 AgentPage 相同的 SessionChatProvider + SessionChatPanel 渲染聊天，
 * 包含 KeepAlive 池实现 O(1) 会话切换，功能完全对齐（编辑重发、回退、交互确认等）。
 * 共享 AgentSessionList 和 useAgentChatActions，消除重复代码。
 */
import { ActionIcon, Flexbox } from '@lobehub/ui'
import { AnimatePresence, motion } from 'motion/react'
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
import { useRef, useState, useMemo, useCallback, memo } from 'react'
import { useAgent } from '../../hooks/useAgent'
import { useAgentScopeData } from '../../hooks/useAgentScopeData'
import { useAgentChatActions } from '../../hooks/useAgentChatActions'
import { useScope } from '../../hooks/useScope'
import { usePendingInteractSessionIds } from '../../events/agentBackgroundStore'
import { SessionChatProvider } from '../../context/SessionChatContext'
import { SessionChatPanel } from '../agent/SessionChatPanel'
import { AgentSessionList } from '../agent/AgentSessionList'
import { AgentDetailSidebar } from '../agent/AgentDetailSidebar'
import { EmptyConversation } from '../agent/EmptyConversation'
import { ResizableSidebar } from '../layout'
import {
  ChatInputProvider,
  DesktopChatInput,
  PendingChatPayloadApplicator,
  type ActionKeys
} from '../../features/ChatInput'
import { DRAFT_KEY_NEW, DraftCacheManager } from '../agent/chatMessageAdapter'
import { EASE_OUT_EXPO } from '../../theme/motionPresets'
import '../../components/agent/TerminalToolCards'

const MAX_KEPT_ALIVE = 2
const LEFT_ACTIONS: ActionKeys[] = ['fileUpload', 'clear']
const RIGHT_ACTIONS: ActionKeys[] = []

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

  // --- KeepAlive 池（与 AgentPage 相同的 LRU 策略）---
  const alivePoolRef = useRef<string[]>([])
  const aliveSessionIds = useMemo(() => {
    const validIds = new Set(sessions.map((s) => s.id))
    let pool = alivePoolRef.current.filter((id) => validIds.has(id))
    const currentId = currentSession?.id
    if (currentId && validIds.has(currentId)) {
      if (pool[0] !== currentId) {
        pool = [currentId, ...pool.filter((id) => id !== currentId)].slice(0, MAX_KEPT_ALIVE)
      }
    }
    alivePoolRef.current = pool
    return pool
  }, [currentSession?.id, sessions])

  // --- 共享聊天操作 ---
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
      {/* 面板头部 */}
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
        {/* 会话列表侧边栏 */}
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
            sessions={sessions}
            activeSessionId={currentSession?.id}
            loading={loading}
            pendingInteractSessionIds={pendingInteractSessionIds}
            onDeleteSession={deleteSession}
            onLoadSession={handleLoadSession}
            showHeader={false}
          />
        </ResizableSidebar>

        {/* 聊天区域 */}
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
              {/* KeepAlive 池：多个会话面板同时挂载，CSS display 切换 */}
              <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                {aliveSessionIds.map((id) => (
                  <div
                    key={id}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: id === currentSession?.id ? 'flex' : 'none',
                      flexDirection: 'column'
                    }}
                  >
                    <SessionChatProvider
                      sessionId={id}
                      scope={currentScope}
                      active={id === currentSession?.id}
                    >
                      <SessionChatPanel />
                    </SessionChatProvider>
                  </div>
                ))}
                {!currentSession && (
                  <motion.div
                    key="new"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column'
                    }}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -24, scale: 0.97 }}
                    transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
                  >
                    <EmptyConversation
                      onSendPrompt={handleQuickPrompt}
                      loading={loading}
                    />
                  </motion.div>
                )}
              </div>

              {/* Error banner */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    className="agent-error-banner"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input area */}
              <div className="agent-input-wrap agent-input-floating">
                <DraftCacheManager sessionId={currentSession?.id ?? DRAFT_KEY_NEW} />
                <PendingChatPayloadApplicator />
                <DesktopChatInput
                  onClear={handleClear}
                  inputContainerProps={{
                    minHeight: 72,
                    style: {
                      borderRadius: 16,
                      boxShadow: '0 8px 24px rgba(0,0,0,.03)',
                      transition: 'box-shadow 0.3s, border-color 0.3s'
                    }
                  }}
                />
              </div>
            </div>
          </ChatInputProvider>
        </div>

        {/* 详情面板：与 AgentPage 右侧面板完全对齐（上下文/文件/终端 三标签） */}
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
