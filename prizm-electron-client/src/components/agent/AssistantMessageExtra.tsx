/**
 * 助手消息额外信息：思考过程 + Token 展示 + 记忆标签
 * 增强版：内联 token 环形图 + hover 展开详情
 */
import type { ChatMessage } from '@lobehub/ui/chat'
import { Flexbox, Popover, Text } from '@lobehub/ui'
import { Coins } from 'lucide-react'
import type { MemoryIdsByLayer } from '@prizm/shared'
import { useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { usePrizmContext } from '../../context/PrizmContext'
import { useScope } from '../../hooks/useScope'
import { MemoryRefsTag } from './MemoryRefsTag'
import { createStyles } from 'antd-style'

function formatToken(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const useStyles = createStyles(({ css, token }) => ({
  extra: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  `,
  reasoning: css`
    margin: 0;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorFillQuaternary};
  `,
  reasoningSummary: css`
    cursor: pointer;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 500;
    color: ${token.colorTextSecondary};

    &:hover {
      color: ${token.colorText};
    }
  `,
  reasoningContent: css`
    margin: 0;
    padding: 10px 12px;
    font-size: 12px;
    line-height: 1.5;
    color: ${token.colorTextSecondary};
    white-space: pre-wrap;
    word-break: break-word;
    border-top: 1px solid ${token.colorBorderSecondary};
    max-height: 200px;
    overflow-y: auto;
  `,
  usageRow: css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: ${token.colorTextTertiary};
    cursor: default;
    padding: 2px 8px;
    border-radius: 10px;
    transition: background 0.15s, color 0.15s;

    &:hover {
      background: ${token.colorFillQuaternary};
      color: ${token.colorTextSecondary};
    }
  `,
  usagePop: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 4px;
    min-width: 180px;
  `,
  usagePopRow: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
  `,
  usagePopLabel: css`
    color: ${token.colorTextSecondary};
  `,
  usagePopValue: css`
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    color: ${token.colorText};
  `,
  miniRing: css`
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex-shrink: 0;
  `,
  modelTag: css`
    font-size: 11px;
    color: ${token.colorTextQuaternary};
    padding: 1px 6px;
    border-radius: 4px;
    background: ${token.colorFillQuaternary};
  `
}))

/** 小型 CSS 环形图 */
function MiniRing({ inputPct, size = 18 }: { inputPct: number; size?: number }) {
  const outPct = 100 - inputPct
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `conic-gradient(
          var(--ant-color-primary) 0% ${inputPct}%,
          var(--ant-color-success) ${inputPct}% 100%
        )`,
        flexShrink: 0,
        position: 'relative'
      }}
      title={`Input ${inputPct.toFixed(0)}% / Output ${outPct.toFixed(0)}%`}
    >
      <div
        style={{
          position: 'absolute',
          inset: 3,
          borderRadius: '50%',
          background: 'var(--ant-color-bg-container)'
        }}
      />
    </div>
  )
}

export interface AssistantMessageExtraProps extends ChatMessage {}

export function AssistantMessageExtra(props: AssistantMessageExtraProps) {
  const { styles } = useStyles()
  const { manager } = usePrizmContext() ?? {}
  const { currentScope } = useScope()
  const extra = props.extra as
    | {
        model?: string
        usage?: { totalTokens?: number; totalInputTokens?: number; totalOutputTokens?: number }
        reasoning?: string
        parts?: import('@prizm/client-core').MessagePart[]
        memoryRefs?: import('@prizm/shared').MemoryRefs | null
        messageId?: string
      }
    | undefined
  const hasReasoning = !!extra?.reasoning?.trim()
  const http = manager?.getHttpClient()

  const handleResolve = useCallback(
    async (byLayer: MemoryIdsByLayer) => {
      if (!http) return {}
      return http.resolveMemoryIds(byLayer, currentScope)
    },
    [http, currentScope]
  )

  const usage = extra?.usage
  const hasUsage = !!(
    usage?.totalTokens ||
    usage?.totalInputTokens != null ||
    usage?.totalOutputTokens != null
  )
  const total =
    usage?.totalTokens ?? (usage?.totalInputTokens ?? 0) + (usage?.totalOutputTokens ?? 0)
  const inputPct =
    total > 0 && usage?.totalInputTokens != null ? (usage.totalInputTokens / total) * 100 : 50

  return (
    <div className={styles.extra}>
      {hasReasoning && (
        <details className={styles.reasoning}>
          <summary className={styles.reasoningSummary}>思考过程</summary>
          <pre className={styles.reasoningContent}>{extra!.reasoning}</pre>
        </details>
      )}
      <Flexbox horizontal align="center" gap={4} wrap="wrap">
        {/* 模型标签 */}
        {extra?.model && <span className={styles.modelTag}>{extra.model}</span>}

        {/* Token 内联展示 */}
        {hasUsage && (
          <Popover
            content={
              <div className={styles.usagePop}>
                {extra?.model && (
                  <div className={styles.usagePopRow}>
                    <span className={styles.usagePopLabel}>模型</span>
                    <span className={styles.usagePopValue}>{extra.model}</span>
                  </div>
                )}
                {usage?.totalInputTokens != null && (
                  <div className={styles.usagePopRow}>
                    <span className={styles.usagePopLabel}>Input</span>
                    <span className={styles.usagePopValue}>
                      {formatToken(usage.totalInputTokens)}
                    </span>
                  </div>
                )}
                {usage?.totalOutputTokens != null && (
                  <div className={styles.usagePopRow}>
                    <span className={styles.usagePopLabel}>Output</span>
                    <span className={styles.usagePopValue}>
                      {formatToken(usage.totalOutputTokens)}
                    </span>
                  </div>
                )}
                <div
                  className={styles.usagePopRow}
                  style={{
                    borderTop: '1px solid var(--ant-color-border-secondary)',
                    paddingTop: 6,
                    marginTop: 2,
                    fontWeight: 600
                  }}
                >
                  <span className={styles.usagePopLabel}>合计</span>
                  <span className={styles.usagePopValue}>{formatToken(total)}</span>
                </div>
              </div>
            }
          >
            <span className={styles.usageRow}>
              <MiniRing inputPct={inputPct} />
              <Coins size={11} />
              <span>{formatToken(total)}</span>
            </span>
          </Popover>
        )}

        {/* 记忆引用标签 */}
        <MemoryRefsTag
          memoryRefs={extra?.memoryRefs}
          onResolve={handleResolve}
          scope={currentScope}
        />
      </Flexbox>
    </div>
  )
}
