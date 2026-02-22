/**
 * 助手消息额外信息：Token 展示 + 记忆标签
 * 增强版：内联 token 环形图 + hover 展开详情
 * （思考过程已迁移到 ReasoningBlock，渲染在消息正文之前）
 */
import type { ChatMessage } from '@lobehub/ui/chat'
import { Flexbox, Popover } from '@lobehub/ui'
import { Coins } from 'lucide-react'
import type { MemoryIdsByLayer } from '@prizm/shared'
import { useCallback } from 'react'
import { usePrizmContext } from '../../context/PrizmContext'
import { useScope } from '../../hooks/useScope'
import { useSessionChatSafe } from '../../context/SessionChatContext'
import { MemoryRefsTag } from './MemoryRefsTag'
import { FeedbackWidget } from '../ui/FeedbackWidget'
import { createStyles } from 'antd-style'

function formatToken(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const useStyles = createStyles(({ css, token, isDarkMode }) => ({
  extra: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
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
    transition: background 0.2s, color 0.2s;

    &:hover {
      background: ${token.colorFillQuaternary};
      color: ${token.colorTextSecondary};
    }
  `,
  cacheBadge: css`
    display: inline-flex;
    align-items: center;
    font-size: 10px;
    font-weight: 500;
    color: ${token.colorTextQuaternary};
    padding: 0 5px;
    border-radius: 8px;
    background: ${isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'};
    line-height: 16px;
    letter-spacing: 0.01em;
  `,
  usagePop: css`
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 10px 6px;
    min-width: 210px;
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
  usagePopDivider: css`
    border-top: 1px solid ${token.colorBorderSecondary};
    padding-top: 7px;
    margin-top: 3px;
  `,
  usagePopCacheBar: css`
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    padding-left: 8px;
  `,
  cacheBarTrack: css`
    flex: 1;
    height: 3px;
    border-radius: 1.5px;
    background: ${token.colorFillSecondary};
    overflow: hidden;
  `,
  cacheBarFill: css`
    height: 100%;
    border-radius: 1.5px;
    background: ${token.colorPrimary};
    background-image: repeating-linear-gradient(
      -45deg,
      transparent 0px,
      transparent 1.5px,
      ${token.colorBgContainer} 1.5px,
      ${token.colorBgContainer} 3px
    );
    transition: width 0.3s ease;
  `,
  modelTag: css`
    font-size: 11px;
    color: ${token.colorTextQuaternary};
    padding: 1px 6px;
    border-radius: 4px;
    background: ${token.colorFillQuaternary};
  `
}))

/**
 * 二段式 CSS 环形图：Input (蓝) + Output (绿)
 * 缓存信息由外部的 badge 文本展示，不在环形图中用独立颜色
 */
function MiniRing({ inputPct, size = 18 }: { inputPct: number; size?: number }) {
  const outPct = Math.max(0, 100 - inputPct)

  const gradient = `conic-gradient(
    var(--ant-color-primary) 0% ${inputPct}%,
    var(--ant-color-success) ${inputPct}% 100%
  )`

  const title = `输入 ${inputPct.toFixed(0)}% / 输出 ${outPct.toFixed(0)}%`

  const ringWidth = Math.max(3, Math.round(size * 0.18))

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: gradient,
        flexShrink: 0,
        position: 'relative',
        transition: 'transform 0.15s ease'
      }}
      title={title}
    >
      <div
        style={{
          position: 'absolute',
          inset: ringWidth,
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
  const sessionChat = useSessionChatSafe()
  const extra = props.extra as
    | {
        model?: string
        usage?: {
          totalTokens?: number
          totalInputTokens?: number
          totalOutputTokens?: number
          cachedInputTokens?: number
        }
        parts?: import('@prizm/client-core').MessagePart[]
        memoryRefs?: import('@prizm/shared').MemoryRefs | null
        messageId?: string
      }
    | undefined
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
  const cached = usage?.cachedInputTokens ?? 0
  const cacheHitPct =
    cached > 0 && usage?.totalInputTokens ? Math.round((cached / usage.totalInputTokens) * 100) : 0
  const freshInput =
    usage?.totalInputTokens != null ? Math.max(0, usage.totalInputTokens - cached) : 0

  return (
    <div className={styles.extra}>
      <Flexbox horizontal align="center" gap={4} wrap="wrap">
        {extra?.model && <span className={styles.modelTag}>{extra.model}</span>}

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
                {cached > 0 && (
                  <>
                    <div className={styles.usagePopRow} style={{ paddingLeft: 10 }}>
                      <span
                        className={styles.usagePopLabel}
                        style={{ fontSize: 11, opacity: 0.75 }}
                      >
                        实际输入
                      </span>
                      <span className={styles.usagePopValue} style={{ fontSize: 11 }}>
                        {formatToken(freshInput)}
                      </span>
                    </div>
                    <div className={styles.usagePopRow} style={{ paddingLeft: 10 }}>
                      <span
                        className={styles.usagePopLabel}
                        style={{ fontSize: 11, opacity: 0.75 }}
                      >
                        缓存命中
                      </span>
                      <span
                        className={styles.usagePopValue}
                        style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 11 }}
                      >
                        {formatToken(cached)}
                      </span>
                    </div>
                    <div className={styles.usagePopCacheBar}>
                      <div className={styles.cacheBarTrack}>
                        <div className={styles.cacheBarFill} style={{ width: `${cacheHitPct}%` }} />
                      </div>
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--ant-color-text-quaternary)',
                          fontWeight: 500,
                          fontVariantNumeric: 'tabular-nums',
                          minWidth: 28,
                          textAlign: 'right'
                        }}
                      >
                        {cacheHitPct}%
                      </span>
                    </div>
                  </>
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
                  className={`${styles.usagePopRow} ${styles.usagePopDivider}`}
                  style={{ fontWeight: 600 }}
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
              {cacheHitPct > 0 && <span className={styles.cacheBadge}>{cacheHitPct}%</span>}
            </span>
          </Popover>
        )}

        <MemoryRefsTag
          memoryRefs={extra?.memoryRefs}
          onResolve={handleResolve}
          scope={currentScope}
        />

        {extra?.messageId && (
          <FeedbackWidget
            targetType="chat_message"
            targetId={extra.messageId}
            sessionId={sessionChat?.sessionId}
            metadata={extra?.model ? { model: extra.model } : undefined}
            variant="inline"
          />
        )}
      </Flexbox>
    </div>
  )
}
