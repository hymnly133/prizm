/**
 * 在 Agent 页输入框内应用「从工作区聊聊他」带来的引用并聚焦
 * 必须放在 ChatInputProvider 内部使用
 */
import { useEffect, useRef } from 'react'
import { useChatWithFile } from '../../context/ChatWithFileContext'
import { useChatInputStore } from './store'
import type { FileKind } from '../../hooks/useFileList'

function refMarkdown(kind: FileKind, id: string): string {
  const key = kind === 'document' ? 'doc' : kind
  return `@(${key}:${id})`
}

export function PendingChatFileApplicator() {
  const { pendingChatFile, consumePendingChatFile } = useChatWithFile()
  const setMarkdownContent = useChatInputStore((s) => s.setMarkdownContent)
  const focusBlockInput = useChatInputStore((s) => s.focusBlockInput)
  const appliedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pendingChatFile || appliedRef.current === `${pendingChatFile.kind}:${pendingChatFile.id}`)
      return
    const content = refMarkdown(pendingChatFile.kind, pendingChatFile.id)
    setMarkdownContent(content)
    appliedRef.current = `${pendingChatFile.kind}:${pendingChatFile.id}`
    consumePendingChatFile()
    const t = setTimeout(() => {
      focusBlockInput?.()
    }, 100)
    return () => clearTimeout(t)
  }, [pendingChatFile, setMarkdownContent, consumePendingChatFile, focusBlockInput])

  useEffect(() => {
    if (!pendingChatFile) appliedRef.current = null
  }, [pendingChatFile])

  return null
}
