/**
 * EditorPlayground - 编辑器对比体验面板
 * 左右并排展示 CodeMirror 6 和 @lobehub/editor (Lexical) 两个编辑器
 * 使用相同的 Markdown 示例内容，方便直接对比体验
 */
import { useState, lazy, Suspense } from 'react'
import { Flexbox } from '@lobehub/ui'
import { createStyles } from 'antd-style'
import { MarkdownEditor } from './editor'

const SAMPLE_MARKDOWN = `# 编辑器对比体验

这是一段用于对比 **CodeMirror 6** 和 **Lobe Editor (Lexical)** 的示例文档。

## 基本格式

- **加粗文本**
- *斜体文本*
- ~~删除线~~
- \`行内代码\`

## 列表

1. 有序列表第一项
2. 有序列表第二项
3. 有序列表第三项

- 无序列表 A
- 无序列表 B
  - 嵌套子项

## 代码块

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`
}
\`\`\`

## 链接与引用

[Prizm 项目](https://github.com/example/prizm)

> 这是一段引用文本。
> 可以有多行。

---

## 任务列表

- [ ] 待完成任务
- [x] 已完成任务

以上内容覆盖了常见的 Markdown 元素，请在两个编辑器中分别操作体验差异。
`

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    gap: 16px;
  `,
  paneWrap: css`
    flex: 1;
    min-width: 0;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `,
  paneHeader: css`
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
    background: ${token.colorFillQuaternary};
    border-bottom: 1px solid ${token.colorBorderSecondary};
    flex-shrink: 0;
  `,
  paneNote: css`
    padding: 4px 12px;
    font-size: 11px;
    color: ${token.colorTextQuaternary};
    background: ${token.colorFillQuaternary};
    border-bottom: 1px solid ${token.colorBorderSecondary};
    flex-shrink: 0;
  `,
  paneBody: css`
    flex: 1;
    overflow: auto;
    height: 500px;
  `,
  lobeEditorWrap: css`
    padding: 16px;
    height: 100%;
    overflow: auto;
  `,
  errorBox: css`
    padding: 24px;
    color: ${token.colorError};
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-all;
  `
}))

/** 懒加载 Lobe Editor 包装组件，避免主包导入失败影响整个页面 */
const LobeEditorPane = lazy(() => import('./LobeEditorPane'))

export default function EditorPlayground() {
  const { styles } = useStyles()
  const [cmContent, setCmContent] = useState(SAMPLE_MARKDOWN)

  return (
    <Flexbox className={styles.container} horizontal>
      {/* 左侧：CodeMirror 6 */}
      <div className={styles.paneWrap}>
        <div className={styles.paneHeader}>CodeMirror 6（当前方案）</div>
        <div className={styles.paneBody}>
          <MarkdownEditor
            value={cmContent}
            onChange={setCmContent}
            mode="source"
            placeholder="在此编辑 Markdown..."
          />
        </div>
      </div>

      {/* 右侧：Lobe Editor (Lexical) */}
      <div className={styles.paneWrap}>
        <div className={styles.paneHeader}>Lobe Editor（Lexical 富文本）</div>
        <div className={styles.paneNote}>
          已知限制：横线(---)附近无法放置光标，部分快捷键缺失 — Lexical 框架已知行为
        </div>
        <div className={`${styles.paneBody} ${styles.lobeEditorWrap}`}>
          <Suspense
            fallback={<div style={{ padding: 24, color: '#999' }}>加载 Lobe Editor...</div>}
          >
            <LobeEditorPane initialMarkdown={SAMPLE_MARKDOWN} />
          </Suspense>
        </div>
      </div>
    </Flexbox>
  )
}
