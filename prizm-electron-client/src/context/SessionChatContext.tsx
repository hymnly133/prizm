/**
 * SessionChatContext — 单会话聊天状态的 Provider
 *
 * 对标 DocumentDetailContext：每个 Provider 实例管理一个会话的全部聊天状态，
 * 子组件通过 useSessionChat() 零 props 消费。
 *
 * 支持多实例并存（KeepAlive 池），每个实例独立订阅 store + 管理滚动。
 * 内化 GrantPath/Interact 上下文，不再需要外部 wrapper。
 */
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { MutableRefObject } from 'react'
import type {
  EnrichedSession,
  AgentMessage,
  InteractRequestPayload,
  SessionCheckpoint,
  RollbackResult
} from '@prizm/client-core'
import { getTextContent } from '@prizm/client-core'
import type { FilePathRef } from '@prizm/shared'
import type { ChatMessage } from '@lobehub/ui/chat'
import { useAgentSessionStore } from '../store/agentSessionStore'
import { usePrizmContext } from './PrizmContext'
import { toChatMessage } from '../components/agent/chatMessageAdapter'
import { GrantPathProvider, InteractProvider } from '../components/agent'
import type { GrantPathContextValue, InteractContextValue } from '../components/agent'

const EMPTY_MESSAGES: AgentMessage[] = []

export interface SessionChatContextValue {
  sessionId: string
  scope: string
  active: boolean

  session: EnrichedSession | null
  loading: boolean

  sending: boolean
  thinking: boolean
  optimisticMessages: AgentMessage[]
  pendingInteract: InteractRequestPayload | null

  chatData: ChatMessage[]
  checkpointByMsgIdx: Map<number, SessionCheckpoint>

  messagesContainerRef: MutableRefObject<HTMLDivElement | null>
  messagesEndRef: MutableRefObject<HTMLDivElement | null>
  showScrollBtn: boolean
  scrollToBottom: () => void
  handleMessagesScroll: () => void

  sendMessage: (content: string, fileRefs?: FilePathRef[], runRefIds?: string[]) => Promise<string | null>
  stopGeneration: () => Promise<void>
  respondToInteract: (requestId: string, approved: boolean, paths?: string[]) => Promise<void>
  rollbackToCheckpoint: (
    checkpointId: string,
    restoreFiles?: boolean
  ) => Promise<RollbackResult | null>
  grantPaths: (paths: string[]) => Promise<void>

  editingMessageId: string | null
  setEditingMessageId: (id: string | null) => void
  editAndResend: (messageId: string, newContent: string) => Promise<void>
  regenerate: (assistantMessageId: string) => Promise<void>
}

const SessionChatContext = createContext<SessionChatContextValue | null>(null)

export function useSessionChat(): SessionChatContextValue {
  const ctx = useContext(SessionChatContext)
  if (!ctx) throw new Error('useSessionChat must be used within SessionChatProvider')
  return ctx
}

export function useSessionChatSafe(): SessionChatContextValue | null {
  return useContext(SessionChatContext)
}

export interface SessionChatProviderProps {
  sessionId: string
  scope: string
  active: boolean
  children: React.ReactNode
}

export const SessionChatProvider = memo(function SessionChatProvider({ sessionId, scope, active, children }: SessionChatProviderProps) {
  const { manager } = usePrizmContext()

  // --- Store subscriptions (per-session selectors) ---
  const session = useAgentSessionStore(
    useCallback(
      (s) => s.sessions.find((sess) => sess.id === sessionId) ?? null,
      [sessionId]
    )
  )
  const loading = useAgentSessionStore((s) => s.loading)
  const streamingState = useAgentSessionStore(
    useCallback((s) => s.streamingStates[sessionId], [sessionId])
  )

  const sending = streamingState?.sending ?? false
  const thinking = streamingState?.thinking ?? false
  const optimisticMessages = streamingState?.optimisticMessages ?? EMPTY_MESSAGES
  const pendingInteract = streamingState?.pendingInteract ?? null

  // --- Checkpoint index ---
  const checkpointByMsgIdx = useMemo(() => {
    const map = new Map<number, SessionCheckpoint>()
    const cps = session?.checkpoints
    if (cps) {
      for (const cp of cps) {
        map.set(cp.messageIndex, cp)
      }
    }
    return map
  }, [session?.checkpoints])

  // --- Chat data computation ---
  const baseChatData: ChatMessage[] = useMemo(() => {
    if (!session) return []
    const _t0 = performance.now()
    const result = session.messages.map((m, idx) => {
      const cm = toChatMessage(m)
      if (m.role === 'user') {
        const cp = checkpointByMsgIdx.get(idx)
        if (cp) {
          cm.extra = { ...cm.extra, checkpoint: cp }
        }
      }
      return cm
    })
    const _t1 = performance.now()
    console.log(
      `[perf] baseChatData(${sessionId.slice(0, 8)}) %c${(_t1 - _t0).toFixed(1)}ms`,
      'color:#9C27B0;font-weight:bold',
      { msgs: result.length, active }
    )
    return result
  }, [session, checkpointByMsgIdx])

  const chatData: ChatMessage[] = useMemo(() => {
    if (optimisticMessages.length === 0) return baseChatData
    const optimisticIds = new Set(optimisticMessages.map((m) => m.id))
    const filteredBase = baseChatData.filter((m) => !optimisticIds.has(m.id))
    const visibleOptimistic = optimisticMessages.filter(
      (m) => !m.id.startsWith('observe-phantom')
    )
    const optimisticConverted = visibleOptimistic.map((m) =>
      toChatMessage({
        ...m,
        streaming:
          sending &&
          m.role === 'assistant' &&
          (m.id.startsWith('assistant-') || m.id.startsWith('observe'))
      })
    )
    return [...filteredBase, ...optimisticConverted]
  }, [baseChatData, optimisticMessages, sending])

  // --- Scroll management (independent per session) ---
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const isNearBottomRef = useRef(true)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    isNearBottomRef.current = isNearBottom
    setShowScrollBtn(!isNearBottom)
  }, [])

  useLayoutEffect(() => {
    if (!active || !sending || !isNearBottomRef.current) return
    const el = messagesContainerRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [chatData, sending, active])

  // --- Auto-observe running BG sessions ---
  const isBgRunning = session?.kind === 'background' &&
    (session.bgStatus === 'running' || session.bgStatus === 'pending')
  useEffect(() => {
    if (!active || !isBgRunning || sending) return
    useAgentSessionStore.getState().startObserving(sessionId, scope)
    return () => {
      useAgentSessionStore.getState().stopObserving(sessionId)
    }
  }, [active, isBgRunning, sessionId, scope]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Actions (bound to sessionId + scope) ---
  const sendMessage = useCallback(
    (content: string, fileRefs?: FilePathRef[], runRefIds?: string[]) => {
      return useAgentSessionStore
        .getState()
        .sendMessage(sessionId, content, scope, fileRefs, undefined, runRefIds)
    },
    [sessionId, scope]
  )

  const stopGeneration = useCallback(() => {
    return useAgentSessionStore.getState().stopGeneration(sessionId, scope)
  }, [sessionId, scope])

  const respondToInteract = useCallback(
    (requestId: string, approved: boolean, paths?: string[]) => {
      return useAgentSessionStore
        .getState()
        .respondToInteract(sessionId, requestId, approved, scope, paths)
    },
    [sessionId, scope]
  )

  const rollbackToCheckpoint = useCallback(
    (checkpointId: string, restoreFiles?: boolean) => {
      return useAgentSessionStore
        .getState()
        .rollbackToCheckpoint(sessionId, checkpointId, scope, restoreFiles)
    },
    [sessionId, scope]
  )

  const grantPaths = useCallback(
    async (paths: string[]) => {
      const httpClient = manager?.getHttpClient()
      if (!httpClient) return
      await httpClient.grantSessionPaths(sessionId, paths, scope)
    },
    [manager, sessionId, scope]
  )

  // --- Edit & Regenerate ---
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)

  const findCheckpointForMessage = useCallback(
    (messageIndex: number): SessionCheckpoint | null => {
      const cps = session?.checkpoints
      if (!cps || cps.length === 0) return null
      let best: SessionCheckpoint | null = null
      for (const cp of cps) {
        if (cp.messageIndex <= messageIndex) {
          if (!best || cp.messageIndex > best.messageIndex) best = cp
        }
      }
      return best
    },
    [session?.checkpoints]
  )

  const editAndResend = useCallback(
    async (messageId: string, newContent: string) => {
      if (sending || !session) return
      const msgIndex = session.messages.findIndex((m) => m.id === messageId)
      if (msgIndex < 0) return
      const cp = findCheckpointForMessage(msgIndex)
      if (!cp) return
      setEditingMessageId(null)
      const result = await rollbackToCheckpoint(cp.id)
      if (result) {
        await sendMessage(newContent.trim())
      }
    },
    [sending, session, findCheckpointForMessage, rollbackToCheckpoint, sendMessage]
  )

  const regenerate = useCallback(
    async (assistantMessageId: string) => {
      if (sending || !session) return
      const msgIndex = session.messages.findIndex((m) => m.id === assistantMessageId)
      if (msgIndex < 0) return
      const prevUserMsg = [...session.messages.slice(0, msgIndex)]
        .reverse()
        .find((m) => m.role === 'user')
      if (!prevUserMsg) return
      const userMsgIndex = session.messages.indexOf(prevUserMsg)
      const cp = findCheckpointForMessage(userMsgIndex)
      if (!cp) return
      const originalContent = getTextContent(prevUserMsg).trim()
      if (!originalContent) return
      const result = await rollbackToCheckpoint(cp.id)
      if (result) {
        await sendMessage(originalContent)
      }
    },
    [sending, session, findCheckpointForMessage, rollbackToCheckpoint, sendMessage]
  )

  // --- GrantPath / Interact contexts (internalized) ---
  const grantPathValue = useMemo<GrantPathContextValue>(
    () => ({ grantPaths }),
    [grantPaths]
  )

  const interactValue = useMemo<InteractContextValue>(
    () => ({ pendingInteract, respondToInteract }),
    [pendingInteract, respondToInteract]
  )

  // --- Context value (memoized) ---
  // `active` is deliberately excluded from deps: visibility is controlled by the
  // parent wrapper div in AgentPage (display:none/flex), so SessionChatPanel
  // does not need to re-render when only `active` changes.
  // The scroll useLayoutEffect above still reacts to `active` via the component
  // re-render triggered by the memo'd prop change.
  const value = useMemo<SessionChatContextValue>(
    () => ({
      sessionId,
      scope,
      active,
      session,
      loading,
      sending,
      thinking,
      optimisticMessages,
      pendingInteract,
      chatData,
      checkpointByMsgIdx,
      messagesContainerRef,
      messagesEndRef,
      showScrollBtn,
      scrollToBottom,
      handleMessagesScroll,
      sendMessage,
      stopGeneration,
      respondToInteract,
      rollbackToCheckpoint,
      grantPaths,
      editingMessageId,
      setEditingMessageId,
      editAndResend,
      regenerate
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- active excluded on purpose (see above)
    [
      sessionId,
      scope,
      session,
      loading,
      sending,
      thinking,
      optimisticMessages,
      pendingInteract,
      chatData,
      checkpointByMsgIdx,
      showScrollBtn,
      scrollToBottom,
      handleMessagesScroll,
      sendMessage,
      stopGeneration,
      respondToInteract,
      rollbackToCheckpoint,
      grantPaths,
      editingMessageId,
      editAndResend,
      regenerate
    ]
  )

  return (
    <SessionChatContext.Provider value={value}>
      <GrantPathProvider value={grantPathValue}>
        <InteractProvider value={interactValue}>
          {children}
        </InteractProvider>
      </GrantPathProvider>
    </SessionChatContext.Provider>
  )
})
