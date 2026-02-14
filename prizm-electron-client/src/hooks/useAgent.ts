/**
 * useAgent - Agent 会话管理、发消息、流式消费、停止生成
 * 仿照 LobeHub：乐观更新 + 流式原地更新，不依赖 loadSession 获取消息
 * 流式更新使用普通 setState，避免 flushSync 阻塞主线程导致卡顿、无法交互
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { usePrizmContext, useSyncEventContext } from '../context/PrizmContext'
import type {
  AgentSession,
  AgentMessage,
  ToolCallRecord,
  MessagePart,
  MessagePartTool
} from '@prizm/client-core'

function tmpId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function useAgent(scope: string) {
  const { manager } = usePrizmContext()
  const { lastSyncEvent } = useSyncEventContext()
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [currentSession, setCurrentSession] = useState<AgentSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 客户端选择的模型，空则用服务端默认 */
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined)

  /** 乐观更新消息：发送时的 [userMsg, assistantMsg]，流式过程中原地更新 assistant */
  const [optimisticMessages, setOptimisticMessages] = useState<AgentMessage[]>([])

  /** 当前流式请求的 AbortController */
  const abortControllerRef = useRef<AbortController | null>(null)

  const http = manager?.getHttpClient()

  const refreshSessions = useCallback(async () => {
    if (!http || !scope) return
    setLoading(true)
    try {
      const list = await http.listAgentSessions(scope)
      setSessions(list)
    } catch {
      setSessions([])
    } finally {
      setLoading(false)
    }
  }, [http, scope])

  const createSession = useCallback(async () => {
    if (!http || !scope) return null
    setLoading(true)
    try {
      const session = await http.createAgentSession(scope)
      await refreshSessions()
      setCurrentSession(session)
      return session
    } catch {
      return null
    } finally {
      setLoading(false)
    }
  }, [http, scope, refreshSessions])

  const deleteSession = useCallback(
    async (id: string) => {
      if (!http || !scope) return
      setLoading(true)
      try {
        await http.deleteAgentSession(id, scope)
        if (currentSession?.id === id) {
          setCurrentSession(null)
          setOptimisticMessages([])
        }
        await refreshSessions()
      } finally {
        setLoading(false)
      }
    },
    [http, scope, currentSession?.id, refreshSessions]
  )

  const loadSession = useCallback(
    async (id: string) => {
      if (!http || !scope) return null
      setLoading(true)
      setOptimisticMessages([]) // 切换会话时清除乐观更新
      setError(null)
      try {
        const session = await http.getAgentSession(id, scope)
        setCurrentSession(session)
        return session
      } catch {
        return null
      } finally {
        setLoading(false)
      }
    },
    [http, scope]
  )

  const updateSession = useCallback(
    async (id: string, update: { title?: string }) => {
      if (!http || !scope) return null
      try {
        const session = await http.updateAgentSession(id, update, scope)
        setCurrentSession((prev) => (prev?.id === id ? { ...prev, ...session } : prev))
        await refreshSessions()
        return session
      } catch {
        return null
      }
    },
    [http, scope, refreshSessions]
  )

  /** 停止当前生成 */
  const stopGeneration = useCallback(async () => {
    // 1. 本地 abort fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    // 2. 通知后端停止（双路径保险）
    if (http && currentSession) {
      try {
        await http.stopAgentChat(currentSession.id, scope)
      } catch {
        // 忽略：后端可能已结束
      }
    }
  }, [http, currentSession, scope])

  const sendMessage = useCallback(
    async (content: string, sessionOverride?: AgentSession | null): Promise<string | null> => {
      const session = sessionOverride ?? currentSession
      if (!http || !session || !content.trim()) return null
      setSending(true)
      setError(null)

      // 创建 AbortController
      const ac = new AbortController()
      abortControllerRef.current = ac

      const now = Date.now()
      const userMsg: AgentMessage = {
        id: tmpId('user'),
        role: 'user',
        content: content.trim(),
        createdAt: now
      }
      const assistantMsg: AgentMessage = {
        id: tmpId('assistant'),
        role: 'assistant',
        content: '',
        createdAt: now
      }

      setOptimisticMessages([userMsg, assistantMsg])
      const sessionId = session.id
      let lastUsage: AgentMessage['usage'] | undefined
      let lastModel: string | undefined

      try {
        let fullContent = ''
        let segmentContent = ''
        let fullReasoning = ''
        const fullToolCalls: ToolCallRecord[] = []
        const parts: MessagePart[] = []
        let wasStopped = false
        let commandResultContent: string | null = null
        await http.streamChat(session.id, content.trim(), {
          scope,
          signal: ac.signal,
          model: selectedModel,
          onChunk: (chunk) => {
            if (chunk.type === 'command_result' && typeof chunk.value === 'string') {
              commandResultContent = chunk.value
              setOptimisticMessages((prev) => {
                if (prev.length < 1) return prev
                return [
                  prev[0],
                  {
                    id: tmpId('cmd'),
                    role: 'system',
                    content: chunk.value as string,
                    createdAt: Date.now()
                  }
                ]
              })
            }
            if (chunk.type === 'text' && chunk.value) {
              fullContent += chunk.value
              segmentContent += chunk.value
              setOptimisticMessages((prev) => {
                if (prev.length < 2) return prev
                const assistant = {
                  ...prev[1],
                  content: fullContent,
                  ...(parts.length > 0
                    ? { parts: [...parts, { type: 'text' as const, content: segmentContent }] }
                    : {})
                }
                return [prev[0], assistant]
              })
            }
            if (chunk.type === 'reasoning' && chunk.value) {
              fullReasoning += chunk.value
              setOptimisticMessages((prev) => {
                if (prev.length < 2) return prev
                const assistant = {
                  ...prev[1],
                  content: prev[1].content,
                  reasoning: fullReasoning
                }
                return [prev[0], assistant]
              })
            }
            if (
              chunk.type === 'tool_result_chunk' &&
              chunk.value &&
              typeof chunk.value === 'object' &&
              'id' in chunk.value &&
              'chunk' in chunk.value
            ) {
              const { id, chunk: chunkText } = chunk.value as { id: string; chunk: string }
              // 服务端在首轮有 tool_calls 时不会先发 done，会先发 tool_result_chunk，必须先刷入当前文本段再插入 tool，否则顺序会变成 B A D C
              if (segmentContent) {
                parts.push({ type: 'text', content: segmentContent })
                segmentContent = ''
              }
              const existing = parts.find(
                (p): p is MessagePartTool => p.type === 'tool' && p.id === id
              )
              const newParts: MessagePart[] = existing
                ? parts.map((p) =>
                    p.type === 'tool' && p.id === id ? { ...p, result: p.result + chunkText } : p
                  )
                : [
                    ...parts,
                    { type: 'tool' as const, id, name: '…', arguments: '', result: chunkText }
                  ]
              parts.length = 0
              parts.push(...newParts)
              setOptimisticMessages((prev) => {
                if (prev.length < 2) return prev
                return [
                  prev[0],
                  {
                    ...prev[1],
                    content: fullContent,
                    toolCalls: [...fullToolCalls],
                    parts: [...newParts]
                  }
                ]
              })
            }
            if (
              chunk.type === 'tool_call' &&
              chunk.value &&
              typeof chunk.value === 'object' &&
              'id' in chunk.value
            ) {
              const tc = chunk.value as ToolCallRecord
              const existingIdx = fullToolCalls.findIndex((t) => t.id === tc.id)
              if (existingIdx >= 0) fullToolCalls[existingIdx] = tc
              else fullToolCalls.push(tc)
              if (segmentContent) {
                parts.push({ type: 'text', content: segmentContent })
                segmentContent = ''
              }
              const existingTool = parts.find(
                (p): p is MessagePartTool => p.type === 'tool' && p.id === tc.id
              )
              const toolPart: MessagePartTool = {
                type: 'tool',
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments ?? '',
                result: tc.result ?? existingTool?.result ?? '',
                ...(tc.isError && { isError: true }),
                ...(tc.status && { status: tc.status })
              }
              if (existingTool) {
                const idx = parts.indexOf(existingTool)
                parts[idx] = toolPart
              } else {
                parts.push(toolPart)
              }
              setOptimisticMessages((prev) => {
                if (prev.length < 2) return prev
                return [
                  prev[0],
                  {
                    ...prev[1],
                    content: fullContent,
                    toolCalls: [...fullToolCalls],
                    parts: [...parts]
                  }
                ]
              })
            }
            if (chunk.type === 'done') {
              if (chunk.usage) lastUsage = chunk.usage
              if (chunk.model) lastModel = chunk.model
              if (chunk.stopped) wasStopped = true
              if (segmentContent) {
                parts.push({ type: 'text', content: segmentContent })
                segmentContent = ''
              }
              if (!commandResultContent) {
                setOptimisticMessages((prev) => {
                  if (prev.length < 2) return prev
                  return [
                    prev[0],
                    {
                      ...prev[1],
                      content: prev[1].content,
                      model: lastModel ?? prev[1].model,
                      usage: lastUsage ?? prev[1].usage,
                      toolCalls: fullToolCalls.length > 0 ? fullToolCalls : prev[1].toolCalls,
                      ...(parts.length > 0 && { parts: [...parts] }),
                      ...(fullReasoning && { reasoning: fullReasoning })
                    }
                  ]
                })
              }
            }
          },
          onError: (msg) => {
            setError(msg)
          }
        })

        // 流式结束：将乐观消息合并进 currentSession（含 model、usage、reasoning、toolCalls 或 command_result）
        setCurrentSession((prev) => {
          const base = prev?.id === sessionId ? prev : session
          if (base.id !== sessionId) return prev ?? base
          if (commandResultContent != null) {
            return {
              ...base,
              messages: [
                ...base.messages,
                userMsg,
                {
                  id: tmpId('cmd'),
                  role: 'system',
                  content: commandResultContent,
                  createdAt: Date.now()
                }
              ]
            }
          }
          return {
            ...base,
            messages: [
              ...base.messages,
              userMsg,
              {
                ...assistantMsg,
                content: fullContent,
                model: lastModel,
                usage: lastUsage,
                ...(fullReasoning && { reasoning: fullReasoning }),
                ...(fullToolCalls.length > 0 && { toolCalls: fullToolCalls }),
                ...(parts.length > 0 && { parts: [...parts] })
              }
            ]
          }
        })
        setOptimisticMessages([])
        await refreshSessions()
        return commandResultContent ?? fullContent
      } catch (err) {
        // AbortError 是正常停止
        const isAbort = err instanceof Error && err.name === 'AbortError'
        if (isAbort) {
          // 停止时将已有内容合并进 session（含 usage/model，若已收到 done）
          setOptimisticMessages((prev) => {
            if (prev.length < 2) return []
            const assistant = prev[1]
            if (assistant?.content) {
              setCurrentSession((s) => {
                const base = s?.id === sessionId ? s : session
                if (base.id !== sessionId) return s ?? base
                return {
                  ...base,
                  messages: [
                    ...base.messages,
                    userMsg,
                    {
                      ...assistant,
                      content: assistant.content,
                      model: lastModel ?? assistant.model,
                      usage: lastUsage ?? assistant.usage,
                      ...(assistant.toolCalls?.length && { toolCalls: assistant.toolCalls }),
                      ...(assistant.parts?.length && { parts: assistant.parts }),
                      ...(assistant.reasoning && {
                        reasoning: assistant.reasoning
                      })
                    }
                  ]
                }
              })
            }
            return []
          })
        } else {
          setError(err instanceof Error ? err.message : '发送失败')
          setOptimisticMessages([])
        }
        return null
      } finally {
        abortControllerRef.current = null
        setSending(false)
      }
    },
    [http, currentSession, scope, refreshSessions, selectedModel]
  )

  useEffect(() => {
    if (http && scope) void refreshSessions()
  }, [http, scope, refreshSessions])

  useEffect(() => {
    if (lastSyncEvent?.startsWith('agent:')) {
      if (scope) void refreshSessions()
      if (currentSession) void loadSession(currentSession.id)
    }
  }, [lastSyncEvent, scope, currentSession?.id, refreshSessions, loadSession])

  // 组件卸载时 abort 进行中的请求
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  return {
    sessions,
    currentSession,
    loading,
    sending,
    error,
    refreshSessions,
    createSession,
    deleteSession,
    loadSession,
    updateSession,
    sendMessage,
    stopGeneration,
    setCurrentSession,
    optimisticMessages,
    selectedModel,
    setSelectedModel
  }
}
