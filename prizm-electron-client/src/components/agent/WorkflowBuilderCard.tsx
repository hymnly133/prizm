/**
 * WorkflowBuilderCard — 工作流管理工具结果卡片
 *
 * 为 workflow-management-create-workflow / workflow-management-update-workflow 工具调用
 * 提供内联结果展示（成功消息、工作流名称等）。工作流管理会话走通用 Agent 聊天，无独立 tool-llm 流。
 */

import { Flexbox, Icon } from '@lobehub/ui'
import { CheckCircle2, XCircle } from 'lucide-react'
import { memo, useMemo } from 'react'
import { createStyles } from 'antd-style'
import { registerToolRender } from '@prizm/client-core'
import type { ToolCallRecord } from '@prizm/client-core'
import {
  WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW,
  WORKFLOW_MANAGEMENT_TOOL_UPDATE_WORKFLOW
} from '@prizm/shared'

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
  `,
  body: css`
    padding: 12px 14px;
    border-top: 1px solid ${token.colorBorderSecondary};
    font-size: 13px;
    line-height: 1.5;
  `,
  success: css`
    color: ${token.colorSuccess};
  `,
  error: css`
    color: ${token.colorError};
  `
}))

interface WorkflowManagementResultCardProps {
  tc: ToolCallRecord
}

function parseResult(tc: ToolCallRecord): { success: boolean; message?: string; name?: string; error?: string } | null {
  if (!tc.result) return null
  try {
    const data = JSON.parse(tc.result) as Record<string, unknown>
    if (data.success === true) {
      return {
        success: true,
        message: typeof data.message === 'string' ? data.message : undefined,
        name: typeof data.name === 'string' ? data.name : undefined
      }
    }
    return {
      success: false,
      error: typeof data.text === 'string' ? data.text : (data.error as string) ?? String(data)
    }
  } catch {
    return { success: false, error: tc.result }
  }
}

const WorkflowManagementResultCard = memo(function WorkflowManagementResultCard({
  tc
}: WorkflowManagementResultCardProps) {
  const { styles } = useStyles()
  const result = useMemo(() => parseResult(tc), [tc.result])
  const isCreate = tc.name === WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW

  if (!result) {
    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <span className="tool-card__name">
            {isCreate ? '创建工作流' : '更新工作流'}
          </span>
          <span className="tool-card__status-text">执行中…</span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div
          className="tool-card__icon-wrap"
          style={
            result.success
              ? ({ '--tc-accent': 'var(--ant-color-success)' } as React.CSSProperties)
              : ({ '--tc-accent': 'var(--ant-color-error)' } as React.CSSProperties)
          }
        >
          <Icon icon={result.success ? CheckCircle2 : XCircle} size={15} />
        </div>
        <Flexbox flex={1} gap={2}>
          <span className="tool-card__name">
            {isCreate ? '创建工作流' : '更新工作流'}
            {result.name ? `: ${result.name}` : ''}
          </span>
          <span className={result.success ? styles.success : styles.error}>
            {result.success ? result.message ?? '完成' : result.error}
          </span>
        </Flexbox>
      </div>
      {result.success && result.message && (
        <div className={styles.body}>{result.message}</div>
      )}
    </div>
  )
})

registerToolRender(WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW, (props) => (
  <WorkflowManagementResultCard tc={props.tc} />
))
registerToolRender(WORKFLOW_MANAGEMENT_TOOL_UPDATE_WORKFLOW, (props) => (
  <WorkflowManagementResultCard tc={props.tc} />
))

export { WorkflowManagementResultCard as WorkflowBuilderCard }
