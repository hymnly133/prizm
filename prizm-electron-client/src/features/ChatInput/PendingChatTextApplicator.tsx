import { useEffect, useRef } from 'react'
import { useChatWithFile } from '../../context/ChatWithFileContext'
import { useChatInputStore } from './store'

export function PendingChatTextApplicator() {
  const { pendingChatText, setPendingChatText } = useChatWithFile()
  const setMarkdownContent = useChatInputStore((s) => s.setMarkdownContent)
  const focusBlockInput = useChatInputStore((s) => s.focusBlockInput)
  const appliedRef = useRef(false)

  useEffect(() => {
    if (pendingChatText === null || pendingChatText === '' || appliedRef.current) return
    setMarkdownContent(pendingChatText)
    appliedRef.current = true
    setPendingChatText(null)
    const t = setTimeout(() => {
      focusBlockInput?.()
    }, 100)
    return () => clearTimeout(t)
  }, [pendingChatText, setMarkdownContent, setPendingChatText, focusBlockInput])

  useEffect(() => {
    if (pendingChatText === null) appliedRef.current = false
  }, [pendingChatText])

  return null
}
