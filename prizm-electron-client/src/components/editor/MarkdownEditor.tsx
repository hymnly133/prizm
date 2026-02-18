/**
 * MarkdownEditor - 基于 CodeMirror 6 的 Markdown 编辑器核心组件
 * 支持四种模式：live (Live Preview) / source / preview / split
 * 快捷键：Ctrl+B/I/K/Shift+X/`/Shift+K/L
 * 集成 FloatingToolbar（选中文本弹出格式化工具栏）
 * 集成 LivePreviewExtension（Obsidian 风格 Live Preview）
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { foldGutter } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { keymap, EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { useTheme } from 'antd-style'
import {
  useCodeMirrorTheme,
  buildColoredHighlight,
  LIGHT_PALETTE,
  DARK_PALETTE
} from '../../hooks/useCodeMirrorTheme'
import { createLivePreviewExtension } from './LivePreviewExtension'
import { createFloatingToolbar } from './FloatingToolbar'

export type EditorMode = 'live' | 'source' | 'preview' | 'split'

export interface MarkdownEditorProps {
  value: string
  onChange?: (value: string) => void
  mode?: EditorMode
  readOnly?: boolean
  onSave?: () => void
  placeholder?: string
  className?: string
  editorRef?: React.MutableRefObject<ReactCodeMirrorRef | null>
}

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
  mode = 'live',
  readOnly = false,
  onSave,
  placeholder = '开始编写...',
  className,
  editorRef: externalRef
}: MarkdownEditorProps) {
  const innerRef = useRef<ReactCodeMirrorRef>(null)
  const antTheme = useTheme()
  const cmTheme = useCodeMirrorTheme()

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

  const syntaxHL = useMemo(() => {
    if (mode !== 'source') return null
    return buildColoredHighlight(antTheme.isDarkMode ? DARK_PALETTE : LIGHT_PALETTE)
  }, [mode, antTheme.isDarkMode])

  const extensions = useMemo(() => {
    const exts: Extension[] = [
      cmTheme,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: 'true' }),
      foldGutter({
        openText: '\u25BE',
        closedText: '\u25B8'
      })
    ]

    if (syntaxHL) {
      exts.push(syntaxHL)
    }

    if (mode === 'live') {
      exts.push(...createLivePreviewExtension())
    }

    exts.push(...createFloatingToolbar())

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
      { key: 'Mod-b', run: (view: EditorView) => wrapSelection(view, '**', '**') },
      { key: 'Mod-i', run: (view: EditorView) => wrapSelection(view, '_', '_') },
      { key: 'Mod-k', run: (view: EditorView) => wrapSelection(view, '[', '](url)') },
      { key: 'Mod-Shift-x', run: (view: EditorView) => wrapSelection(view, '~~', '~~') },
      { key: 'Mod-`', run: (view: EditorView) => wrapSelection(view, '`', '`') },
      { key: 'Mod-Shift-k', run: (view: EditorView) => wrapSelection(view, '\n```\n', '\n```\n') },
      { key: 'Mod-l', run: (view: EditorView) => insertLinePrefix(view, '- [ ] ') }
    ]
    exts.push(keymap.of(keymapBindings))

    return exts
  }, [mode, onSave, cmTheme, syntaxHL])

  const editorClassName = ['prizm-md-editor', className ?? ''].filter(Boolean).join(' ')

  return (
    <div className={editorClassName}>
      <CodeMirror
        ref={innerRef}
        value={value}
        onChange={handleChange}
        extensions={extensions}
        theme="none"
        readOnly={readOnly}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          indentOnInput: true,
          syntaxHighlighting: false
        }}
        style={{ height: '100%' }}
      />
    </div>
  )
}
