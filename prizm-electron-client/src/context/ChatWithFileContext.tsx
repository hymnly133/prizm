/**
 * 统一的 chatWith API：从任意位置发起对话，支持文件引用、文本、命令等
 * 跳转到 Agent 页并将 payload 注入输入框
 */
import { createContext, useContext, useCallback, useState } from 'react'
import type { FileKind } from '../hooks/useFileList'

/** 单个文件引用 */
export interface ChatFileRef {
  kind: FileKind
  id: string
}

/** 统一的 chatWith 载荷 */
export interface ChatWithPayload {
  /** 初始文本内容 */
  text?: string
  /** 引用文件列表（支持多个） */
  files?: ChatFileRef[]
  /** 命令列表（如 /docs, /help） */
  commands?: string[]
  /** 指定会话 ID（省略则新建） */
  sessionId?: string
}

/** @deprecated 旧接口兼容，请使用 ChatWithPayload */
export interface PendingChatFile {
  kind: FileKind
  id: string
  sessionId?: string
}

export interface ChatWithContextValue {
  /** 统一入口：发起对话并导航到 Agent 页面 */
  chatWith: (payload: ChatWithPayload) => void
  /** 当前待处理的 payload */
  pendingPayload: ChatWithPayload | null
  /** 消费（清除）pending payload */
  consumePendingPayload: () => void

  // --- 向后兼容的快捷方法 ---
  /** @deprecated 请使用 chatWith({ files: [{ kind, id }] }) */
  startChatWithFile: (payload: PendingChatFile) => void
  /** @deprecated 请使用 chatWith.pendingPayload */
  pendingChatFile: PendingChatFile | null
  /** @deprecated 请使用 consumePendingPayload */
  consumePendingChatFile: () => void
  /** @deprecated 请使用 chatWith({ text }) */
  pendingChatText: string | null
  /** @deprecated 请使用 chatWith({ text }) */
  setPendingChatText: (text: string | null) => void
}

const defaultValue: ChatWithContextValue = {
  chatWith: () => {},
  pendingPayload: null,
  consumePendingPayload: () => {},
  startChatWithFile: () => {},
  pendingChatFile: null,
  consumePendingChatFile: () => {},
  pendingChatText: null,
  setPendingChatText: () => {}
}

const ChatWithFileContext = createContext<ChatWithContextValue>(defaultValue)

export function useChatWithFile(): ChatWithContextValue {
  return useContext(ChatWithFileContext)
}

export function ChatWithFileProvider({
  children,
  onNavigateToAgent
}: {
  children: React.ReactNode
  onNavigateToAgent: () => void
}) {
  const [pendingPayload, setPendingPayload] = useState<ChatWithPayload | null>(null)

  const chatWith = useCallback(
    (payload: ChatWithPayload) => {
      setPendingPayload(payload)
      onNavigateToAgent()
    },
    [onNavigateToAgent]
  )

  const consumePendingPayload = useCallback(() => {
    setPendingPayload(null)
  }, [])

  // --- 向后兼容包装 ---
  const startChatWithFile = useCallback(
    (payload: PendingChatFile) => {
      chatWith({
        files: [{ kind: payload.kind, id: payload.id }],
        sessionId: payload.sessionId
      })
    },
    [chatWith]
  )

  const pendingChatFile: PendingChatFile | null =
    pendingPayload?.files?.length === 1
      ? {
          kind: pendingPayload.files[0].kind,
          id: pendingPayload.files[0].id,
          sessionId: pendingPayload.sessionId
        }
      : null

  const setPendingChatText = useCallback(
    (text: string | null) => {
      if (text === null) {
        // Clear only if current payload is text-only
        setPendingPayload((prev) =>
          prev && !prev.files?.length && !prev.commands?.length && !prev.sessionId ? null : prev
        )
      } else {
        chatWith({ text })
      }
    },
    [chatWith]
  )

  const pendingChatText = pendingPayload?.text ?? null

  const consumePendingChatFile = consumePendingPayload

  return (
    <ChatWithFileContext.Provider
      value={{
        chatWith,
        pendingPayload,
        consumePendingPayload,
        startChatWithFile,
        pendingChatFile,
        consumePendingChatFile,
        pendingChatText,
        setPendingChatText
      }}
    >
      {children}
    </ChatWithFileContext.Provider>
  )
}
