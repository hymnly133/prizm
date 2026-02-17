/**
 * EditorToolbar - Markdown 编辑器工具栏
 * 模式切换、格式化、撤销重做、字数统计
 * 快捷键提示使用 @lobehub/ui Hotkey 组件
 */
import { useMemo } from 'react'
import { Flexbox, Hotkey } from '@lobehub/ui'
import { Segmented, Tooltip, Divider } from 'antd'
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  Code,
  Link,
  List,
  ListOrdered,
  Quote,
  Minus,
  Image,
  CheckSquare,
  Undo2,
  Redo2,
  Eye,
  Code2,
  Columns2
} from 'lucide-react'
import { undo, redo } from '@codemirror/commands'
import type { EditorMode } from './MarkdownEditor'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'

interface EditorToolbarProps {
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
  editorRef: React.MutableRefObject<ReactCodeMirrorRef | null>
  wordCount?: number
  charCount?: number
  readOnly?: boolean
}

interface ToolbarAction {
  icon: React.ElementType
  label: string
  before: string
  after: string
  /** 快捷键（Hotkey 格式） */
  hotkey?: string
}

const FORMAT_ACTIONS: ToolbarAction[] = [
  { icon: Bold, label: '加粗', before: '**', after: '**', hotkey: 'mod+b' },
  { icon: Italic, label: '斜体', before: '_', after: '_', hotkey: 'mod+i' },
  { icon: Strikethrough, label: '删除线', before: '~~', after: '~~', hotkey: 'mod+shift+x' },
  { icon: Code, label: '行内代码', before: '`', after: '`', hotkey: 'mod+`' }
]

const HEADING_ACTIONS: ToolbarAction[] = [
  { icon: Heading1, label: '一级标题', before: '# ', after: '' },
  { icon: Heading2, label: '二级标题', before: '## ', after: '' },
  { icon: Heading3, label: '三级标题', before: '### ', after: '' }
]

const BLOCK_ACTIONS: ToolbarAction[] = [
  { icon: List, label: '无序列表', before: '- ', after: '' },
  { icon: ListOrdered, label: '有序列表', before: '1. ', after: '' },
  { icon: CheckSquare, label: '任务列表', before: '- [ ] ', after: '', hotkey: 'mod+l' },
  { icon: Quote, label: '引用', before: '> ', after: '' },
  { icon: Minus, label: '分割线', before: '\n---\n', after: '' },
  { icon: Code2, label: '代码块', before: '\n```\n', after: '\n```\n', hotkey: 'mod+shift+k' },
  { icon: Link, label: '链接', before: '[', after: '](url)', hotkey: 'mod+k' },
  { icon: Image, label: '图片', before: '![', after: '](url)' }
]

function insertFormatting(
  editorRef: React.MutableRefObject<ReactCodeMirrorRef | null>,
  before: string,
  after: string
): void {
  const view = editorRef.current?.view
  if (!view) return

  const { from, to } = view.state.selection.main
  const selectedText = view.state.sliceDoc(from, to)

  const isLinePrefix =
    after === '' &&
    (before.startsWith('#') ||
      before.startsWith('-') ||
      before.startsWith('>') ||
      before.startsWith('1.'))

  if (isLinePrefix) {
    // 多行选区：遍历所有选中行
    const startLine = view.state.doc.lineAt(from)
    const endLine = view.state.doc.lineAt(to)
    const changes: Array<{ from: number; insert: string }> = []
    for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
      const line = view.state.doc.line(lineNum)
      changes.push({ from: line.from, insert: before })
    }
    view.dispatch({ changes })
  } else {
    view.dispatch({
      changes: { from, to, insert: `${before}${selectedText}${after}` },
      selection: {
        anchor: from + before.length,
        head: from + before.length + selectedText.length
      }
    })
  }
  view.focus()
}

function ToolButton({
  icon: Icon,
  label,
  hotkey,
  onClick,
  disabled
}: {
  icon: React.ElementType
  label: string
  hotkey?: string
  onClick: () => void
  disabled?: boolean
}) {
  const tooltipContent = hotkey ? (
    <Flexbox horizontal align="center" gap={6}>
      <span>{label}</span>
      <Hotkey keys={hotkey} compact style={{ opacity: 0.7 }} />
    </Flexbox>
  ) : (
    label
  )

  return (
    <Tooltip title={tooltipContent} placement="bottom">
      <button
        className="editor-toolbar-btn"
        onClick={onClick}
        disabled={disabled}
        type="button"
        aria-label={label}
      >
        <Icon size={15} />
      </button>
    </Tooltip>
  )
}

export default function EditorToolbar({
  mode,
  onModeChange,
  editorRef,
  wordCount = 0,
  charCount = 0,
  readOnly = false
}: EditorToolbarProps) {
  const modeOptions = useMemo(
    () => [
      {
        label: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Code2 size={13} /> 源码
          </span>
        ),
        value: 'source' as EditorMode
      },
      {
        label: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Eye size={13} /> 预览
          </span>
        ),
        value: 'livePreview' as EditorMode
      },
      {
        label: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Columns2 size={13} /> 分栏
          </span>
        ),
        value: 'split' as EditorMode
      }
    ],
    []
  )

  const handleUndo = () => {
    const view = editorRef.current?.view
    if (!view) return
    undo(view)
  }

  const handleRedo = () => {
    const view = editorRef.current?.view
    if (!view) return
    redo(view)
  }

  return (
    <Flexbox
      className="editor-toolbar"
      horizontal
      align="center"
      gap={2}
      style={{
        padding: '4px 8px',
        borderBottom: '1px solid var(--ant-color-border-secondary)',
        flexWrap: 'wrap',
        minHeight: 36
      }}
    >
      <Segmented
        size="small"
        value={mode}
        onChange={(v) => onModeChange(v as EditorMode)}
        options={modeOptions}
      />

      <Divider type="vertical" style={{ margin: '0 4px' }} />

      {FORMAT_ACTIONS.map((action) => (
        <ToolButton
          key={action.label}
          icon={action.icon}
          label={action.label}
          hotkey={action.hotkey}
          disabled={readOnly}
          onClick={() => insertFormatting(editorRef, action.before, action.after)}
        />
      ))}

      <Divider type="vertical" style={{ margin: '0 4px' }} />

      {HEADING_ACTIONS.map((action) => (
        <ToolButton
          key={action.label}
          icon={action.icon}
          label={action.label}
          hotkey={action.hotkey}
          disabled={readOnly}
          onClick={() => insertFormatting(editorRef, action.before, action.after)}
        />
      ))}

      <Divider type="vertical" style={{ margin: '0 4px' }} />

      {BLOCK_ACTIONS.map((action) => (
        <ToolButton
          key={action.label}
          icon={action.icon}
          label={action.label}
          hotkey={action.hotkey}
          disabled={readOnly}
          onClick={() => insertFormatting(editorRef, action.before, action.after)}
        />
      ))}

      <Divider type="vertical" style={{ margin: '0 4px' }} />

      <ToolButton
        icon={Undo2}
        label="撤销"
        hotkey="mod+z"
        onClick={handleUndo}
        disabled={readOnly}
      />
      <ToolButton
        icon={Redo2}
        label="重做"
        hotkey="mod+shift+z"
        onClick={handleRedo}
        disabled={readOnly}
      />

      <div style={{ flex: 1 }} />

      <span className="editor-toolbar-stats">
        {charCount} 字符 · {wordCount} 词
      </span>
    </Flexbox>
  )
}
