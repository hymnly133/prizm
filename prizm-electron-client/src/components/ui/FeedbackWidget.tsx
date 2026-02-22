/**
 * FeedbackWidget — 三态评分 + 可选评语的反馈收集组件
 *
 * 变体：
 * - inline（默认）：紧凑行内，用于聊天消息尾部
 * - card：卡片式，用于工作流结果/知识库详情
 */
import { useState, useCallback, useRef, useEffect, memo } from 'react'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import { ActionIcon } from '@lobehub/ui'
import { ThumbsUp, ThumbsDown, Minus, Check, Send } from 'lucide-react'
import { Input, message } from 'antd'
import { motion, AnimatePresence } from 'motion/react'
import { createStyles } from 'antd-style'
import type { FeedbackRating, FeedbackTargetType, FeedbackEntry } from '@prizm/shared'
import { usePrizmContext } from '../../context/PrizmContext'
import { useScope } from '../../hooks/useScope'

const { TextArea } = Input

export interface FeedbackWidgetProps {
  targetType: FeedbackTargetType
  targetId: string
  sessionId?: string
  /** 上下文元数据（如模型名、工具列表等） */
  metadata?: Record<string, unknown>
  /** inline（默认）= 紧凑行内；card = 卡片式 */
  variant?: 'inline' | 'card'
  /** 已有反馈时预填 */
  initialRating?: FeedbackRating
  initialComment?: string
  /** 提交成功回调 */
  onSubmitted?: (entry: FeedbackEntry) => void
}

const RATING_CONFIG = [
  { key: 'like' as const, icon: ThumbsUp, label: '喜欢', activeColor: 'var(--ant-color-success)' },
  {
    key: 'neutral' as const,
    icon: Minus,
    label: '一般',
    activeColor: 'var(--ant-color-text-tertiary)'
  },
  {
    key: 'dislike' as const,
    icon: ThumbsDown,
    label: '不喜欢',
    activeColor: 'var(--ant-color-error)'
  }
]

const useStyles = createStyles(({ css, token, isDarkMode }) => ({
  root: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
  `,
  rootCard: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 16px;
    border-radius: ${token.borderRadiusLG}px;
    background: ${isDarkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'};
    border: 1px solid ${token.colorBorderSecondary};
  `,
  cardTitle: css`
    font-size: 12px;
    font-weight: 500;
    color: ${token.colorTextSecondary};
    margin-bottom: 2px;
  `,
  btnGroup: css`
    display: inline-flex;
    align-items: center;
    gap: 2px;
  `,
  ratingBtn: css`
    transition: all 0.2s ease;
    border-radius: 8px;
    &:hover {
      transform: scale(1.1);
    }
  `,
  ratingBtnFaded: css`
    opacity: 0.3;
    &:hover {
      opacity: 0.6;
    }
  `,
  commentRow: css`
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin-top: 2px;
  `,
  commentInput: css`
    font-size: 12px;
    resize: none;
    min-height: 32px;
    border-radius: 8px;
  `,
  submittedCheck: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: ${token.colorSuccess};
    padding: 2px 6px;
    border-radius: 10px;
  `
}))

export const FeedbackWidget = memo(function FeedbackWidget({
  targetType,
  targetId,
  sessionId,
  metadata,
  variant = 'inline',
  initialRating,
  initialComment,
  onSubmitted
}: FeedbackWidgetProps) {
  const { styles, cx } = useStyles()
  const { manager } = usePrizmContext() ?? {}
  const { currentScope } = useScope()
  const http = manager?.getHttpClient()

  const [selectedRating, setSelectedRating] = useState<FeedbackRating | null>(initialRating ?? null)
  const [comment, setComment] = useState(initialComment ?? '')
  const [showComment, setShowComment] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(!!initialRating)
  const [justSubmitted, setJustSubmitted] = useState(false)
  const commentRef = useRef<TextAreaRef>(null)
  const submitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (showComment && commentRef.current?.resizableTextArea?.textArea) {
      commentRef.current.resizableTextArea.textArea.focus()
    }
  }, [showComment])

  useEffect(() => {
    return () => {
      if (submitTimer.current) clearTimeout(submitTimer.current)
    }
  }, [])

  const doSubmit = useCallback(
    async (rating: FeedbackRating, commentText?: string) => {
      if (!http || submitting) return
      setSubmitting(true)
      try {
        const entry = await http.submitFeedback(
          {
            targetType,
            targetId,
            sessionId,
            rating,
            comment: commentText?.trim() || undefined,
            metadata
          },
          currentScope
        )
        setSubmitted(true)
        setJustSubmitted(true)
        setShowComment(false)
        onSubmitted?.(entry)
        submitTimer.current = setTimeout(() => setJustSubmitted(false), 2000)
      } catch {
        message.error('提交反馈失败')
      } finally {
        setSubmitting(false)
      }
    },
    [http, targetType, targetId, sessionId, metadata, currentScope, submitting, onSubmitted]
  )

  const handleRatingClick = useCallback(
    (rating: FeedbackRating) => {
      if (selectedRating === rating) {
        if (showComment) {
          doSubmit(rating, comment)
        } else {
          doSubmit(rating)
        }
        return
      }
      setSelectedRating(rating)
      setSubmitted(false)
      setJustSubmitted(false)
      if (variant === 'card') {
        setShowComment(true)
      }
    },
    [selectedRating, showComment, comment, variant, doSubmit]
  )

  const handleCommentSubmit = useCallback(() => {
    if (selectedRating) {
      doSubmit(selectedRating, comment)
    }
  }, [selectedRating, comment, doSubmit])

  const handleCommentKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleCommentSubmit()
      }
    },
    [handleCommentSubmit]
  )

  const toggleComment = useCallback(() => {
    if (!selectedRating) return
    setShowComment((prev) => !prev)
  }, [selectedRating])

  const isReducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const isCard = variant === 'card'

  return (
    <div className={isCard ? styles.rootCard : styles.root}>
      {isCard && <div className={styles.cardTitle}>这个结果对你有帮助吗？</div>}

      <div className={styles.btnGroup}>
        {RATING_CONFIG.map(({ key, icon, label, activeColor }) => {
          const isActive = selectedRating === key
          const isFaded = selectedRating !== null && !isActive
          return (
            <ActionIcon
              key={key}
              icon={icon}
              size={isCard ? 'large' : 'small'}
              title={label}
              aria-label={label}
              className={cx(styles.ratingBtn, isFaded && styles.ratingBtnFaded)}
              style={isActive ? { color: activeColor } : undefined}
              onClick={() => handleRatingClick(key)}
              loading={submitting && isActive}
            />
          )
        })}

        {selectedRating && !showComment && !isCard && (
          <ActionIcon
            icon={Send}
            size="small"
            title="添加评语"
            aria-label="添加评语"
            style={{ opacity: 0.5 }}
            onClick={toggleComment}
          />
        )}

        <AnimatePresence>
          {justSubmitted && (
            <motion.span
              className={styles.submittedCheck}
              initial={isReducedMotion ? false : { opacity: 0, scale: 0.8 }}
              animate={isReducedMotion ? false : { opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: isReducedMotion ? 0 : 0.2 }}
            >
              <Check size={12} />
              {isCard ? '感谢反馈' : ''}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showComment && selectedRating && (
          <motion.div
            className={styles.commentRow}
            initial={isReducedMotion ? false : { opacity: 0, height: 0 }}
            animate={isReducedMotion ? false : { opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: isReducedMotion ? 0 : 0.2 }}
          >
            <TextArea
              ref={commentRef}
              className={styles.commentInput}
              placeholder="说说你的想法（可选）"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={handleCommentKeyDown}
              maxLength={2000}
              autoSize={{ minRows: 1, maxRows: 3 }}
              style={{ flex: 1, minWidth: isCard ? 200 : 150 }}
            />
            <ActionIcon
              icon={Send}
              size="small"
              title="提交反馈"
              aria-label="提交反馈"
              onClick={handleCommentSubmit}
              loading={submitting}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
