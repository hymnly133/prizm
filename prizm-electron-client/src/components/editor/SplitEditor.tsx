/**
 * SplitEditor - 分栏编辑模式
 * 左侧 CodeMirror 源码编辑，右侧 Markdown 实时渲染预览
 * 支持可拖拽调整比例 + 滚动同步 + 比例持久化
 */
import type { ReactNode } from 'react'
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Markdown } from '@lobehub/ui'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import MarkdownEditor from './MarkdownEditor'

interface SplitEditorProps {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  onSave?: () => void
  editorRef?: React.MutableRefObject<ReactCodeMirrorRef | null>
  header?: React.ReactNode
}

const MIN_SPLIT = 0.25
const MAX_SPLIT = 0.75
const SPLIT_RATIO_KEY = 'prizm-split-ratio'

function loadSplitRatio(): number {
  try {
    const stored = localStorage.getItem(SPLIT_RATIO_KEY)
    if (stored) {
      const val = parseFloat(stored)
      if (val >= MIN_SPLIT && val <= MAX_SPLIT) return val
    }
  } catch {
    // ignore
  }
  return 0.5
}

function saveSplitRatio(ratio: number): void {
  try {
    localStorage.setItem(SPLIT_RATIO_KEY, String(ratio))
  } catch {
    // ignore
  }
}

export default function SplitEditor({
  value,
  onChange,
  readOnly = false,
  onSave,
  editorRef,
  header
}: SplitEditorProps) {
  const [splitRatio, setSplitRatio] = useState(loadSplitRatio)
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const scrollLockRef = useRef(false)

  /** debounce 预览内容，300ms 延迟 */
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), 300)
    return () => clearTimeout(timer)
  }, [value])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const ratio = (e.clientX - rect.left) / rect.width
      const clamped = Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, ratio))
      setSplitRatio(clamped)
    }

    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        saveSplitRatio(splitRatio)
      }
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, splitRatio])

  /** 滚动同步：编辑器 -> 预览 */
  useEffect(() => {
    const view = editorRef?.current?.view
    if (!view || !previewRef.current) return

    const editorScroller = view.scrollDOM
    const preview = previewRef.current

    const syncEditorToPreview = () => {
      if (scrollLockRef.current) return
      scrollLockRef.current = true
      requestAnimationFrame(() => {
        const scrollRatio =
          editorScroller.scrollTop /
          Math.max(1, editorScroller.scrollHeight - editorScroller.clientHeight)
        preview.scrollTop = scrollRatio * (preview.scrollHeight - preview.clientHeight)
        setTimeout(() => {
          scrollLockRef.current = false
        }, 50)
      })
    }

    const syncPreviewToEditor = () => {
      if (scrollLockRef.current) return
      scrollLockRef.current = true
      requestAnimationFrame(() => {
        const scrollRatio =
          preview.scrollTop / Math.max(1, preview.scrollHeight - preview.clientHeight)
        editorScroller.scrollTop =
          scrollRatio * (editorScroller.scrollHeight - editorScroller.clientHeight)
        setTimeout(() => {
          scrollLockRef.current = false
        }, 50)
      })
    }

    editorScroller.addEventListener('scroll', syncEditorToPreview)
    preview.addEventListener('scroll', syncPreviewToEditor)
    return () => {
      editorScroller.removeEventListener('scroll', syncEditorToPreview)
      preview.removeEventListener('scroll', syncPreviewToEditor)
    }
  }, [editorRef])

  const previewContent = useMemo(() => debouncedValue || ' ', [debouncedValue])

  return (
    <div
      ref={containerRef}
      className="split-editor"
      style={{ display: 'flex', height: '100%', overflow: 'hidden' }}
    >
      {/* 左侧编辑器 */}
      <div
        className="split-editor-left"
        style={{
          width: `${splitRatio * 100}%`,
          height: '100%',
          overflow: 'auto',
          minWidth: 0
        }}
      >
        {header}
        <MarkdownEditor
          value={value}
          onChange={onChange}
          mode="source"
          readOnly={readOnly}
          onSave={onSave}
          editorRef={editorRef}
        />
      </div>

      {/* 拖拽分割线 */}
      <div
        className={`split-editor-gutter${isDragging ? ' split-editor-gutter--dragging' : ''}`}
        onMouseDown={handleMouseDown}
      />

      {/* 右侧预览 */}
      <div
        ref={previewRef}
        className="split-editor-right"
        style={{
          width: `${(1 - splitRatio) * 100}%`,
          height: '100%',
          overflow: 'auto',
          padding: '16px 24px',
          minWidth: 0
        }}
      >
        <Markdown>{previewContent}</Markdown>
      </div>
    </div>
  )
}
