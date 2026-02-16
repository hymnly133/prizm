/**
 * 纯文本输入：contenteditable + 换行支持
 * 不再内联渲染 chip——所有引用通过 RefChipsBar 在输入框外展示
 */
import { memo, useCallback, useEffect, useRef } from 'react'

import { useClientSettings } from '../../../context/ClientSettingsContext'
import { useChatInputStore, useStoreApi } from '../store'

/** 获取纯文本内容（保留换行） */
function getPlainText(root: HTMLElement): string {
  let out = ''
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? ''
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    const tag = el.tagName
    if (tag === 'BR') {
      out += '\n'
      return
    }
    if (tag === 'DIV' || tag === 'P') {
      if (out.length > 0 && !out.endsWith('\n')) out += '\n'
    }
    for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]!)
  }
  walk(root)
  return out
}

/** 在 contentEditable 中根据序列化偏移量定位文本范围 */
function findTextRange(root: HTMLElement, startOffset: number, endOffset: number): Range | null {
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
    if (el.tagName === 'BR') {
      if (current >= startOffset && startNode === null) {
        startNode = node.parentNode!
        startOff = Array.from(node.parentNode!.childNodes).indexOf(node as ChildNode)
      }
      current += 1
      if (current >= endOffset && endNode === null) {
        endNode = node.parentNode!
        endOff = Array.from(node.parentNode!.childNodes).indexOf(node as ChildNode) + 1
        return true
      }
      return false
    }
    if (el.tagName === 'DIV' || el.tagName === 'P') {
      if (current > 0 && current >= startOffset && startNode === null) {
        startNode = node
        startOff = 0
      }
      if (current > 0) current += 1
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

/** 将纯文本渲染到 DOM（保留换行） */
function renderTextToDOM(root: HTMLElement, text: string): void {
  root.innerHTML = ''
  if (!text) {
    root.setAttribute('data-empty', 'true')
    return
  }
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (line) root.appendChild(document.createTextNode(line))
    if (i < lines.length - 1) root.appendChild(document.createElement('br'))
  })
  root.setAttribute('data-empty', 'false')
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
    const text = getPlainText(root)
    root.setAttribute('data-empty', text === '' ? 'true' : 'false')
    if (text === lastSerializedRef.current) return
    lastSerializedRef.current = text
    setMarkdownContent(text)
  }, [setMarkdownContent])

  /** 替换指定偏移范围的文本为纯文本（被 MentionSlashOverlay 使用） */
  const applyTextReplace = useCallback(
    (replaceStart: number, replaceEnd: number, text: string) => {
      const root = rootRef.current
      if (!root) return
      const range = findTextRange(root, replaceStart, replaceEnd)
      if (!range) return
      range.deleteContents()
      if (text) {
        const textNode = document.createTextNode(text)
        range.insertNode(textNode)
        const sel = window.getSelection()
        if (sel) {
          sel.removeAllRanges()
          const r = document.createRange()
          r.setStartAfter(textNode)
          r.collapse(true)
          sel.addRange(r)
        }
      }
      lastSerializedRef.current = getPlainText(root)
      setMarkdownContent(lastSerializedRef.current)
      root.focus()
    },
    [setMarkdownContent]
  )

  useEffect(() => {
    storeApi.getState().setApplyOverlayTextReplace(applyTextReplace)
    return () => {
      storeApi.getState().setApplyOverlayTextReplace(null)
    }
  }, [storeApi, applyTextReplace])

  useEffect(() => {
    const focus = () => rootRef.current?.focus()
    storeApi.getState().setFocusBlockInput(focus)
    return () => storeApi.getState().setFocusBlockInput(null)
  }, [storeApi])

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    if (markdownContent === '') {
      if (getPlainText(root) === '') return
      root.innerHTML = '<br>'
      root.setAttribute('data-empty', 'true')
      lastSerializedRef.current = ''
      return
    }

    if (markdownContent === lastSerializedRef.current) return

    renderTextToDOM(root, markdownContent)
    lastSerializedRef.current = markdownContent
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
