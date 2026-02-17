/**
 * LivePreviewExtension - CodeMirror 6 Obsidian 风格 Live Preview
 *
 * 基于 CM6 Decoration API 实现：
 * - 非光标行隐藏 Markdown 语法标记（如 **、#、[]() 等），显示渲染样式
 * - 光标所在行显示完整 Markdown 语法
 * - 标题自动应用对应字号，加粗/斜体直接渲染样式
 * - 任务列表渲染为 checkbox
 * - 代码块添加背景样式
 * - 图片渲染为 <img> Widget
 * - 列表标记替换为圆点/数字 Widget
 */
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

/** CSS 类前缀 */
const CLS = 'cm-live-preview'

/** 标题级别 → CSS 类映射 */
const HEADING_CLASSES: Record<string, string> = {
  ATXHeading1: `${CLS}-h1`,
  ATXHeading2: `${CLS}-h2`,
  ATXHeading3: `${CLS}-h3`,
  ATXHeading4: `${CLS}-h4`,
  ATXHeading5: `${CLS}-h5`,
  ATXHeading6: `${CLS}-h6`
}

/** 隐藏标记的 Decoration */
const hideMark = Decoration.replace({})

/** 水平分割线 Widget */
class HRWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement('hr')
    hr.className = `${CLS}-hr`
    return hr
  }
}

/** 任务列表 Checkbox Widget */
class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }

  toDOM(): HTMLElement {
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = this.checked
    cb.className = `${CLS}-task-checkbox`
    cb.disabled = true
    return cb
  }

  eq(other: TaskCheckboxWidget): boolean {
    return this.checked === other.checked
  }
}

/** 图片 Widget */
class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super()
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div')
    container.className = `${CLS}-image-container`
    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.className = `${CLS}-image`
    img.style.maxWidth = '100%'
    img.style.borderRadius = '6px'
    img.style.margin = '4px 0'
    container.appendChild(img)
    return container
  }

  eq(other: ImageWidget): boolean {
    return this.src === other.src && this.alt === other.alt
  }
}

/** 列表圆点 Widget */
class ListBulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = `${CLS}-list-bullet`
    span.textContent = '•'
    return span
  }
}

/** 构建装饰集合 */
function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number

  syntaxTree(view.state).iterate({
    enter(node) {
      const line = view.state.doc.lineAt(node.from)

      if (line.number === cursorLine) return

      const name = node.name

      // 标题：隐藏 # 标记，应用标题样式
      if (HEADING_CLASSES[name]) {
        builder.add(line.from, line.to, Decoration.line({ class: HEADING_CLASSES[name] }))
        return
      }

      // 隐藏标题标记 (#)
      if (name === 'HeaderMark') {
        const markEnd = node.to
        const nextChar = view.state.sliceDoc(markEnd, markEnd + 1)
        const end = nextChar === ' ' ? markEnd + 1 : markEnd
        builder.add(node.from, end, hideMark)
        return
      }

      // 加粗：隐藏标记，应用加粗样式
      if (name === 'StrongEmphasis') {
        builder.add(node.from, node.to, Decoration.mark({ class: `${CLS}-bold` }))
        // 查找子节点 EmphasisMark 精确隐藏
        let markCount = 0
        const cursor = node.node.cursor()
        if (cursor.firstChild()) {
          do {
            if (cursor.name === 'EmphasisMark') {
              builder.add(cursor.from, cursor.to, hideMark)
              markCount++
            }
          } while (cursor.nextSibling())
        }
        if (markCount === 0) {
          builder.add(node.from, node.from + 2, hideMark)
          builder.add(node.to - 2, node.to, hideMark)
        }
        return false
      }

      // 斜体
      if (name === 'Emphasis') {
        builder.add(node.from, node.to, Decoration.mark({ class: `${CLS}-italic` }))
        let markCount = 0
        const cursor = node.node.cursor()
        if (cursor.firstChild()) {
          do {
            if (cursor.name === 'EmphasisMark') {
              builder.add(cursor.from, cursor.to, hideMark)
              markCount++
            }
          } while (cursor.nextSibling())
        }
        if (markCount === 0) {
          builder.add(node.from, node.from + 1, hideMark)
          builder.add(node.to - 1, node.to, hideMark)
        }
        return false
      }

      // 删除线
      if (name === 'Strikethrough') {
        builder.add(node.from, node.to, Decoration.mark({ class: `${CLS}-strikethrough` }))
        builder.add(node.from, node.from + 2, hideMark)
        builder.add(node.to - 2, node.to, hideMark)
        return false
      }

      // 行内代码
      if (name === 'InlineCode') {
        builder.add(node.from, node.to, Decoration.mark({ class: `${CLS}-code` }))
        builder.add(node.from, node.from + 1, hideMark)
        builder.add(node.to - 1, node.to, hideMark)
        return false
      }

      // 代码块：添加背景样式
      if (name === 'FencedCode') {
        for (
          let ln = view.state.doc.lineAt(node.from).number;
          ln <= view.state.doc.lineAt(node.to).number;
          ln++
        ) {
          const codeLine = view.state.doc.line(ln)
          builder.add(codeLine.from, codeLine.from, Decoration.line({ class: `${CLS}-codeblock` }))
        }
        return false
      }

      // 水平分割线
      if (name === 'HorizontalRule') {
        builder.add(node.from, node.to, Decoration.replace({ widget: new HRWidget() }))
        return false
      }

      // 任务列表：替换 `- [ ]` / `- [x]` 为 checkbox
      if (name === 'TaskMarker') {
        const text = view.state.sliceDoc(node.from, node.to)
        const checked = text.includes('x') || text.includes('X')
        builder.add(
          node.from,
          node.to,
          Decoration.replace({ widget: new TaskCheckboxWidget(checked) })
        )
        return false
      }

      // 引用
      if (name === 'Blockquote') {
        builder.add(node.from, node.to, Decoration.mark({ class: `${CLS}-blockquote` }))
        return
      }
      if (name === 'QuoteMark') {
        const end = view.state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
        builder.add(node.from, end, hideMark)
        return
      }

      // 图片：渲染为 <img> Widget
      if (name === 'Image') {
        const fullText = view.state.sliceDoc(node.from, node.to)
        const match = fullText.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
        if (match) {
          builder.add(
            node.from,
            node.to,
            Decoration.replace({ widget: new ImageWidget(match[2], match[1]) })
          )
        }
        return false
      }

      // 链接
      if (name === 'Link') {
        builder.add(node.from, node.to, Decoration.mark({ class: `${CLS}-link` }))
        return
      }
      if (name === 'LinkMark') {
        builder.add(node.from, node.to, hideMark)
        return
      }
      if (name === 'URL') {
        const urlStart = node.from - 1
        const urlEnd = node.to + 1
        if (
          urlStart >= 0 &&
          urlEnd <= view.state.doc.length &&
          view.state.sliceDoc(urlStart, urlStart + 1) === '(' &&
          view.state.sliceDoc(urlEnd - 1, urlEnd) === ')'
        ) {
          builder.add(urlStart, urlEnd, hideMark)
        }
        return
      }

      // 列表标记：隐藏 - / * 标记，用圆点 Widget 替代
      if (name === 'ListMark') {
        const markText = view.state.sliceDoc(node.from, node.to).trim()
        if (markText === '-' || markText === '*') {
          builder.add(node.from, node.to, Decoration.replace({ widget: new ListBulletWidget() }))
        }
        return
      }
    }
  })

  return builder.finish()
}

/** Live Preview ViewPlugin */
const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations
  }
)

/** Live Preview 样式主题 - 使用 CSS 变量替代硬编码颜色 */
const livePreviewTheme = EditorView.baseTheme({
  [`.${CLS}-h1`]: { fontSize: '2em', fontWeight: 'bold', lineHeight: '1.3' },
  [`.${CLS}-h2`]: { fontSize: '1.5em', fontWeight: 'bold', lineHeight: '1.3' },
  [`.${CLS}-h3`]: { fontSize: '1.25em', fontWeight: 'bold', lineHeight: '1.3' },
  [`.${CLS}-h4`]: { fontSize: '1.1em', fontWeight: 'bold', lineHeight: '1.3' },
  [`.${CLS}-h5`]: { fontSize: '1em', fontWeight: 'bold', lineHeight: '1.3' },
  [`.${CLS}-h6`]: { fontSize: '0.9em', fontWeight: 'bold', lineHeight: '1.3', opacity: '0.8' },
  [`.${CLS}-bold`]: { fontWeight: 'bold' },
  [`.${CLS}-italic`]: { fontStyle: 'italic' },
  [`.${CLS}-strikethrough`]: { textDecoration: 'line-through', opacity: '0.6' },
  [`.${CLS}-code`]: {
    fontFamily: 'var(--ant-font-family-code, monospace)',
    backgroundColor: 'var(--ant-color-fill-quaternary, rgba(0,0,0,0.04))',
    borderRadius: '3px',
    padding: '1px 4px'
  },
  [`.${CLS}-codeblock`]: {
    backgroundColor: 'var(--ant-color-fill-quaternary, rgba(0,0,0,0.04))',
    fontFamily: 'var(--ant-font-family-code, monospace)'
  },
  [`.${CLS}-blockquote`]: {
    borderLeft: '3px solid var(--ant-color-primary, #1677ff)',
    paddingLeft: '12px',
    opacity: '0.85'
  },
  [`.${CLS}-link`]: {
    color: 'var(--ant-color-primary, #1677ff)',
    textDecoration: 'underline',
    cursor: 'pointer'
  },
  [`.${CLS}-hr`]: {
    border: 'none',
    borderTop: '2px solid var(--ant-color-border, #d9d9d9)',
    margin: '8px 0'
  },
  [`.${CLS}-task-checkbox`]: {
    marginRight: '6px',
    verticalAlign: 'middle',
    cursor: 'default'
  },
  [`.${CLS}-image-container`]: {
    display: 'block',
    margin: '4px 0'
  },
  [`.${CLS}-list-bullet`]: {
    color: 'var(--ant-color-text-secondary, #666)',
    marginRight: '4px',
    fontWeight: 'bold'
  }
})

/** 创建 Live Preview 扩展 */
export function createLivePreviewExtension() {
  return [livePreviewPlugin, livePreviewTheme]
}
