/**
 * WorkflowBuilderCard — Tool LLM 工作流构建器内联卡片
 *
 * 注册为 prizm_workflow_builder 的自定义渲染器。
 * 展示 Tool LLM 的流式输出、工作流预览、多轮对话微调和确认操作。
 */

import { Flexbox, Icon } from '@lobehub/ui'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  X
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Space, Tag, Typography } from 'antd'
import { createStyles } from 'antd-style'
import { registerToolRender } from '@prizm/client-core'
import type { ToolCallRecord } from '@prizm/client-core'
import { useToolLLMStore } from '../../store/toolLLMStore'
import type { ToolLLMSessionStatus } from '../../store/toolLLMStore'

const { Text, Paragraph } = Typography

const ACCENT = '#7c3aed'

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 10px;
    overflow: hidden;
    background: ${token.colorBgContainer};
  `,
  header: css`
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    &:hover { background: ${token.colorFillQuaternary}; }
  `,
  body: css`
    padding: 12px 14px;
    border-top: 1px solid ${token.colorBorderSecondary};
  `,
  preview: css`
    background: ${token.colorFillQuaternary};
    border-radius: 8px;
    padding: 10px 12px;
    font-family: 'SF Mono', 'Cascadia Code', monospace;
    font-size: 12px;
    line-height: 1.5;
    max-height: 260px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
  `,
  chatArea: css`
    margin-top: 10px;
    max-height: 200px;
    overflow-y: auto;
  `,
  msgBubble: css`
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.5;
    max-width: 85%;
  `,
  userMsg: css`
    background: ${token.colorPrimaryBg};
    align-self: flex-end;
  `,
  assistantMsg: css`
    background: ${token.colorFillSecondary};
    align-self: flex-start;
  `,
  inputRow: css`
    margin-top: 10px;
    display: flex;
    gap: 8px;
  `,
  actions: css`
    margin-top: 12px;
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  `,
  versionTag: css`
    font-size: 11px;
    opacity: 0.7;
  `,
  streaming: css`
    color: ${token.colorTextSecondary};
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-wrap;
  `
}))

function statusLabel(status: ToolLLMSessionStatus): { text: string; color: string } {
  switch (status) {
    case 'generating': return { text: '生成中…', color: 'processing' }
    case 'refining': return { text: '修改中…', color: 'processing' }
    case 'preview': return { text: '预览', color: 'purple' }
    case 'confirmed': return { text: '已确认', color: 'success' }
    case 'cancelled': return { text: '已取消', color: 'default' }
    case 'error': return { text: '错误', color: 'error' }
    default: return { text: status, color: 'default' }
  }
}

interface WorkflowBuilderCardInnerProps {
  tc: ToolCallRecord
}

const WorkflowBuilderCardInner = memo(function WorkflowBuilderCardInner({
  tc
}: WorkflowBuilderCardInnerProps) {
  const { styles } = useStyles()
  const [expanded, setExpanded] = useState(true)
  const [refineInput, setRefineInput] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  const args = useMemo(() => {
    try { return JSON.parse(tc.arguments || '{}') as Record<string, unknown> }
    catch { return {} as Record<string, unknown> }
  }, [tc.arguments])

  const resultData = useMemo(() => {
    if (!tc.result) return null
    try { return JSON.parse(tc.result) as Record<string, unknown> }
    catch { return null }
  }, [tc.result])

  const sessionId = resultData?.sessionId as string | undefined
  const session = useToolLLMStore((s) => sessionId ? s.sessions[sessionId] : undefined)
  const refine = useToolLLMStore((s) => s.refine)
  const confirm = useToolLLMStore((s) => s.confirm)
  const cancel = useToolLLMStore((s) => s.cancel)

  const isLoading = session?.status === 'generating' || session?.status === 'refining'
  const showPreview = session?.currentYaml || (resultData?.yamlContent as string)
  const previewYaml = session?.currentYaml || (resultData?.yamlContent as string) || ''
  const version = session?.versions?.length ?? (resultData?.version as number) ?? 0
  const currentStatus = session?.status ?? (tc.status === 'done' ? 'preview' : 'generating') as ToolLLMSessionStatus
  const stLabel = statusLabel(currentStatus)
  const action = args.action as string
  const intent = args.intent as string
  const workflowName = args.workflow_name as string | undefined

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session?.messages?.length, session?.streamingText])

  const handleRefine = useCallback(() => {
    if (!sessionId || !refineInput.trim()) return
    void refine(sessionId, refineInput.trim())
    setRefineInput('')
  }, [sessionId, refineInput, refine])

  const handleConfirm = useCallback(() => {
    if (!sessionId) return
    void confirm(sessionId, workflowName)
  }, [sessionId, workflowName, confirm])

  const handleCancel = useCallback(() => {
    if (!sessionId) return
    cancel(sessionId)
  }, [sessionId, cancel])

  const summary = action === 'edit'
    ? `编辑工作流: ${workflowName ?? ''}` 
    : `创建工作流`

  if (!tc.result && tc.status !== 'done') {
    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <div className="tool-card__icon-wrap" style={{ '--tc-accent': ACCENT } as never}>
            <Icon icon={Sparkles} size={15} />
          </div>
          <Flexbox flex={1} gap={2}>
            <span className="tool-card__name">工作流构建器</span>
            <span className="tool-card__desc">{summary}</span>
            <span className="tool-card__status-text">准备中…</span>
          </Flexbox>
          <Loader2 size={14} className="tool-card__spinner" />
        </div>
      </div>
    )
  }

  return (
    <div className={styles.card}>
      <div className={styles.header} onClick={() => setExpanded((v) => !v)}>
        <div className="tool-card__icon-wrap" style={{ '--tc-accent': ACCENT } as never}>
          <Icon icon={Sparkles} size={15} />
        </div>
        <Flexbox flex={1} gap={2} horizontal align="center">
          <Text strong style={{ fontSize: 13 }}>工作流构建器</Text>
          <Tag color={stLabel.color} style={{ marginLeft: 6 }}>{stLabel.text}</Tag>
          {version > 0 && <span className={styles.versionTag}>v{version}</span>}
        </Flexbox>
        <Icon icon={expanded ? ChevronUp : ChevronDown} size={14} />
      </div>

      {expanded && (
        <div className={styles.body}>
          {/* Intent summary */}
          <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
            {intent}
          </Paragraph>

          {/* YAML preview */}
          {showPreview && (
            <div className={styles.preview}>{previewYaml}</div>
          )}

          {/* Streaming text */}
          {session?.streamingText && (
            <div className={styles.streaming} style={{ marginTop: 8 }}>
              {session.streamingText}
            </div>
          )}

          {/* Chat history */}
          {session?.messages && session.messages.length > 1 && (
            <div className={styles.chatArea}>
              <Flexbox gap={6}>
                {session.messages.slice(1).map((msg, i) => (
                  <div
                    key={i}
                    className={`${styles.msgBubble} ${msg.role === 'user' ? styles.userMsg : styles.assistantMsg}`}
                  >
                    {msg.content}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </Flexbox>
            </div>
          )}

          {/* Refine input */}
          {currentStatus === 'preview' && sessionId && (
            <div className={styles.inputRow}>
              <Input
                size="small"
                placeholder="继续修改…"
                value={refineInput}
                onChange={(e) => setRefineInput(e.target.value)}
                onPressEnter={handleRefine}
                disabled={isLoading}
                style={{ flex: 1 }}
              />
              <Button
                size="small"
                type="primary"
                icon={<Icon icon={Send} size={12} />}
                onClick={handleRefine}
                disabled={!refineInput.trim() || isLoading}
              />
            </div>
          )}

          {/* Error */}
          {session?.error && (
            <Paragraph type="danger" style={{ fontSize: 12, marginTop: 8 }}>
              {session.error}
            </Paragraph>
          )}

          {/* Action buttons */}
          {currentStatus === 'preview' && sessionId && (
            <div className={styles.actions}>
              <Button
                size="small"
                danger
                icon={<Icon icon={X} size={12} />}
                onClick={handleCancel}
              >
                取消
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<Icon icon={Check} size={12} />}
                onClick={handleConfirm}
                style={{ background: ACCENT, borderColor: ACCENT }}
              >
                确认注册
              </Button>
            </div>
          )}

          {/* Confirmed */}
          {currentStatus === 'confirmed' && (
            <div className={styles.actions}>
              <Tag color="success" icon={<Icon icon={Check} size={12} />}>
                工作流已注册
              </Tag>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

registerToolRender('prizm_workflow_builder', (props) => (
  <WorkflowBuilderCardInner tc={props.tc} />
))

export { WorkflowBuilderCardInner as WorkflowBuilderCard }
