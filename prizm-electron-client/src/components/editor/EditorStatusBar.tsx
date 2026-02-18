/**
 * EditorStatusBar - 编辑器底部状态栏
 * 保存状态 | 光标位置 | 字符数 · 词数 · 阅读时间
 */
import { useState, useEffect } from 'react'
import { createStyles } from 'antd-style'
import { Check, Circle, Loader2 } from 'lucide-react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'

const useStyles = createStyles(({ css, token }) => ({
  bar: css`
    height: 26px;
    padding: 0 16px;
    border-top: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgLayout};
    flex-shrink: 0;
    font-size: 11px;
    color: ${token.colorTextQuaternary};
    display: flex;
    align-items: center;
    gap: 16px;
    user-select: none;
  `,
  left: css`
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  right: css`
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 12px;
  `,
  dot: css`
    display: inline-flex;
    align-items: center;
    gap: 3px;
  `,
  saved: css`
    color: ${token.colorSuccess};
  `,
  unsaved: css`
    color: ${token.colorWarning};
  `,
  saving: css`
    color: ${token.colorPrimary};
  `
}))

interface EditorStatusBarProps {
  dirty: boolean
  saving: boolean
  charCount: number
  wordCount: number
  editorRef: React.MutableRefObject<ReactCodeMirrorRef | null>
}

function estimateReadingTime(wordCount: number): string {
  const minutes = Math.ceil(wordCount / 250)
  if (minutes < 1) return '< 1 分钟'
  return `${minutes} 分钟`
}

export default function EditorStatusBar({
  dirty,
  saving,
  charCount,
  wordCount,
  editorRef
}: EditorStatusBarProps) {
  const { styles, cx } = useStyles()
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 })

  useEffect(() => {
    const interval = setInterval(() => {
      const view = editorRef.current?.view
      if (!view) return
      const head = view.state.selection.main.head
      const line = view.state.doc.lineAt(head)
      setCursorPos({ line: line.number, col: head - line.from + 1 })
    }, 400)
    return () => clearInterval(interval)
  }, [editorRef])

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        {saving ? (
          <span className={cx(styles.dot, styles.saving)}>
            <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
            保存中
          </span>
        ) : dirty ? (
          <span className={cx(styles.dot, styles.unsaved)}>
            <Circle size={6} fill="currentColor" stroke="none" />
            未保存
          </span>
        ) : (
          <span className={cx(styles.dot, styles.saved)}>
            <Check size={10} />
            已保存
          </span>
        )}
      </div>

      <span>
        行 {cursorPos.line}, 列 {cursorPos.col}
      </span>

      <div className={styles.right}>
        <span>{charCount.toLocaleString()} 字符</span>
        <span>{wordCount.toLocaleString()} 词</span>
        <span>阅读 {estimateReadingTime(wordCount)}</span>
      </div>
    </div>
  )
}
