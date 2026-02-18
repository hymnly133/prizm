/**
 * LivePreviewExtension - CodeMirror 6 Obsidian 风格 Live Preview (v2)
 *
 * 核心改进（对比 v1）：
 * - 块级光标揭示：光标所在块（段落/标题/列表项/代码块等）显示原始 Markdown
 * - 使用 Decoration.set() + 自动排序，修复嵌套装饰 RangeSetBuilder 排序 bug
 * - 交互式 Checkbox：点击切换 [ ] ↔ [x]
 * - 可点击链接：Ctrl/Cmd+Click 打开外部 URL
 * - 图片增强：lazy load、加载失败提示、alt 文字标注
 * - Viewport 限制：只构建可见范围内的装饰，提升大文档性能
 */
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from '@codemirror/view'
import { type Range } from '@codemirror/state'
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language'

/** CSS 类前缀 */
const CLS = 'cm-lp'

/** 块级语法节点名称集合（用于光标揭示范围检测） */
const BLOCK_NODES = new Set([
  'Paragraph',
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'SetextHeading1',
  'SetextHeading2',
  'FencedCode',
  'HorizontalRule',
  'ListItem',
  'Blockquote',
  'Table'
])

/** 标题节点名 → CSS 类 */
const HEADING_CLASSES: Record<string, string> = {
  ATXHeading1: `${CLS}-h1`,
  ATXHeading2: `${CLS}-h2`,
  ATXHeading3: `${CLS}-h3`,
  ATXHeading4: `${CLS}-h4`,
  ATXHeading5: `${CLS}-h5`,
  ATXHeading6: `${CLS}-h6`,
  SetextHeading1: `${CLS}-h1`,
  SetextHeading2: `${CLS}-h2`
}

/** 隐藏标记的 Decoration（将 Markdown 语法标记从视图中移除） */
const hideMark = Decoration.replace({})

/* ═══════════════════════════════════════════
   块级光标揭示
   ═══════════════════════════════════════════ */

/**
 * 沿语法树向上查找光标所在的最近块级节点范围。
 * 在该范围内的所有子节点不添加装饰（显示原始 Markdown 源码）。
 */
function getActiveBlockRange(view: EditorView): { from: number; to: number } | null {
  const head = view.state.selection.main.head
  const tree = syntaxTree(view.state)
  let node = tree.resolveInner(head, 1)

  while (node) {
    if (BLOCK_NODES.has(node.name)) {
      return { from: node.from, to: node.to }
    }
    if (!node.parent) break
    node = node.parent
  }

  const line = view.state.doc.lineAt(head)
  return { from: line.from, to: line.to }
}

/** 判断节点是否完全包含在活跃块内 */
function isInActiveBlock(
  nodeFrom: number,
  nodeTo: number,
  block: { from: number; to: number } | null
): boolean {
  if (!block) return false
  return nodeFrom >= block.from && nodeTo <= block.to
}

/* ═══════════════════════════════════════════
   Widget 类
   ═══════════════════════════════════════════ */

class HRWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement('hr')
    hr.className = `${CLS}-hr`
    return hr
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly docFrom: number, readonly docTo: number) {
    super()
  }

  toDOM(): HTMLElement {
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = this.checked
    cb.className = `${CLS}-task-cb`
    cb.dataset.from = String(this.docFrom)
    cb.dataset.to = String(this.docTo)
    return cb
  }

  eq(other: TaskCheckboxWidget): boolean {
    return this.checked === other.checked && this.docFrom === other.docFrom
  }
}

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super()
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div')
    container.className = `${CLS}-img-wrap`

    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.className = `${CLS}-img`
    img.loading = 'lazy'
    img.onerror = () => {
      container.textContent = `[图片加载失败: ${this.alt || this.src}]`
      container.className = `${CLS}-img-error`
    }
    container.appendChild(img)

    if (this.alt) {
      const caption = document.createElement('span')
      caption.className = `${CLS}-img-caption`
      caption.textContent = this.alt
      container.appendChild(caption)
    }
    return container
  }

  eq(other: ImageWidget): boolean {
    return this.src === other.src && this.alt === other.alt
  }
}

class ListBulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = `${CLS}-bullet`
    span.textContent = '-'
    return span
  }
}

/* ═══════════════════════════════════════════
   装饰构建（Viewport-scoped）
   ═══════════════════════════════════════════ */

function buildDecorations(view: EditorView): DecorationSet {
  const decs: Range<Decoration>[] = []
  const activeBlock = getActiveBlockRange(view)

  // 为活跃块的行添加微弱背景标识
  if (activeBlock) {
    const startLn = view.state.doc.lineAt(activeBlock.from).number
    const endLn = view.state.doc.lineAt(activeBlock.to).number
    for (let ln = startLn; ln <= endLn; ln++) {
      const l = view.state.doc.line(ln)
      decs.push(Decoration.line({ class: `${CLS}-active` }).range(l.from))
    }
  }

  for (const { from, to } of view.visibleRanges) {
    // 主动强制解析可见区域语法树（200ms 超时），修复长文档滚动到底部时
    // 增量解析器尚未覆盖该区域、导致 Live Preview 装饰不生效的问题
    const tree = ensureSyntaxTree(view.state, to, 200) ?? syntaxTree(view.state)
    tree.iterate({
      from,
      to,
      enter(node) {
        // 完全在活跃块内的节点全部跳过（显示原始源码）
        if (isInActiveBlock(node.from, node.to, activeBlock)) return false

        const name = node.name

        // ─── 标题 ───
        if (HEADING_CLASSES[name]) {
          const startLine = view.state.doc.lineAt(node.from)
          const endLine = view.state.doc.lineAt(node.to)
          for (let ln = startLine.number; ln <= endLine.number; ln++) {
            const l = view.state.doc.line(ln)
            decs.push(Decoration.line({ class: HEADING_CLASSES[name] }).range(l.from))
          }
          return // 继续遍历子节点以隐藏 HeaderMark
        }

        if (name === 'HeaderMark') {
          const end = view.state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
          decs.push(hideMark.range(node.from, end))
          return
        }

        // ─── 加粗 ───
        if (name === 'StrongEmphasis') {
          decs.push(Decoration.mark({ class: `${CLS}-bold` }).range(node.from, node.to))
          const c = node.node.cursor()
          if (c.firstChild()) {
            do {
              if (c.name === 'EmphasisMark') decs.push(hideMark.range(c.from, c.to))
            } while (c.nextSibling())
          }
          return false
        }

        // ─── 斜体 ───
        if (name === 'Emphasis') {
          decs.push(Decoration.mark({ class: `${CLS}-italic` }).range(node.from, node.to))
          const c = node.node.cursor()
          if (c.firstChild()) {
            do {
              if (c.name === 'EmphasisMark') decs.push(hideMark.range(c.from, c.to))
            } while (c.nextSibling())
          }
          return false
        }

        // ─── 删除线 ───
        if (name === 'Strikethrough') {
          decs.push(Decoration.mark({ class: `${CLS}-strike` }).range(node.from, node.to))
          decs.push(hideMark.range(node.from, node.from + 2))
          decs.push(hideMark.range(node.to - 2, node.to))
          return false
        }

        // ─── 行内代码 ───
        if (name === 'InlineCode') {
          decs.push(Decoration.mark({ class: `${CLS}-code` }).range(node.from, node.to))
          decs.push(hideMark.range(node.from, node.from + 1))
          decs.push(hideMark.range(node.to - 1, node.to))
          return false
        }

        // ─── 代码块 ───
        if (name === 'FencedCode') {
          const startLn = view.state.doc.lineAt(node.from).number
          const endLn = view.state.doc.lineAt(node.to).number
          for (let ln = startLn; ln <= endLn; ln++) {
            const l = view.state.doc.line(ln)
            const classes = [`${CLS}-codeblock`]
            if (ln === startLn) classes.push(`${CLS}-codeblock-first`)
            if (ln === endLn) classes.push(`${CLS}-codeblock-last`)
            decs.push(Decoration.line({ class: classes.join(' ') }).range(l.from))
          }
          return false
        }

        // ─── 水平分割线 ───
        if (name === 'HorizontalRule') {
          decs.push(Decoration.replace({ widget: new HRWidget() }).range(node.from, node.to))
          return false
        }

        // ─── 任务 Checkbox ───
        if (name === 'TaskMarker') {
          const text = view.state.sliceDoc(node.from, node.to)
          const checked = text.includes('x') || text.includes('X')
          decs.push(
            Decoration.replace({
              widget: new TaskCheckboxWidget(checked, node.from, node.to)
            }).range(node.from, node.to)
          )
          return false
        }

        // ─── 引用块 ───
        if (name === 'Blockquote') {
          const startLn = view.state.doc.lineAt(node.from).number
          const endLn = view.state.doc.lineAt(node.to).number
          for (let ln = startLn; ln <= endLn; ln++) {
            const l = view.state.doc.line(ln)
            decs.push(Decoration.line({ class: `${CLS}-bq` }).range(l.from))
          }
          return // 继续遍历子节点
        }

        if (name === 'QuoteMark') {
          const end = view.state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
          decs.push(hideMark.range(node.from, end))
          return
        }

        // ─── 图片 ───
        if (name === 'Image') {
          const fullText = view.state.sliceDoc(node.from, node.to)
          const match = fullText.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
          if (match) {
            decs.push(
              Decoration.replace({
                widget: new ImageWidget(match[2], match[1])
              }).range(node.from, node.to)
            )
          }
          return false
        }

        // ─── 链接 ───
        if (name === 'Link') {
          let url = ''
          const c = node.node.cursor()
          if (c.firstChild()) {
            do {
              if (c.name === 'URL') url = view.state.sliceDoc(c.from, c.to)
            } while (c.nextSibling())
          }
          decs.push(
            Decoration.mark({
              class: `${CLS}-link`,
              ...(url
                ? {
                    attributes: {
                      'data-href': url,
                      title: `${url}\nCtrl+Click 打开`
                    }
                  }
                : {})
            }).range(node.from, node.to)
          )
          return // 继续遍历子节点以隐藏 LinkMark/URL
        }

        if (name === 'LinkMark') {
          decs.push(hideMark.range(node.from, node.to))
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
            decs.push(hideMark.range(urlStart, urlEnd))
          }
          return
        }

        // ─── 列表标记 ───
        if (name === 'ListMark') {
          const markText = view.state.sliceDoc(node.from, node.to).trim()
          if (markText === '-' || markText === '*') {
            decs.push(
              Decoration.replace({ widget: new ListBulletWidget() }).range(node.from, node.to)
            )
          }
          return
        }
      }
    })
  }

  return Decoration.set(decs, true)
}

/* ═══════════════════════════════════════════
   ViewPlugin
   ═══════════════════════════════════════════ */

/**
 * ViewPlugin — 最简原始逻辑（CM6 官方推荐写法）
 * 仅在文档变化 / 视口变化 / 语法树更新 / 选区变化时重建装饰
 */
const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations }
)

/* ═══════════════════════════════════════════
   事件处理（Checkbox 交互 + 链接打开）
   ═══════════════════════════════════════════ */

const livePreviewEventHandlers = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target
    if (target instanceof HTMLInputElement && target.classList.contains(`${CLS}-task-cb`)) {
      event.preventDefault()
      const from = parseInt(target.dataset.from ?? '', 10)
      const to = parseInt(target.dataset.to ?? '', 10)
      if (isNaN(from) || isNaN(to)) return false
      const currentText = view.state.sliceDoc(from, to)
      const newText = currentText.includes('x') || currentText.includes('X') ? '[ ]' : '[x]'
      view.dispatch({ changes: { from, to, insert: newText } })
      return true
    }
    return false
  },
  click(event) {
    if (!(event.metaKey || event.ctrlKey)) return false
    const target = event.target as HTMLElement
    const linkEl = target.closest(`.${CLS}-link`) as HTMLElement | null
    if (linkEl?.dataset.href) {
      event.preventDefault()
      window.open(linkEl.dataset.href, '_blank', 'noopener')
      return true
    }
    return false
  }
})

/* ═══════════════════════════════════════════
   主题（EditorView.baseTheme）
   ═══════════════════════════════════════════ */

const livePreviewTheme = EditorView.baseTheme({})

/** 创建 Live Preview 扩展 */
export function createLivePreviewExtension() {
  return [livePreviewPlugin, livePreviewEventHandlers, livePreviewTheme]
}
