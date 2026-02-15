/**
 * 统一的 pending payload 应用组件
 * 将 chatWith 传入的 payload（文件引用、文本、命令）转换为输入框内容
 * 必须放在 ChatInputProvider 内部使用
 */
import { useEffect, useRef } from 'react'
import { useChatWithFile } from '../../context/ChatWithFileContext'
import type { ChatWithPayload } from '../../context/ChatWithFileContext'
import { useChatInputStore } from './store'
import type { FileKind } from '../../hooks/useFileList'

function refMarkdown(kind: FileKind, id: string): string {
  const key = kind === 'document' ? 'doc' : kind
  return `@(${key}:${id})`
}

/** Build a unique key for deduplication */
function payloadKey(p: ChatWithPayload): string {
  const filesKey = p.files?.map((f) => `${f.kind}:${f.id}`).join(',') ?? ''
  const cmdsKey = p.commands?.join(',') ?? ''
  return `${filesKey}|${p.text ?? ''}|${cmdsKey}|${p.sessionId ?? ''}`
}

/** Convert a ChatWithPayload into markdown content for the editor */
function payloadToMarkdown(payload: ChatWithPayload): string {
  const parts: string[] = []

  if (payload.commands?.length) {
    for (const cmd of payload.commands) {
      const normalized = cmd.startsWith('/') ? cmd : `/${cmd}`
      parts.push(normalized)
    }
  }

  if (payload.files?.length) {
    const refs = payload.files.map((f) => refMarkdown(f.kind, f.id))
    parts.push(refs.join(' '))
  }

  if (payload.text) {
    parts.push(payload.text)
  }

  return parts.join('\n')
}

export function PendingChatPayloadApplicator() {
  const { pendingPayload, consumePendingPayload } = useChatWithFile()
  const setMarkdownContent = useChatInputStore((s) => s.setMarkdownContent)
  const focusBlockInput = useChatInputStore((s) => s.focusBlockInput)
  const appliedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pendingPayload) return
    const key = payloadKey(pendingPayload)
    if (appliedKeyRef.current === key) return

    const content = payloadToMarkdown(pendingPayload)
    if (content) {
      setMarkdownContent(content)
    }
    appliedKeyRef.current = key
    consumePendingPayload()

    const t = setTimeout(() => {
      focusBlockInput?.()
    }, 100)
    return () => clearTimeout(t)
  }, [pendingPayload, setMarkdownContent, consumePendingPayload, focusBlockInput])

  useEffect(() => {
    if (!pendingPayload) appliedKeyRef.current = null
  }, [pendingPayload])

  return null
}
