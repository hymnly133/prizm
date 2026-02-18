/**
 * Agent 消息适配：将 AgentMessage 转为 lobe-ui ChatMessage，以及会话输入框草稿缓存管理
 */
import type { ChatMessage } from '@lobehub/ui/chat'
import type { AgentMessage } from '@prizm/client-core'
import { getTextContent } from '@prizm/client-core'
import { useEffect } from 'react'
import { useChatInputStore, useChatInputStoreApi } from '../../features/ChatInput'

/** Draft cache key for new (unsaved) conversations */
export const DRAFT_KEY_NEW = '__new__'

/** Module-level draft cache: sessionId → markdown content, survives session switches & page toggles */
const _draftCache = new Map<string, string>()
export const draftCache = _draftCache

/**
 * When PendingChatPayloadApplicator sets content during a forceNew flow,
 * DraftCacheManager must NOT overwrite it when the session switches.
 * This flag is set in the pendingPayload handler and consumed by DraftCacheManager.
 */
let _skipNextDraftRestore = false
export function setSkipNextDraftRestore(): void {
  _skipNextDraftRestore = true
}

/**
 * Saves / restores draft per session (keyed by sessionId).
 * - On mount (or sessionId change): restores cached content
 * - On cleanup (unmount or before sessionId change): saves current content
 * Must be a child of ChatInputProvider.
 */
export function DraftCacheManager({ sessionId }: { sessionId: string }) {
  const storeApi = useChatInputStoreApi()
  const setMarkdownContent = useChatInputStore((s) => s.setMarkdownContent)

  useEffect(() => {
    if (_skipNextDraftRestore) {
      _skipNextDraftRestore = false
      return () => {
        const content = storeApi.getState().markdownContent
        if (content.trim()) {
          _draftCache.set(sessionId, content)
        } else {
          _draftCache.delete(sessionId)
        }
      }
    }

    const cached = _draftCache.get(sessionId) ?? ''
    setMarkdownContent(cached)

    return () => {
      const content = storeApi.getState().markdownContent
      if (content.trim()) {
        _draftCache.set(sessionId, content)
      } else {
        _draftCache.delete(sessionId)
      }
    }
  }, [sessionId, storeApi, setMarkdownContent])

  return null
}

const _chatMessageCache = new Map<string, ChatMessage>()

function buildChatMessage(m: AgentMessage & { streaming?: boolean }): ChatMessage {
  const ts = m.createdAt
  const title = m.role === 'user' ? '你' : m.role === 'system' ? '命令结果' : 'AI'
  const avatar = m.role === 'user' ? '👤' : m.role === 'system' ? '⚡' : '🤖'
  return {
    id: m.id,
    content: getTextContent(m),
    role: m.role,
    createAt: ts,
    updateAt: ts,
    meta: {
      title,
      avatar
    },
    extra: {
      model: m.model,
      usage: m.usage,
      streaming: m.streaming,
      reasoning: m.reasoning,
      parts: m.parts,
      memoryRefs: m.memoryRefs,
      messageId: m.id
    }
  }
}

/** 将 AgentMessage 转为 lobe-ui ChatMessage 格式（带缓存，流式消息跳过缓存） */
export function toChatMessage(m: AgentMessage & { streaming?: boolean }): ChatMessage {
  if (m.streaming) return buildChatMessage(m)
  const cached = _chatMessageCache.get(m.id)
  if (cached) return cached
  const result = buildChatMessage(m)
  _chatMessageCache.set(m.id, result)
  return result
}

/** 清理已不存在的消息缓存条目 */
export function pruneMessageCache(validIds: Set<string>): void {
  for (const id of _chatMessageCache.keys()) {
    if (!validIds.has(id)) _chatMessageCache.delete(id)
  }
}
