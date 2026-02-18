/**
 * CodeViewerPanel — 类 IDE 只读文件查看器
 * 基于 CodeMirror 6，支持语法高亮、行号、选区追踪。
 * 用户选中文本后可通过 Ctrl+L 将选区作为 snippet 引用注入聊天输入。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { keymap } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import type { Extension } from '@codemirror/state'
import { ActionIcon, Flexbox, Tag } from '@lobehub/ui'
import { X, Code2, MessageSquarePlus } from 'lucide-react'
import type { Document as PrizmDocument } from '@prizm/client-core'
import { usePrizmContext } from '../../context/PrizmContext'
import { useSelectionRef } from '../../context/SelectionRefContext'
import { useCodeMirrorTheme } from '../../hooks/useCodeMirrorTheme'
import { useChatInputStore } from '../../features/ChatInput/store'
import type { InputRef } from '../../features/ChatInput/store/initialState'
import type { FileKind } from '../../hooks/useFileList'

/** 文件扩展名 → 语言标识 */
const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
  py: 'python',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  sh: 'shell',
  bash: 'shell',
  sql: 'sql',
  xml: 'xml',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp'
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANG_MAP[ext] ?? ''
}

function getFileNameFromPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || filePath
}

/** 构建 snippet InputRef */
function buildSnippetRef(
  text: string,
  filePath: string,
  startLine?: number,
  endLine?: number,
  language?: string
): InputRef {
  const fileName = getFileNameFromPath(filePath)
  const lineRange =
    startLine != null && endLine != null
      ? startLine === endLine
        ? `:${startLine}`
        : `:${startLine}-${endLine}`
      : ''
  const lang = language || ''
  return {
    type: 'snippet',
    key: `snippet:${filePath}#${Date.now()}`,
    label: `${fileName}${lineRange}`,
    markdown: `Selected from \`${filePath}\`${
      lineRange ? ` (lines ${lineRange.slice(1)})` : ''
    }:\n\`\`\`${lang}\n${text}\n\`\`\``
  }
}

export interface CodeViewerPanelProps {
  fileRef: { kind: FileKind; id: string }
  scope: string
  onClose: () => void
}

export const CodeViewerPanel = memo<CodeViewerPanelProps>(({ fileRef, scope, onClose }) => {
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient()
  const { setSelection } = useSelectionRef()
  const addInputRef = useChatInputStore((s) => s.addInputRef)
  const cmTheme = useCodeMirrorTheme()
  const cmRef = useRef<ReactCodeMirrorRef>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')

  const filePath = fileRef.id
  const language = useMemo(() => detectLanguage(filePath), [filePath])

  // 当前选区状态（用于 UI 提示）
  const [hasSelection, setHasSelection] = useState(false)
  const selectionRef = useRef<{
    text: string
    startLine: number
    endLine: number
  } | null>(null)

  // 加载文件内容
  useEffect(() => {
    if (!http) return
    setLoading(true)
    setError(null)

    const fetchContent = async () => {
      try {
        if (fileRef.kind === 'document' || fileRef.kind === 'note') {
          const doc = await http.getDocument(fileRef.id, scope)
          const d = doc as PrizmDocument
          setTitle(d.title || getFileNameFromPath(fileRef.id))
          setContent(d.content ?? '')
        } else {
          // 通用文件读取
          const result = await http.fileRead(fileRef.id, scope)
          setTitle(getFileNameFromPath(fileRef.id))
          setContent(result.content ?? '')
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        setLoading(false)
      }
    }
    void fetchContent()
  }, [http, fileRef.kind, fileRef.id, scope])

  // 清除选区（组件卸载时）
  useEffect(() => {
    return () => {
      setSelection(null)
    }
  }, [setSelection])

  /** 将当前选区添加为 snippet 引用 */
  const addCurrentSelectionToChat = useCallback(() => {
    const sel = selectionRef.current
    if (!sel || !sel.text.trim()) return
    const ref = buildSnippetRef(sel.text, filePath, sel.startLine, sel.endLine, language)
    addInputRef(ref)
  }, [filePath, language, addInputRef])

  /** CodeMirror 扩展：选区监听 + Ctrl+L 快捷键 */
  const extensions = useMemo(() => {
    const exts: Extension[] = [
      cmTheme,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: 'false' }),
      // 选区变化监听
      EditorView.updateListener.of((update) => {
        if (update.selectionSet) {
          const { from, to } = update.state.selection.main
          if (from !== to) {
            const text = update.state.sliceDoc(from, to)
            const startLine = update.state.doc.lineAt(from).number
            const endLine = update.state.doc.lineAt(to).number
            selectionRef.current = { text, startLine, endLine }
            setHasSelection(true)
            setSelection({
              source: 'file-viewer',
              text,
              filePath,
              startLine,
              endLine,
              language
            })
          } else {
            selectionRef.current = null
            setHasSelection(false)
            setSelection(null)
          }
        }
      })
    ]

    // Ctrl+L 快捷键：将选区作为 snippet 引用
    exts.push(
      keymap.of([
        {
          key: 'Mod-l',
          run: (view) => {
            const { from, to } = view.state.selection.main
            if (from === to) return false
            const text = view.state.sliceDoc(from, to)
            const startLine = view.state.doc.lineAt(from).number
            const endLine = view.state.doc.lineAt(to).number
            const ref = buildSnippetRef(text, filePath, startLine, endLine, language)
            addInputRef(ref)
            return true
          }
        }
      ])
    )

    // 语言扩展
    if (language === 'markdown') {
      exts.push(markdown({ base: markdownLanguage, codeLanguages: languages }))
    }
    // 对于其他语言，依靠 @codemirror/language-data 自动检测（通过 markdown 的 codeLanguages 机制）
    // 如果不是 markdown，可以通过 LanguageDescription.matchFilename 动态加载

    return exts
  }, [filePath, language, setSelection, addInputRef, cmTheme])

  return (
    <div className="code-viewer-panel">
      {/* 头部 */}
      <div className="code-viewer-panel__header">
        <Flexbox horizontal align="center" gap={8} flex={1} style={{ minWidth: 0 }}>
          <Code2 size={14} style={{ flexShrink: 0, color: 'var(--ant-color-primary)' }} />
          <span className="code-viewer-panel__title" title={filePath}>
            {title || getFileNameFromPath(filePath)}
          </span>
          {language && (
            <Tag size="small" style={{ flexShrink: 0 }}>
              {language}
            </Tag>
          )}
        </Flexbox>
        <Flexbox horizontal align="center" gap={2}>
          {hasSelection && (
            <ActionIcon
              icon={MessageSquarePlus}
              size="small"
              title="引用选区到聊天 (Ctrl+L)"
              onClick={addCurrentSelectionToChat}
              style={{ color: 'var(--prizm-snippet-color, #722ed1)' }}
            />
          )}
          <ActionIcon icon={X} size="small" title="关闭" onClick={onClose} />
        </Flexbox>
      </div>

      {/* 内容区 */}
      <div className="code-viewer-panel__body">
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', opacity: 0.5 }}>加载中…</div>
        ) : error ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ant-color-error)' }}>
            {error}
          </div>
        ) : (
          <CodeMirror
            ref={cmRef}
            value={content}
            extensions={extensions}
            theme="none"
            readOnly
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              bracketMatching: true,
              closeBrackets: false,
              autocompletion: false,
              highlightActiveLine: true,
              highlightSelectionMatches: true,
              indentOnInput: false
            }}
            style={{ height: '100%' }}
          />
        )}
      </div>

      {/* 底栏提示 */}
      {hasSelection && (
        <div className="code-viewer-panel__hint">
          <kbd>Ctrl+L</kbd> 引用选区到聊天
        </div>
      )}
    </div>
  )
})

CodeViewerPanel.displayName = 'CodeViewerPanel'
