/**
 * FloatingToolbar - CodeMirror 6 选中文本浮动格式化工具栏
 * 选中文本时在选区上方弹出，提供快速格式化操作
 * 使用 CM6 的 showTooltip StateField 实现
 */
import { EditorView, type Tooltip, showTooltip } from '@codemirror/view'
import { StateField } from '@codemirror/state'

function wrapSelection(view: EditorView, before: string, after: string): void {
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
}

function insertLinePrefix(view: EditorView, prefix: string): void {
  const { from, to } = view.state.selection.main
  const startLine = view.state.doc.lineAt(from)
  const endLine = view.state.doc.lineAt(to)
  const changes: Array<{ from: number; insert: string }> = []
  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
    const line = view.state.doc.line(lineNum)
    changes.push({ from: line.from, insert: prefix })
  }
  view.dispatch({ changes })
  view.focus()
}

interface ToolbarAction {
  label: string
  icon: string
  hotkey?: string
  run: (view: EditorView) => void
}

const ACTIONS: ToolbarAction[] = [
  { label: '加粗', icon: 'B', hotkey: 'Ctrl+B', run: (v) => wrapSelection(v, '**', '**') },
  { label: '斜体', icon: 'I', hotkey: 'Ctrl+I', run: (v) => wrapSelection(v, '_', '_') },
  { label: '删除线', icon: 'S', hotkey: 'Ctrl+Shift+X', run: (v) => wrapSelection(v, '~~', '~~') },
  { label: '代码', icon: '`', hotkey: 'Ctrl+`', run: (v) => wrapSelection(v, '`', '`') },
  { label: '链接', icon: '🔗', hotkey: 'Ctrl+K', run: (v) => wrapSelection(v, '[', '](url)') },
  { label: 'H1', icon: 'H1', run: (v) => insertLinePrefix(v, '# ') },
  { label: 'H2', icon: 'H2', run: (v) => insertLinePrefix(v, '## ') },
  { label: 'H3', icon: 'H3', run: (v) => insertLinePrefix(v, '### ') },
  { label: '引用', icon: '❝', run: (v) => insertLinePrefix(v, '> ') },
  { label: '代码块', icon: '{ }', hotkey: 'Ctrl+Shift+K', run: (v) => wrapSelection(v, '\n```\n', '\n```\n') }
]

function createToolbarDOM(view: EditorView): HTMLElement {
  const container = document.createElement('div')
  container.className = 'cm-floating-toolbar'

  for (const action of ACTIONS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'cm-floating-toolbar-btn'
    btn.title = action.hotkey ? `${action.label} (${action.hotkey})` : action.label
    btn.textContent = action.icon

    if (action.icon === 'B') btn.style.fontWeight = '700'
    if (action.icon === 'I') btn.style.fontStyle = 'italic'
    if (action.icon === 'S') btn.style.textDecoration = 'line-through'

    btn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      action.run(view)
    })
    container.appendChild(btn)
  }

  return container
}

const floatingToolbarField = StateField.define<readonly Tooltip[]>({
  create: () => [],

  update(tooltips, tr) {
    if (!tr.selection) return tooltips

    const sel = tr.state.selection.main
    if (sel.empty) return []

    const selText = tr.state.sliceDoc(sel.from, sel.to)
    if (selText.length < 1 || selText.length > 5000) return []

    return [
      {
        pos: sel.from,
        above: true,
        strictSide: true,
        arrow: false,
        create: (view: EditorView) => {
          const dom = createToolbarDOM(view)
          return { dom, offset: { x: 0, y: 4 } }
        }
      }
    ]
  },

  provide: (f) => showTooltip.computeN([f], (state) => state.field(f))
})

const floatingToolbarTheme = EditorView.baseTheme({
  '.cm-tooltip.cm-tooltip-above .cm-floating-toolbar': {
    display: 'flex',
    alignItems: 'center',
    gap: '1px',
    padding: '3px',
    borderRadius: '8px',
    background: 'var(--ant-color-bg-elevated, #fff)',
    boxShadow: '0 2px 12px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
    zIndex: '100',
    animation: 'cm-ft-fadein 0.12s ease-out'
  },
  '.cm-floating-toolbar-btn': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    border: 'none',
    borderRadius: '5px',
    background: 'transparent',
    color: 'var(--ant-color-text, #333)',
    fontSize: '12px',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    cursor: 'pointer',
    transition: 'background 0.1s, color 0.1s',
    lineHeight: '1'
  },
  '.cm-floating-toolbar-btn:hover': {
    background: 'var(--ant-color-primary-bg, #e6f4ff)',
    color: 'var(--ant-color-primary, #1677ff)'
  },
  '@keyframes cm-ft-fadein': {
    from: { opacity: '0', transform: 'translateY(4px)' },
    to: { opacity: '1', transform: 'translateY(0)' }
  }
})

export function createFloatingToolbar() {
  return [floatingToolbarField, floatingToolbarTheme]
}
