/**
 * 富文本输入：contenteditable + 内联命令块/引用块（chip），类似 AI IDE
 * 序列化规则：文本直接输出，chip 用 data-markdown 输出
 */
import { memo, useCallback, useEffect, useRef } from 'react'

import { useClientSettings } from '../../../context/ClientSettingsContext'
import { useChatInputStore, useStoreApi } from '../store'

const CHIP_CLASS = 'chat-input-chip'
const DATA_MARKDOWN = 'data-markdown'

function getSerializedMarkdown(root: HTMLElement): string {
  let out = ''
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? ''
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    if (el.classList.contains(CHIP_CLASS)) {
      out += el.getAttribute(DATA_MARKDOWN) ?? ''
      return
    }
    for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]!)
  }
  walk(root)
  return out
}

function findRangeBySerializedOffsets(
  root: HTMLElement,
  startOffset: number,
  endOffset: number
): Range | null {
  let current = 0
  let startNode: Node | null = null
  let startOff = 0
  let endNode: Node | null = null
  let endOff = 0

  const walk = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? '').length
      if (current + len > startOffset && startNode === null) {
        startNode = node
        startOff = startOffset - current
      }
      if (current + len >= endOffset && endNode === null) {
        endNode = node
        endOff = endOffset - current
        return true
      }
      current += len
      return false
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false
    const el = node as HTMLElement
    if (el.classList.contains(CHIP_CLASS)) {
      const len = (el.getAttribute(DATA_MARKDOWN) ?? '').length
      if (current + len > startOffset && startNode === null) {
        startNode = node
        startOff = 0
      }
      if (current + len >= endOffset && endNode === null) {
        endNode = node
        endOff = node.childNodes.length
        return true
      }
      current += len
      return false
    }
    for (let i = 0; i < node.childNodes.length; i++) {
      if (walk(node.childNodes[i]!)) return true
    }
    return false
  }
  walk(root)
  if (!startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, startOff)
  range.setEnd(endNode, endOff)
  return range
}

function createChipSpan(markdown: string, label: string, type: 'command' | 'ref'): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = CHIP_CLASS
  span.setAttribute(DATA_MARKDOWN, markdown)
  span.setAttribute('data-type', type)
  span.contentEditable = 'false'
  span.textContent = label
  span.style.display = 'inline-block'
  span.style.margin = '0 2px'
  span.style.padding = '2px 6px'
  span.style.borderRadius = '4px'
  span.style.background = 'var(--ant-color-fill-quaternary, #f0f0f0)'
  span.style.color = 'var(--ant-color-primary, #1677ff)'
  span.style.fontSize = '12px'
  span.style.verticalAlign = 'middle'
  return span
}

const BlockInput = memo(() => {
  const rootRef = useRef<HTMLDivElement>(null)
  const storeApi = useStoreApi()
  const setMarkdownContent = useChatInputStore((s) => s.setMarkdownContent)
  const markdownContent = useChatInputStore((s) => s.markdownContent)
  const handleSendButton = useChatInputStore((s) => s.handleSendButton)
  const overlayKeyHandler = useChatInputStore((s) => s.overlayKeyHandler)
  const { sendWithEnter } = useClientSettings()
  const lastSerializedRef = useRef('')

  const syncToStore = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const serialized = getSerializedMarkdown(root)
    root.setAttribute('data-empty', serialized === '' ? 'true' : 'false')
    if (serialized === lastSerializedRef.current) return
    lastSerializedRef.current = serialized
    setMarkdownContent(serialized)
  }, [setMarkdownContent])

  const applyReplacement = useCallback(
    (replaceStart: number, replaceEnd: number, replacementMarkdown: string, chipLabel: string) => {
      const root = rootRef.current
      if (!root) return
      const type = replacementMarkdown.startsWith('@') ? 'ref' : 'command'
      const range = findRangeBySerializedOffsets(root, replaceStart, replaceEnd)
      if (!range) return
      range.deleteContents()
      const chip = createChipSpan(replacementMarkdown, chipLabel, type)
      range.insertNode(chip)
      lastSerializedRef.current = getSerializedMarkdown(root)
      setMarkdownContent(lastSerializedRef.current)
      root.focus()
      const sel = window.getSelection()
      if (sel) {
        sel.removeAllRanges()
        const r = document.createRange()
        r.setStartAfter(chip)
        r.collapse(true)
        sel.addRange(r)
      }
    },
    [setMarkdownContent]
  )

  useEffect(() => {
    storeApi.getState().setApplyOverlayReplacement(applyReplacement)
    return () => {
      storeApi.getState().setApplyOverlayReplacement(null)
    }
  }, [storeApi, applyReplacement])

  useEffect(() => {
    const focus = () => rootRef.current?.focus()
    storeApi.getState().setFocusBlockInput(focus)
    return () => storeApi.getState().setFocusBlockInput(null)
  }, [storeApi])

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  useEffect(() => {
    if (markdownContent !== '' || !rootRef.current) return
    const root = rootRef.current
    if (getSerializedMarkdown(root) === '') return
    root.innerHTML = '<br>'
    root.setAttribute('data-empty', 'true')
    lastSerializedRef.current = ''
  }, [markdownContent])

  const handleInput = useCallback(() => {
    syncToStore()
  }, [syncToStore])

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault()
      const text = e.clipboardData.getData('text/plain')
      document.execCommand('insertText', false, text)
      syncToStore()
    },
    [syncToStore]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter' || overlayKeyHandler) return
      const isCtrl = e.ctrlKey || e.metaKey
      if (sendWithEnter) {
        if (!e.shiftKey) {
          e.preventDefault()
          handleSendButton()
        }
      } else {
        if (isCtrl) {
          e.preventDefault()
          handleSendButton()
        }
      }
    },
    [overlayKeyHandler, handleSendButton, sendWithEnter]
  )

  return (
    <div
      ref={rootRef}
      contentEditable
      suppressContentEditableWarning
      className="block-input-editor"
      role="textbox"
      aria-label="输入消息"
      data-placeholder="输入 @ 引用，/ 命令"
      onInput={handleInput}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
      style={{
        minHeight: 46,
        padding: '8px 12px',
        outline: 'none',
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap'
      }}
    />
  )
})

BlockInput.displayName = 'BlockInput'

export default BlockInput
