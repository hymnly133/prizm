/**
 * 统一的 pending payload 应用组件
 * 将 chatWith 传入的 payload 转换为：
 *   - text / commands → 输入框纯文本内容
 *   - files / fileRefs → inputRefs（引用栏标签）
 * 必须放在 ChatInputProvider 内部使用
 */
import { createClientLogger } from '@prizm/client-core'
import { useEffect, useRef } from 'react'

const log = createClientLogger('ChatInput')
import { useChatWithFile } from '../../context/ChatWithFileContext'
import type { ChatWithPayload } from '../../context/ChatWithFileContext'
import { useChatInputStore } from './store'
import type { InputRef } from './store/initialState'
import { encodeFilePathForRef, extractFileNameFromPath } from '../../utils/fileRefEncoding'

/** Build a unique key for deduplication */
function payloadKey(p: ChatWithPayload): string {
  const filesKey = p.files?.map((f) => `${f.kind}:${f.id}`).join(',') ?? ''
  const fileRefsKey = p.fileRefs?.map((f) => f.path).join(',') ?? ''
  const cmdsKey = p.commands?.join(',') ?? ''
  return `${filesKey}|${fileRefsKey}|${p.text ?? ''}|${cmdsKey}|${p.sessionId ?? ''}|${
    p.forceNew ? 'force' : ''
  }`
}

/** Convert a ChatWithPayload into plain text (only text + commands, no refs) */
function payloadToText(payload: ChatWithPayload): string {
  const parts: string[] = []

  if (payload.commands?.length) {
    for (const cmd of payload.commands) {
      const normalized = cmd.startsWith('/') ? cmd : `/${cmd}`
      parts.push(normalized)
    }
  }

  if (payload.text) {
    parts.push(payload.text)
  }

  return parts.join('\n')
}

/** Map FileKind to the @ reference key and InputRef type */
function kindToRefKey(kind: string): InputRef['type'] {
  switch (kind) {
    case 'document':
      return 'doc'
    case 'todoList':
      return 'todo'
    case 'note':
      return 'note'
    default:
      return 'doc'
  }
}

/** Convert payload files/fileRefs to InputRef[] */
function payloadToInputRefs(payload: ChatWithPayload): InputRef[] {
  const refs: InputRef[] = []

  if (payload.files?.length) {
    for (const f of payload.files) {
      const refType = kindToRefKey(f.kind)
      const refKey = refType === 'doc' ? 'doc' : refType
      refs.push({
        type: refType,
        key: f.id,
        label: f.title || f.id.slice(0, 8),
        markdown: `@(${refKey}:${f.id})`
      })
    }
  }

  if (payload.fileRefs?.length) {
    for (const f of payload.fileRefs) {
      const encoded = encodeFilePathForRef(f.path)
      refs.push({
        type: 'file',
        key: encoded,
        label: f.name || extractFileNameFromPath(encoded),
        markdown: `@(file:${encoded})`
      })
    }
  }

  return refs
}

export function PendingChatPayloadApplicator() {
  const { pendingPayload, consumePendingPayload } = useChatWithFile()
  const setMarkdownContent = useChatInputStore((s) => s.setMarkdownContent)
  const setInputRefs = useChatInputStore((s) => s.setInputRefs)
  const focusBlockInput = useChatInputStore((s) => s.focusBlockInput)
  const appliedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    log.debug('PayloadApplicator mounted')
    return () => log.debug('PayloadApplicator unmounted')
  }, [])

  useEffect(() => {
    log.debug('PayloadApplicator effect', {
      hasPendingPayload: !!pendingPayload,
      payloadFileRefs: pendingPayload?.fileRefs,
      payloadFileRefsCount: pendingPayload?.fileRefs?.length ?? 0
    })
    if (!pendingPayload) return
    const key = payloadKey(pendingPayload)
    if (appliedKeyRef.current === key) {
      log.debug('Skipping duplicate payload, key:', key)
      return
    }

    const text = payloadToText(pendingPayload)
    const refs = payloadToInputRefs(pendingPayload)
    log.debug('Applying payload', {
      textLength: text?.length ?? 0,
      textPreview: text?.slice(0, 80),
      refsCount: refs.length,
      refs,
      willSetMarkdownContent: !!text,
      willSetInputRefs: refs.length > 0
    })

    if (text) {
      setMarkdownContent(text)
    }

    if (refs.length > 0) {
      setInputRefs(refs)
      log.debug('Set input refs:', refs.length)
    } else {
      log.debug('No refs to set')
    }

    appliedKeyRef.current = key
    consumePendingPayload()

    const t = setTimeout(() => {
      focusBlockInput?.()
    }, 100)
    return () => clearTimeout(t)
  }, [pendingPayload, setMarkdownContent, setInputRefs, consumePendingPayload, focusBlockInput])

  useEffect(() => {
    if (!pendingPayload) appliedKeyRef.current = null
  }, [pendingPayload])

  return null
}
