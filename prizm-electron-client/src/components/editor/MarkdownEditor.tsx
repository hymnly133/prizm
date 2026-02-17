/**
 * MarkdownEditor - 基于 CodeMirror 6 的 Markdown 编辑器核心组件
 * 对齐 Obsidian 的 Source / Live Preview / Split 三种编辑模式
 * 支持快捷键：Ctrl+B/I/K/Shift+X/`/Shift+K/L + 响应式暗色主题
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { keymap } from '@codemirror/view'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { createLivePreviewExtension } from './LivePreviewExtension'

export type EditorMode = 'source' | 'livePreview' | 'split'

export interface MarkdownEditorProps {
  value: string
  onChange?: (value: string) => void
  mode?: EditorMode
  readOnly?: boolean
  onSave?: () => void
  placeholder?: string
  className?: string
  /** 暴露 CM6 editor view ref 给外部（用于大纲跳转等） */
  editorRef?: React.MutableRefObject<ReactCodeMirrorRef | null>
}

/** 响应式暗色模式检测（MutationObserver 监听 data-theme 变化） */
function useDarkMode(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') return false
    return (
      document.documentElement.getAttribute('data-theme') === 'dark' ||
      document.documentElement.classList.contains('dark') ||
      window.matchMedia?.('(prefers-color-scheme: dark)').matches
    )
  })

  useEffect(() => {
    const el = document.documentElement
    const check = () =>
      el.getAttribute('data-theme') === 'dark' ||
      el.classList.contains('dark') ||
      window.matchMedia?.('(prefers-color-scheme: dark)').matches

    const observer = new MutationObserver(() => setIsDark(check()))
    observer.observe(el, { attributes: true, attributeFilter: ['data-theme', 'class'] })

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const mqListener = () => setIsDark(check())
    mq.addEventListener('change', mqListener)

    return () => {
      observer.disconnect()
      mq.removeEventListener('change', mqListener)
    }
  }, [])

  return isDark
}

/** 在选区周围插入包裹标记（如加粗 **text**） */
function wrapSelection(view: EditorView, before: string, after: string): boolean {
  const { from, to } = view.state.selection.main
  const selectedText = view.state.sliceDoc(from, to)
  view.dispatch({
    changes: { from, to, insert: `${before}${selectedText}${after}` },
    selection: {
      anchor: from + before.length,
      head: from + before.length + selectedText.length
    }
  })
  view.focus()
  return true
}

/** 在行首插入前缀 */
function insertLinePrefix(view: EditorView, prefix: string): boolean {
  const { from } = view.state.selection.main
  const line = view.state.doc.lineAt(from)
  view.dispatch({
    changes: { from: line.from, insert: prefix }
  })
  view.focus()
  return true
}

export default function MarkdownEditor({
  value,
  onChange,
  mode = 'source',
  readOnly = false,
  onSave,
  placeholder = '开始编写...',
  className,
  editorRef: externalRef
}: MarkdownEditorProps) {
  const innerRef = useRef<ReactCodeMirrorRef>(null)
  const isDark = useDarkMode()

  useEffect(() => {
    if (externalRef) {
      externalRef.current = innerRef.current
    }
  }, [externalRef])

  const handleChange = useCallback(
    (val: string) => {
      onChange?.(val)
    },
    [onChange]
  )

  const extensions = useMemo(() => {
    const exts: Extension[] = [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: 'true' })
    ]

    // 快捷键集合
    const keymapBindings = [
      ...(onSave
        ? [
            {
              key: 'Mod-s',
              run: () => {
                onSave()
                return true
              }
            }
          ]
        : []),
      // Ctrl+B -> 加粗
      {
        key: 'Mod-b',
        run: (view: EditorView) => wrapSelection(view, '**', '**')
      },
      // Ctrl+I -> 斜体
      {
        key: 'Mod-i',
        run: (view: EditorView) => wrapSelection(view, '_', '_')
      },
      // Ctrl+K -> 插入链接
      {
        key: 'Mod-k',
        run: (view: EditorView) => wrapSelection(view, '[', '](url)')
      },
      // Ctrl+Shift+X -> 删除线
      {
        key: 'Mod-Shift-x',
        run: (view: EditorView) => wrapSelection(view, '~~', '~~')
      },
      // Ctrl+` -> 行内代码
      {
        key: 'Mod-`',
        run: (view: EditorView) => wrapSelection(view, '`', '`')
      },
      // Ctrl+Shift+K -> 代码块
      {
        key: 'Mod-Shift-k',
        run: (view: EditorView) => wrapSelection(view, '\n```\n', '\n```\n')
      },
      // Ctrl+L -> 任务列表
      {
        key: 'Mod-l',
        run: (view: EditorView) => insertLinePrefix(view, '- [ ] ')
      }
    ]
    exts.push(keymap.of(keymapBindings))

    if (mode === 'livePreview') {
      exts.push(createLivePreviewExtension())
    }

    return exts
  }, [mode, onSave])

  const theme = isDark ? oneDark : undefined

  return (
    <div className={`prizm-md-editor ${className ?? ''}`}>
      <CodeMirror
        ref={innerRef}
        value={value}
        onChange={handleChange}
        extensions={extensions}
        theme={theme}
        readOnly={readOnly}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: mode === 'source',
          foldGutter: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          indentOnInput: true
        }}
        style={{ fontSize: 14, height: '100%' }}
      />
    </div>
  )
}
