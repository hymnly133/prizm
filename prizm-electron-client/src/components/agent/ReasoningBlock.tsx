/**
 * ReasoningBlock — 思考过程展示组件
 *
 * 放置在助手消息正文之前，支持：
 * - 流式输入时自动展开，实时显示思考内容
 * - 完成后自动折叠为摘要行，点击可展开
 * - 平滑高度动画 + 渐变遮罩
 */
import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { BrainCircuit, ChevronRight } from 'lucide-react'
import { createStyles } from 'antd-style'
import { ThinkingDots } from './ThinkingDots'

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    margin-bottom: 12px;
    border-radius: 10px;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorFillQuaternary};
    overflow: hidden;
    transition: border-color 0.3s;

    &:hover {
      border-color: ${token.colorBorder};
    }
  `,
  header: css`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    cursor: pointer;
    user-select: none;
    font-size: 12px;
    font-weight: 500;
    color: ${token.colorTextSecondary};
    transition: color 0.2s;

    &:hover {
      color: ${token.colorText};
    }
  `,
  headerIcon: css`
    flex-shrink: 0;
    color: ${token.colorPrimary};
    opacity: 0.7;
  `,
  headerLabel: css`
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  chevron: css`
    flex-shrink: 0;
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    color: ${token.colorTextQuaternary};
  `,
  chevronOpen: css`
    transform: rotate(90deg);
  `,
  body: css`
    overflow: hidden;
  `,
  content: css`
    padding: 0 12px 10px;
    font-size: 12px;
    line-height: 1.6;
    color: ${token.colorTextSecondary};
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 280px;
    overflow-y: auto;
    mask-image: linear-gradient(to bottom, black calc(100% - 24px), transparent);
    -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 24px), transparent);

    &::-webkit-scrollbar {
      width: 4px;
    }
    &::-webkit-scrollbar-thumb {
      background: ${token.colorBorderSecondary};
      border-radius: 2px;
    }
  `,
  contentFull: css`
    mask-image: none;
    -webkit-mask-image: none;
  `,
  streamingIndicator: css`
    padding: 4px 12px 8px;
  `
}))

interface ReasoningBlockProps {
  reasoning: string
  streaming?: boolean
}

export const ReasoningBlock = memo(function ReasoningBlock({
  reasoning,
  streaming
}: ReasoningBlockProps) {
  const { styles, cx } = useStyles()
  const [expanded, setExpanded] = useState(false)
  const [userToggled, setUserToggled] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (streaming && !userToggled) {
      setExpanded(true)
    }
    if (!streaming && !userToggled) {
      setExpanded(false)
    }
  }, [streaming, userToggled])

  useEffect(() => {
    if (streaming && expanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [reasoning, streaming, expanded])

  const toggle = useCallback(() => {
    setUserToggled(true)
    setExpanded((prev) => !prev)
  }, [])

  const firstLine = reasoning.split('\n')[0]?.slice(0, 80) || '思考过程'
  const summaryText = streaming ? '正在思考…' : firstLine

  const isShort = reasoning.length < 600
  const contentCx = cx(styles.content, (expanded && isShort) && styles.contentFull)

  return (
    <div className={styles.container}>
      <div className={styles.header} onClick={toggle}>
        <BrainCircuit size={14} className={styles.headerIcon} />
        <span className={styles.headerLabel}>{summaryText}</span>
        <ChevronRight
          size={14}
          className={cx(styles.chevron, expanded && styles.chevronOpen)}
        />
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className={styles.body}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          >
            <div ref={contentRef} className={contentCx}>
              {reasoning}
            </div>
            {streaming && (
              <div className={styles.streamingIndicator}>
                <ThinkingDots size={4} label="思考中" />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
