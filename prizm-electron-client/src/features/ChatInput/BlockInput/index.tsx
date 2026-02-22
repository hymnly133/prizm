/**
 * BlockInput — contenteditable 输入框
 * 支持纯文本输入 + 资源引用 inline chip（`@(type:id)` 以 chip 形式显示）
 */
import { memo, useCallback, useEffect, useRef } from 'react'

import { useClientSettings } from '../../../context/ClientSettingsContext'
import { useChatInputStore, useStoreApi } from '../store'
import { REF_CHIP_META, FALLBACK_CHIP_STYLE } from '../../../utils/refChipMeta'

const CHIP_CLS = 'chat-input-chip'

function createChipElement(typeKey: string, label: string, markdown: string): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.className = CHIP_CLS
  chip.contentEditable = 'false'
  chip.dataset.markdown = markdown
  chip.dataset.refType = typeKey

  const meta = REF_CHIP_META[typeKey]
  const c = meta ?? FALLBACK_CHIP_STYLE
  chip.style.color = c.color
  chip.style.background = c.bg

  const tag = document.createElement('span')
  tag.className = 'chat-input-chip__tag'
  tag.textContent = meta?.label ?? typeKey
  chip.appendChild(tag)

  const shortLabel = label.length > 20 ? label.slice(0, 20) + '…' : label
  chip.appendChild(document.createTextNode(shortLabel))
  return chip
}

/** 获取文本内容，将 chip 元素替换为其 markdown data 属性 */
function getPlainText(root: HTMLElement): string {
  let out = ''
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? ''
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    if (el.classList.contains(CHIP_CLS)) {
      out += el.dataset.markdown ?? ''
      return
    }
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

/** 在 contentEditable 中根据序列化偏移量定位文本范围（跳过 chip 元素） */
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
    if (el.classList.contains(CHIP_CLS)) {
      const mdLen = (el.dataset.markdown ?? '').length
      if (current + mdLen > startOffset && startNode === null) {
        startNode = node.parentNode!
        startOff = Array.from(node.parentNode!.childNodes).indexOf(node as ChildNode)
      }
      current += mdLen
      if (current >= endOffset && endNode === null) {
        endNode = node.parentNode!
        endOff = Array.from(node.parentNode!.childNodes).indexOf(node as ChildNode) + 1
        return true
      }
      return false
    }
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

/** 将纯文本渲染到 DOM（保留换行，不包含 chip） */
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

  /** 在指定偏移范围插入 inline chip 元素 */
  const applyChipInsert = useCallback(
    (
      replaceStart: number,
      replaceEnd: number,
      typeKey: string,
      _id: string,
      label: string,
      mdText: string
    ) => {
      const root = rootRef.current
      if (!root) return
      const range = findTextRange(root, replaceStart, replaceEnd)
      if (!range) return
      range.deleteContents()

      const chip = createChipElement(typeKey, label, mdText)
      range.insertNode(chip)

      const spacer = document.createTextNode('\u00A0')
      chip.after(spacer)

      const sel = window.getSelection()
      if (sel) {
        sel.removeAllRanges()
        const r = document.createRange()
        r.setStartAfter(spacer)
        r.collapse(true)
        sel.addRange(r)
      }

      lastSerializedRef.current = getPlainText(root)
      setMarkdownContent(lastSerializedRef.current)
      root.focus()
    },
    [setMarkdownContent]
  )

  useEffect(() => {
    storeApi.getState().setApplyOverlayTextReplace(applyTextReplace)
    storeApi.getState().setApplyOverlayChipInsert(applyChipInsert)
    return () => {
      storeApi.getState().setApplyOverlayTextReplace(null)
      storeApi.getState().setApplyOverlayChipInsert(null)
    }
  }, [storeApi, applyTextReplace, applyChipInsert])

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
      const items = e.clipboardData?.items
      if (items) {
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile()
            if (file) {
              e.preventDefault()
              const reader = new FileReader()
              reader.onload = () => {
                const dataUrl = reader.result as string
                const comma = dataUrl.indexOf(',')
                const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : ''
                const mimeMatch = dataUrl.match(/^data:([^;]+)/)
                const mimeType = mimeMatch?.[1] ?? 'image/png'
                storeApi.getState().addPendingImage({ base64, mimeType })
              }
              reader.readAsDataURL(file)
              return
            }
          }
        }
      }
      e.preventDefault()
      const text = e.clipboardData.getData('text/plain')
      document.execCommand('insertText', false, text)
      syncToStore()
    },
    [syncToStore, storeApi]
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
