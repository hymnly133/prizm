/**
 * useAgentChatActions — Agent 聊天操作的共享 hook
 *
 * 提取 AgentPage 和 AgentPane 共同的 handleSend / handleClear / handleQuickPrompt /
 * handleMarkdownContentChange / sendButtonProps 逻辑，消除重复代码。
 */
import { useCallback, useMemo, useRef } from 'react'
import type { EnrichedSession } from '@prizm/client-core'
import type { FilePathRef } from '@prizm/shared'
import type { InputRef, SendButtonProps } from '../features/ChatInput/store/initialState'
import { DRAFT_KEY_NEW, draftCache, setSkipNextDraftRestore } from '../components/agent/chatMessageAdapter'

export interface UseAgentChatActionsOptions {
  currentSession: EnrichedSession | null
  sending: boolean
  createSession: () => Promise<EnrichedSession | null>
  sendMessage: (
    content: string,
    session?: EnrichedSession | null,
    fileRefs?: FilePathRef[],
    runRefIds?: string[]
  ) => Promise<unknown>
  stopGeneration: () => Promise<void>
  setCurrentSession: (session: EnrichedSession | null) => void
  /**
   * 额外判断是否需要创建新会话（例如 AgentPage 在 overview 模式下需要创建）。
   * 返回 true 时即使 currentSession 存在也会新建。
   */
  shouldCreateNewSession?: () => boolean
  /** 创建新会话之前的回调（例如 AgentPage 设置 overviewMode(false)） */
  onBeforeCreateSession?: () => void
  /** 发送成功后的回调（例如协作页滚动到底部） */
  onAfterSend?: () => void
}

export function useAgentChatActions(options: UseAgentChatActionsOptions) {
  const {
    currentSession,
    sending,
    createSession,
    sendMessage,
    stopGeneration,
    setCurrentSession,
    shouldCreateNewSession,
    onBeforeCreateSession,
    onAfterSend
  } = options

  const currentSessionRef = useRef(currentSession)
  currentSessionRef.current = currentSession
  const sendingRef = useRef(sending)
  sendingRef.current = sending

  const handleMarkdownContentChange = useCallback((content: string) => {
    const key = currentSessionRef.current?.id ?? DRAFT_KEY_NEW
    if (content.trim()) {
      draftCache.set(key, content)
    } else {
      draftCache.delete(key)
    }
  }, [])

  const handleSend = useCallback(
    async ({
      clearContent,
      getMarkdownContent,
      getInputRefs
    }: {
      clearContent: () => void
      getMarkdownContent: () => string
      getInputRefs: () => InputRef[]
    }) => {
      const rawText = getMarkdownContent().trim()
      const refs = getInputRefs()
      if (!rawText && refs.length === 0) return
      if (sendingRef.current) return

      let session = currentSessionRef.current
      if (!session || shouldCreateNewSession?.()) {
        onBeforeCreateSession?.()
        session = await createSession()
        if (!session) return
      }

      const refParts = refs.map((r) => r.markdown)
      const combined = [...refParts, rawText].filter(Boolean).join('\n')
      const fileRefs: FilePathRef[] = refs
        .filter((r) => r.type === 'file')
        .map((r) => ({
          path: r.key.replace(/%29/g, ')'),
          name: r.label
        }))
      const runRefIds = refs.filter((r) => r.type === 'run').map((r) => r.key)

      draftCache.delete(DRAFT_KEY_NEW)
      if (session) draftCache.delete(session.id)
      clearContent()
      await sendMessage(
        combined,
        session,
        fileRefs.length > 0 ? fileRefs : undefined,
        runRefIds?.length ? runRefIds : undefined
      )
      onAfterSend?.()
    },
    [createSession, sendMessage, shouldCreateNewSession, onBeforeCreateSession, onAfterSend]
  )

  const handleClear = useCallback(() => {
    setCurrentSession(null)
  }, [setCurrentSession])

  const handleQuickPrompt = useCallback(
    (text: string) => {
      setCurrentSession(null)
      draftCache.set(DRAFT_KEY_NEW, text)
    },
    [setCurrentSession]
  )

  const isDisabled = sending

  const sendButtonProps = useMemo<SendButtonProps>(
    () => ({
      disabled: isDisabled,
      generating: sending,
      onStop: stopGeneration,
      shape: 'round' as const
    }),
    [isDisabled, sending, stopGeneration]
  )

  return {
    handleSend,
    handleClear,
    handleQuickPrompt,
    handleMarkdownContentChange,
    sendButtonProps
  }
}
