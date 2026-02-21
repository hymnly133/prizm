/**
 * NavigationContext — 合并 WorkNavigation + DocumentNavigation + ChatWithFile
 * 提供统一的跨页面导航和数据传递能力
 */
import { createClientLogger } from '@prizm/client-core'
import { createContext, useContext, useCallback, useMemo, useRef, useState } from 'react'
import type { FileKind } from '../hooks/useFileList'
import type { FilePathRef } from '@prizm/shared'

const log = createClientLogger('Navigation')

/* ── ChatWith 类型（从 ChatWithFileContext 迁移） ── */

export interface ChatFileRef {
  kind: FileKind
  id: string
  title?: string
}

export interface ChatWithPayload {
  text?: string
  files?: ChatFileRef[]
  fileRefs?: FilePathRef[]
  commands?: string[]
  sessionId?: string
  forceNew?: boolean
  /** 导航到指定消息 ID 并高亮（记忆溯源用） */
  targetMessageId?: string
}

/** @deprecated 旧接口兼容 */
export interface PendingChatFile {
  kind: FileKind
  id: string
  sessionId?: string
}

/* ── Context 类型 ── */

export interface NavigationContextValue {
  /* Work navigation */
  openFileAtWork: (kind: FileKind, id: string) => void
  pendingWorkFile: { kind: FileKind; id: string } | null
  consumePendingWorkFile: () => void

  /* Document navigation */
  navigateToDocs: (docId: string) => void
  pendingDocId: string | null
  consumePendingDoc: () => string | null

  /* Chat navigation */
  chatWith: (payload: ChatWithPayload) => void
  pendingPayload: ChatWithPayload | null
  consumePendingPayload: () => void

  /** 导航到指定会话的指定消息（记忆溯源用） */
  navigateToAgentMessage: (sessionId: string, messageId: string) => void

  /** 导航到工作流页并创建待创建工作流会话（可带 initialPrompt） */
  navigateToWorkflowCreate: (payload: { initialPrompt?: string }) => void
  pendingWorkflowCreate: { initialPrompt?: string } | null
  consumePendingWorkflowCreate: () => { initialPrompt?: string } | null

  /** 导航到工作流页并选中指定工作流定义（用于会话 header「查看工作流」） */
  navigateToWorkflowDef: (defId: string, name?: string) => void
  pendingWorkflowDef: { defId: string; name?: string } | null
  consumePendingWorkflowDef: () => { defId: string; name?: string } | null

  /* ChatWithFile backward compat */
  /** @deprecated 请使用 chatWith({ files: [{ kind, id }] }) */
  startChatWithFile: (payload: PendingChatFile) => void
  /** @deprecated */
  pendingChatFile: PendingChatFile | null
  /** @deprecated */
  consumePendingChatFile: () => void
  /** @deprecated */
  pendingChatText: string | null
  /** @deprecated */
  setPendingChatText: (text: string | null) => void
}

const defaultValue: NavigationContextValue = {
  openFileAtWork: () => {},
  pendingWorkFile: null,
  consumePendingWorkFile: () => {},
  navigateToDocs: () => {},
  pendingDocId: null,
  consumePendingDoc: () => null,
  chatWith: () => {},
  pendingPayload: null,
  consumePendingPayload: () => {},
  navigateToAgentMessage: () => {},
  navigateToWorkflowCreate: () => {},
  pendingWorkflowCreate: null,
  consumePendingWorkflowCreate: () => null,
  navigateToWorkflowDef: () => {},
  pendingWorkflowDef: null,
  consumePendingWorkflowDef: () => null,
  startChatWithFile: () => {},
  pendingChatFile: null,
  consumePendingChatFile: () => {},
  pendingChatText: null,
  setPendingChatText: () => {}
}

const NavigationContext = createContext<NavigationContextValue>(defaultValue)

export interface NavigationProviderProps {
  children: React.ReactNode
  onNavigateToWork: () => void
  onNavigateToDocs: () => void
  onNavigateToAgent: () => void
  onNavigateToWorkflow?: () => void
}

export function NavigationProvider({
  children,
  onNavigateToWork,
  onNavigateToDocs,
  onNavigateToAgent,
  onNavigateToWorkflow
}: NavigationProviderProps) {
  /* ── Work ── */
  const [pendingWorkFile, setPendingWorkFile] = useState<{ kind: FileKind; id: string } | null>(
    null
  )

  const openFileAtWork = useCallback(
    (kind: FileKind, id: string) => {
      if (kind === 'document') {
        setPendingDocId(id)
        onNavigateToDocs()
        return
      }
      setPendingWorkFile({ kind, id })
      onNavigateToWork()
    },
    [onNavigateToWork, onNavigateToDocs]
  )

  const consumePendingWorkFile = useCallback(() => {
    setPendingWorkFile(null)
  }, [])

  /* ── Document（独立编辑页） ── */
  const [pendingDocId, setPendingDocId] = useState<string | null>(null)
  const pendingDocIdRef = useRef(pendingDocId)
  pendingDocIdRef.current = pendingDocId

  const navigateToDocs = useCallback(
    (docId: string) => {
      setPendingDocId(docId)
      onNavigateToDocs()
    },
    [onNavigateToDocs]
  )

  /** Stable: 通过 ref 读取最新 pendingDocId，避免依赖 state 导致回调重建 */
  const consumePendingDoc = useCallback(() => {
    const id = pendingDocIdRef.current
    setPendingDocId(null)
    return id
  }, [])

  /* ── Chat ── */
  const [pendingPayload, setPendingPayload] = useState<ChatWithPayload | null>(null)

  const chatWith = useCallback(
    (payload: ChatWithPayload) => {
      log.debug('chatWith received')
      setPendingPayload(payload)
      onNavigateToAgent()
    },
    [onNavigateToAgent]
  )

  const consumePendingPayload = useCallback(() => {
    setPendingPayload(null)
  }, [])

  const navigateToAgentMessage = useCallback(
    (sessionId: string, messageId: string) => {
      chatWith({ sessionId, targetMessageId: messageId })
    },
    [chatWith]
  )

  /* ── 工作流创建会话导航 ── */
  const [pendingWorkflowCreate, setPendingWorkflowCreate] = useState<{
    initialPrompt?: string
  } | null>(null)
  const pendingWorkflowCreateRef = useRef(pendingWorkflowCreate)
  pendingWorkflowCreateRef.current = pendingWorkflowCreate

  const navigateToWorkflowCreate = useCallback(
    (payload: { initialPrompt?: string }) => {
      setPendingWorkflowCreate(payload)
      onNavigateToWorkflow?.()
    },
    [onNavigateToWorkflow]
  )

  const consumePendingWorkflowCreate = useCallback(() => {
    const prev = pendingWorkflowCreateRef.current
    setPendingWorkflowCreate(null)
    return prev
  }, [])

  /* ── 工作流定义选中（会话 header「查看工作流」） ── */
  const [pendingWorkflowDef, setPendingWorkflowDef] = useState<{
    defId: string
    name?: string
  } | null>(null)
  const pendingWorkflowDefRef = useRef(pendingWorkflowDef)
  pendingWorkflowDefRef.current = pendingWorkflowDef

  const navigateToWorkflowDef = useCallback((defId: string, name?: string) => {
    setPendingWorkflowDef({ defId, name })
    onNavigateToWorkflow?.()
  }, [onNavigateToWorkflow])

  const consumePendingWorkflowDef = useCallback(() => {
    const prev = pendingWorkflowDefRef.current
    setPendingWorkflowDef(null)
    return prev ?? null
  }, [])

  /* ── Chat backward compat ── */
  const startChatWithFile = useCallback(
    (payload: PendingChatFile) => {
      chatWith({
        files: [{ kind: payload.kind, id: payload.id }],
        sessionId: payload.sessionId
      })
    },
    [chatWith]
  )

  const pendingChatFile = useMemo<PendingChatFile | null>(
    () =>
      pendingPayload?.files?.length === 1
        ? {
            kind: pendingPayload.files[0].kind,
            id: pendingPayload.files[0].id,
            sessionId: pendingPayload.sessionId
          }
        : null,
    [pendingPayload]
  )

  const setPendingChatText = useCallback(
    (text: string | null) => {
      if (text === null) {
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

  /** Memoize context value：仅在实际导航状态变化时更新引用，防止消费者级联重渲染 */
  const contextValue = useMemo<NavigationContextValue>(
    () => ({
      openFileAtWork,
      pendingWorkFile,
      consumePendingWorkFile,
      navigateToDocs,
      pendingDocId,
      consumePendingDoc,
      chatWith,
      pendingPayload,
      consumePendingPayload,
      navigateToAgentMessage,
      navigateToWorkflowCreate,
      pendingWorkflowCreate,
      consumePendingWorkflowCreate,
      navigateToWorkflowDef,
      pendingWorkflowDef,
      consumePendingWorkflowDef,
      startChatWithFile,
      pendingChatFile,
      consumePendingChatFile,
      pendingChatText,
      setPendingChatText
    }),
    [
      openFileAtWork,
      pendingWorkFile,
      consumePendingWorkFile,
      navigateToDocs,
      pendingDocId,
      consumePendingDoc,
      navigateToWorkflowCreate,
      pendingWorkflowCreate,
      consumePendingWorkflowCreate,
      navigateToWorkflowDef,
      pendingWorkflowDef,
      consumePendingWorkflowDef,
      chatWith,
      pendingPayload,
      consumePendingPayload,
      navigateToAgentMessage,
      startChatWithFile,
      pendingChatFile,
      consumePendingChatFile,
      pendingChatText,
      setPendingChatText
    ]
  )

  return <NavigationContext.Provider value={contextValue}>{children}</NavigationContext.Provider>
}

export function useNavigation(): NavigationContextValue {
  return useContext(NavigationContext)
}

/* ── 向后兼容 hooks（消费统一 context） ── */

export type WorkNavigationContextValue = Pick<
  NavigationContextValue,
  'openFileAtWork' | 'pendingWorkFile' | 'consumePendingWorkFile'
>

/**
 * 局部覆盖 Context：允许 AgentPage 等组件在局部覆盖 openFileAtWork 行为
 * 当覆盖层存在时，useWorkNavigation 优先返回覆盖值
 */
const WorkNavigationOverrideContext = createContext<WorkNavigationContextValue | null>(null)

export function WorkNavigationOverrideProvider({
  children,
  value
}: {
  children: React.ReactNode
  value: WorkNavigationContextValue
}) {
  return (
    <WorkNavigationOverrideContext.Provider value={value}>
      {children}
    </WorkNavigationOverrideContext.Provider>
  )
}

export function useWorkNavigation(): WorkNavigationContextValue {
  const override = useContext(WorkNavigationOverrideContext)
  const ctx = useContext(NavigationContext)
  return useMemo(
    () =>
      override ?? {
        openFileAtWork: ctx.openFileAtWork,
        pendingWorkFile: ctx.pendingWorkFile,
        consumePendingWorkFile: ctx.consumePendingWorkFile
      },
    [override, ctx.openFileAtWork, ctx.pendingWorkFile, ctx.consumePendingWorkFile]
  )
}

export type DocumentNavigationContextValue = Pick<
  NavigationContextValue,
  'navigateToDocs' | 'pendingDocId' | 'consumePendingDoc'
>

export function useDocumentNavigation(): DocumentNavigationContextValue {
  const ctx = useContext(NavigationContext)
  return useMemo(
    () => ({
      navigateToDocs: ctx.navigateToDocs,
      pendingDocId: ctx.pendingDocId,
      consumePendingDoc: ctx.consumePendingDoc
    }),
    [ctx.navigateToDocs, ctx.pendingDocId, ctx.consumePendingDoc]
  )
}

export type ChatWithContextValue = Pick<
  NavigationContextValue,
  | 'chatWith'
  | 'pendingPayload'
  | 'consumePendingPayload'
  | 'startChatWithFile'
  | 'pendingChatFile'
  | 'consumePendingChatFile'
  | 'pendingChatText'
  | 'setPendingChatText'
>

export function useChatWithFile(): ChatWithContextValue {
  const ctx = useContext(NavigationContext)
  return useMemo(
    () => ({
      chatWith: ctx.chatWith,
      pendingPayload: ctx.pendingPayload,
      consumePendingPayload: ctx.consumePendingPayload,
      startChatWithFile: ctx.startChatWithFile,
      pendingChatFile: ctx.pendingChatFile,
      consumePendingChatFile: ctx.consumePendingChatFile,
      pendingChatText: ctx.pendingChatText,
      setPendingChatText: ctx.setPendingChatText
    }),
    [
      ctx.chatWith,
      ctx.pendingPayload,
      ctx.consumePendingPayload,
      ctx.startChatWithFile,
      ctx.pendingChatFile,
      ctx.consumePendingChatFile,
      ctx.pendingChatText,
      ctx.setPendingChatText
    ]
  )
}
