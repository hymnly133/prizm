/**
 * WorkflowRunDetailPanel — 运行详情面板
 *
 * 面包屑返回、审批提示、Pipeline 可视化、总输入/总输出视图、每步 I/O 卡片。
 * 步骤会话：若传入 onOpenStepSession 则在侧边栏标签打开；否则内联展示（兼容）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Tag, Button, Space, Alert, Typography, Collapse, Progress } from 'antd'
import { Icon } from '@lobehub/ui'
import {
  FolderOpen,
  MessageSquare,
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
  ListOrdered
} from 'lucide-react'
import { ArrowLeft, PauseCircle, RefreshCw, XCircle } from 'lucide-react'
import type { WorkflowRun, WorkflowStepResult } from '@prizm/shared'
import { WorkflowPipelineView } from './WorkflowPipelineView'
import {
  WORKFLOW_RUN_STATUS_META,
  getWorkflowRunStatusTagColor,
  WorkflowErrorDetailBlock
} from './workflowRunStatus'
import { WorkflowWorkspacePanel } from './WorkflowWorkspacePanel'
import { useWorkflowStore } from '../../store/workflowStore'
import { useAgentSessionStore } from '../../store/agentSessionStore'
import { useScope } from '../../hooks/useScope'
import { SessionChatProvider } from '../../context/SessionChatContext'
import { SessionChatPanel } from '../agent/SessionChatPanel'
import { EmptyState } from '../ui/EmptyState'
import { LoadingPlaceholder } from '../ui/LoadingPlaceholder'
import { SectionHeader } from '../ui/SectionHeader'
import { ContentCard, ContentCardHeader, ContentCardBody } from '../ui/ContentCard'
import { PrizmMarkdown } from '../agent/PrizmMarkdown'
import { FeedbackWidget } from '../ui/FeedbackWidget'

const { Text } = Typography

/** 判断字符串是否像 Markdown（可交给 PrizmMarkdown 渲染） */
function looksLikeMarkdown(s: string): boolean {
  const t = s.trim()
  return (
    t.startsWith('#') ||
    /^\s*[-*]\s/m.test(t) ||
    /\[.+\]\(.+\)/.test(t) ||
    /```[\s\S]*```/.test(t) ||
    /^\s*>\s/m.test(t)
  )
}

export interface WorkflowRunDetailPanelProps {
  runId: string
  defName?: string
  onGoBack: () => void
  /** 可选：点击「工作流中心」时跳转到总览（不清定义只返回到定义详情时用 onGoBack） */
  onGoToOverview?: () => void
  onLoadSession?: (sessionId: string) => void
  onRerun?: (workflowName: string, args?: Record<string, unknown>) => void
  /** 在侧边栏打开步骤会话（与主内容区+侧边 tab 架构对齐）；不传则内联展示 */
  onOpenStepSession?: (sessionId: string, label: string) => void
  /** 在管理会话中打开此次 run（预填 @run 引用） */
  onOpenRunInManagementSession?: (workflowName: string, runId: string, runLabel: string) => void
}

function WorkflowRunDetailPanel({
  runId,
  defName,
  onGoBack,
  onGoToOverview,
  onLoadSession,
  onRerun,
  onOpenStepSession,
  onOpenRunInManagementSession
}: WorkflowRunDetailPanelProps) {
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const [inlineSessionId, setInlineSessionId] = useState<string | null>(null)
  const [inlineStepId, setInlineStepId] = useState<string | null>(null)
  const getRunDetail = useWorkflowStore((s) => s.getRunDetail)
  const resumeWorkflow = useWorkflowStore((s) => s.resumeWorkflow)
  const cancelRun = useWorkflowStore((s) => s.cancelRun)
  const storeRuns = useWorkflowStore((s) => s.runs)
  const loadSession = useAgentSessionStore((s) => s.loadSession)
  const { currentScope } = useScope()

  useEffect(() => {
    const storeRun = storeRuns.find((r) => r.id === runId)
    if (storeRun) setRun(storeRun)
    void getRunDetail(runId).then((detail) => {
      if (detail) setRun(detail)
    })
  }, [runId, getRunDetail, storeRuns])

  // run 为 running 时轮询详情，以便后端写入当前步骤 sessionId 后能立即显示「查看会话」
  useEffect(() => {
    if (!run || (run.status !== 'running' && run.status !== 'pending')) return
    const t = setInterval(() => {
      void getRunDetail(runId).then((detail) => {
        if (detail) setRun(detail)
      })
    }, 2000)
    return () => clearInterval(t)
  }, [runId, run?.id, run?.status, getRunDetail])

  useEffect(() => {
    setInlineSessionId(null)
    setInlineStepId(null)
  }, [runId])

  const handleApprove = useCallback(
    (token: string, approved: boolean) => {
      void resumeWorkflow(token, approved)
    },
    [resumeWorkflow]
  )

  const handleViewSession = useCallback(
    async (sessionId: string, stepId?: string) => {
      if (onOpenStepSession) {
        if (currentScope) await loadSession(sessionId, currentScope)
        const label = stepId ? `步骤会话 — ${stepId}` : '步骤会话'
        onOpenStepSession(sessionId, label)
      } else {
        if (currentScope) void loadSession(sessionId, currentScope)
        setInlineSessionId(sessionId)
        setInlineStepId(stepId ?? null)
      }
    },
    [currentScope, loadSession, onOpenStepSession]
  )

  if (!run) {
    return (
      <div className="wfp-run-detail wfp-fade-appear">
        <nav className="wfp-breadcrumb" aria-label="面包屑">
          <button type="button" className="wfp-breadcrumb__link" onClick={onGoBack}>
            <Icon icon={ArrowLeft} size={14} /> 返回
          </button>
        </nav>
        <LoadingPlaceholder text="加载运行详情…" />
      </div>
    )
  }

  const statusInfo = WORKFLOW_RUN_STATUS_META[run.status] ?? WORKFLOW_RUN_STATUS_META.pending
  const steps: WorkflowStepResult[] = Object.values(run.stepResults)
  const totalDuration: number = steps.reduce(
    (sum, s: WorkflowStepResult) => sum + (s.durationMs ?? 0),
    0
  )
  const isActive = run.status === 'running' || run.status === 'pending' || run.status === 'paused'

  return (
    <div className="wfp-run-detail wfp-fade-appear">
      {/* Breadcrumb */}
      <nav className="wfp-breadcrumb" aria-label="面包屑">
        {onGoToOverview && (
          <>
            <button type="button" className="wfp-breadcrumb__link" onClick={onGoToOverview}>
              工作流中心
            </button>
            <span className="wfp-breadcrumb__sep" aria-hidden>
              ›
            </span>
          </>
        )}
        <button type="button" className="wfp-breadcrumb__link" onClick={onGoBack}>
          {defName ?? run.workflowName}
        </button>
        <span className="wfp-breadcrumb__sep" aria-hidden>
          ›
        </span>
        <span className="wfp-breadcrumb__current">运行 #{run.id.slice(0, 8)}</span>
      </nav>

      {/* Header */}
      <div className="wfp-run-header">
        <div>
          <h3 className="wfp-run-header__title">
            {run.workflowName}
            <Tag
              icon={statusInfo.icon}
              color={statusInfo.color}
              style={{ marginLeft: 8, verticalAlign: 'middle' }}
            >
              {statusInfo.label}
            </Tag>
          </h3>
        </div>
        <Space>
          {isActive && (
            <Button danger onClick={() => void cancelRun(run.id)}>
              取消运行
            </Button>
          )}
          {onRerun && run.status !== 'running' && (
            <Button
              icon={<Icon icon={RefreshCw} size={14} />}
              onClick={() => onRerun(run.workflowName, run.args)}
            >
              重新运行
            </Button>
          )}
          {onOpenRunInManagementSession && (
            <Button
              icon={<Icon icon={MessageSquare} size={16} />}
              onClick={() =>
                onOpenRunInManagementSession(
                  run.workflowName,
                  run.id,
                  `${run.workflowName} #${run.id.slice(0, 8)}`
                )
              }
            >
              在管理会话中打开此次 run
            </Button>
          )}
        </Space>
      </div>

      {/* Approval alert */}
      {run.status === 'paused' && run.resumeToken && (
        <Alert
          type="warning"
          showIcon
          icon={<Icon icon={PauseCircle} size={16} />}
          style={{ marginBottom: 16 }}
          message="工作流等待审批"
          description={
            <Space>
              <Button type="primary" onClick={() => handleApprove(run.resumeToken!, true)}>
                批准并继续
              </Button>
              <Button danger onClick={() => handleApprove(run.resumeToken!, false)}>
                拒绝
              </Button>
            </Space>
          }
        />
      )}

      {/* Pipeline */}
      <WorkflowPipelineView run={run} onApprove={handleApprove} />

      {/* 总输入 / 总输出 视图 */}
      <RunSummaryCard run={run} steps={steps} totalDuration={totalDuration} />

      {/* Run 级错误 */}
      {run.error && (
        <Alert
          type="error"
          showIcon
          icon={<Icon icon={XCircle} size={16} />}
          style={{ marginTop: 16 }}
          message={run.error}
          description={
            run.errorDetail ? <WorkflowErrorDetailBlock content={run.errorDetail} /> : undefined
          }
        />
      )}

      {/* 步骤详情：每步输入/输出 */}
      <SectionHeader
        icon={ListOrdered}
        title="步骤详情"
        count={steps.length}
        className="wfp-run-detail__section"
      />
      {steps.length === 0 ? (
        <EmptyState description="暂无步骤结果" />
      ) : (
        <div className="wfp-step-cards">
          {steps.map((step, index) => (
            <StepCard
              key={step.stepId}
              step={step}
              index={index}
              totalSteps={steps.length}
              maxDuration={totalDuration}
              onViewSession={handleViewSession}
              activeSessionId={onOpenStepSession ? null : inlineSessionId}
            />
          ))}
        </div>
      )}

      {/* Run Workspace */}
      <Collapse
        ghost
        style={{ marginTop: 16 }}
        items={[
          {
            key: 'workspace',
            label: (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon icon={FolderOpen} size={14} />
                Run 工作空间
              </span>
            ),
            children: (
              <WorkflowWorkspacePanel
                workflowName={run.workflowName}
                mode="run-detail"
                activeRunId={run.id}
              />
            )
          }
        ]}
      />

      {/* Inline session viewer（仅当未提供 onOpenStepSession 时展示） */}
      {!onOpenStepSession && inlineSessionId && currentScope && (
        <div className="wfp-inline-session">
          <div className="wfp-inline-session__header">
            <Space size={8}>
              <Icon icon={MessageSquare} size={14} />
              <Text strong style={{ fontSize: 13 }}>
                步骤会话{inlineStepId ? ` — ${inlineStepId}` : ''}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {inlineSessionId.slice(0, 12)}…
              </Text>
            </Space>
            <Button
              type="text"
              size="small"
              icon={<Icon icon={X} size={14} />}
              onClick={() => {
                setInlineSessionId(null)
                setInlineStepId(null)
              }}
            />
          </div>
          <div className="wfp-inline-session__body">
            <SessionChatProvider sessionId={inlineSessionId} scope={currentScope} active>
              <SessionChatPanel />
            </SessionChatProvider>
          </div>
        </div>
      )}
    </div>
  )
}

export { WorkflowRunDetailPanel }

/** 总输入（运行参数）+ 总输出（最后一步或各步摘要） */
function RunSummaryCard({
  run,
  steps,
  totalDuration
}: {
  run: WorkflowRun
  steps: WorkflowStepResult[]
  totalDuration: number
}) {
  const hasArgs = run.args && Object.keys(run.args).length > 0
  const lastOutput = steps.length > 0 ? steps[steps.length - 1]?.output : undefined
  const hasAnyOutput = steps.some((s) => s.output || s.structuredData)

  const summaryItems = useMemo(() => {
    return [
      { label: '运行 ID', value: run.id, copyable: true },
      { label: '触发方式', value: run.triggerType ?? 'manual' },
      { label: '创建时间', value: new Date(run.createdAt).toLocaleString() },
      { label: '总耗时', value: totalDuration > 0 ? `${(totalDuration / 1000).toFixed(1)}s` : '-' }
    ]
  }, [run.id, run.triggerType, run.createdAt, totalDuration])

  return (
    <div className="wfp-run-summary">
      <div className="wfp-run-summary__meta">
        {summaryItems.map(({ label, value, copyable }) => (
          <div key={label} className="wfp-run-summary__meta-item">
            <span className="wfp-run-summary__meta-label">{label}</span>
            {copyable ? (
              <Text copyable className="wfp-run-summary__meta-value">
                {value}
              </Text>
            ) : (
              <span className="wfp-run-summary__meta-value">{value}</span>
            )}
          </div>
        ))}
      </div>

      <div className="wfp-run-summary__io">
        {/* 总输入 */}
        <ContentCard variant="subtle" hoverable={false} className="wfp-run-summary__card">
          <ContentCardHeader>
            <Space size={6}>
              <Icon icon={ArrowDownToLine} size={14} />
              <span>总输入（运行参数）</span>
            </Space>
          </ContentCardHeader>
          <ContentCardBody>
            {hasArgs ? (
              <pre className="wfp-run-pre wfp-run-pre--compact">
                {JSON.stringify(run.args, null, 2)}
              </pre>
            ) : (
              <Text type="secondary">无参数</Text>
            )}
          </ContentCardBody>
        </ContentCard>

        {/* 总输出 */}
        <ContentCard variant="subtle" hoverable={false} className="wfp-run-summary__card">
          <ContentCardHeader>
            <Space size={6}>
              <Icon icon={ArrowUpFromLine} size={14} />
              <span>总输出</span>
            </Space>
          </ContentCardHeader>
          <ContentCardBody>
            {!hasAnyOutput ? (
              <EmptyState description="暂无输出" />
            ) : (
              <div className="wfp-run-summary__output">
                {lastOutput && <PrizmMarkdown variant="chat">{lastOutput}</PrizmMarkdown>}
                {steps.length > 1 && (
                  <Collapse
                    ghost
                    size="small"
                    style={{ marginTop: lastOutput ? 8 : 0 }}
                    items={[
                      {
                        key: 'all',
                        label: `查看全部 ${steps.length} 步输出`,
                        children: (
                          <div className="wfp-run-summary__steps-output">
                            {steps.map((s) => (
                              <div key={s.stepId} className="wfp-run-summary__step-output-item">
                                <Text strong style={{ fontSize: 12 }}>
                                  {s.stepId}
                                </Text>
                                {s.output ? (
                                  <div className="wfp-run-summary__step-output-body">
                                    <PrizmMarkdown variant="chat">{s.output}</PrizmMarkdown>
                                  </div>
                                ) : (
                                  <Text type="secondary" style={{ fontSize: 12 }}>
                                    —
                                  </Text>
                                )}
                              </div>
                            ))}
                          </div>
                        )
                      }
                    ]}
                  />
                )}
                {!lastOutput && steps.length <= 1 && (
                  <EmptyState description="运行中或暂无最终输出" />
                )}
              </div>
            )}
          </ContentCardBody>
        </ContentCard>
      </div>

      {(run.status === 'completed' || run.status === 'failed') && (
        <div style={{ marginTop: 12 }}>
          <FeedbackWidget
            targetType="workflow_run"
            targetId={run.id}
            metadata={{ workflowName: run.workflowName, status: run.status }}
            variant="card"
          />
        </div>
      )}
    </div>
  )
}

/** 步骤结果折叠：单一「结果」区块，内部按需区分主结果/结构化数据 */
function StepResultCollapse({
  step,
  looksLikeMarkdown
}: {
  step: WorkflowStepResult
  looksLikeMarkdown: (s: string) => boolean
}) {
  const { output, structuredData } = step
  const onlyOutput = output && !structuredData
  const onlyStructured = structuredData && !output
  let showBothAsTwo = false
  if (output && structuredData) {
    try {
      const parsed = JSON.parse(structuredData) as Record<string, unknown>
      const keys = Object.keys(parsed)
      if (keys.length === 1 && keys[0] === 'output' && String(parsed.output) === output) {
        showBothAsTwo = false
      } else {
        showBothAsTwo = true
      }
    } catch {
      showBothAsTwo = true
    }
  }

  const content = (
    <div className="wfp-step-card__output-inner">
      {(onlyOutput || (output && !showBothAsTwo)) && (
        <div className="wfp-step-card__output">
          {showBothAsTwo && (
            <Text type="secondary" className="wfp-step-card__output-label">
              主结果
            </Text>
          )}
          <div className="wfp-step-card__output-content">
            {output &&
              (looksLikeMarkdown(output) ? (
                <PrizmMarkdown variant="chat">{output}</PrizmMarkdown>
              ) : (
                <pre className="wfp-run-pre wfp-run-pre--compact">{output}</pre>
              ))}
          </div>
        </div>
      )}
      {(onlyStructured || (structuredData && showBothAsTwo)) && (
        <div className="wfp-step-card__structured">
          {showBothAsTwo && (
            <Text type="secondary" className="wfp-step-card__output-label">
              结构化数据
            </Text>
          )}
          <pre className="wfp-run-pre wfp-run-pre--compact">{structuredData}</pre>
        </div>
      )}
    </div>
  )

  return (
    <Collapse
      ghost
      size="small"
      defaultActiveKey={[]}
      className="wfp-step-card__output-collapse"
      items={[
        {
          key: 'result',
          label: <span className="wfp-step-card__output-collapse-label">结果</span>,
          children: content
        }
      ]}
    />
  )
}

/** 单步卡片：输入/输出、错误、审批、会话链接 */
function StepCard({
  step,
  index,
  totalSteps,
  maxDuration,
  onViewSession,
  activeSessionId
}: {
  step: WorkflowStepResult
  index: number
  totalSteps: number
  maxDuration: number
  onViewSession?: (sessionId: string, stepId?: string) => void
  activeSessionId?: string | null
}) {
  const duration = step.durationMs ? `${(step.durationMs / 1000).toFixed(1)}s` : ''
  const pct =
    maxDuration > 0 && step.durationMs ? Math.round((step.durationMs / maxDuration) * 100) : 0
  const isViewing = step.sessionId != null && step.sessionId === activeSessionId

  return (
    <ContentCard variant="default" hoverable={false} className="wfp-step-card">
      <ContentCardHeader className="wfp-step-card__header">
        <div className="wfp-step-card__title-row">
          <span className="wfp-step-card__step-index">#{index + 1}</span>
          <Text strong className="wfp-step-card__step-id">
            {step.stepId}
          </Text>
          <Tag color={getWorkflowRunStatusTagColor(step.status)} className="wfp-step-card__tag">
            {step.status}
          </Tag>
          {duration && (
            <Text type="secondary" className="wfp-step-card__duration">
              {duration}
            </Text>
          )}
          {step.sessionId && onViewSession && (
            <Button
              type="link"
              size="small"
              className={`wfp-step-card__session-btn${
                isViewing ? ' wfp-step-card__session-btn--active' : ''
              }`}
              onClick={() => onViewSession(step.sessionId!, step.stepId)}
            >
              {isViewing ? '正在查看' : '查看会话'}
            </Button>
          )}
        </div>
        {pct > 0 && (
          <Progress
            percent={pct}
            size="small"
            showInfo={false}
            strokeColor={step.status === 'failed' ? 'var(--ant-color-error)' : undefined}
            className="wfp-step-card__progress"
          />
        )}
      </ContentCardHeader>
      <ContentCardBody className="wfp-step-card__body">
        {step.error && (
          <div className="wfp-step-card__error">
            <Text type="danger">{step.error}</Text>
            {step.errorDetail && <WorkflowErrorDetailBlock content={step.errorDetail} compact />}
          </div>
        )}
        {step.approved !== undefined && (
          <Tag color={step.approved ? 'green' : 'red'} className="wfp-step-card__approve-tag">
            {step.approved ? '已批准' : '已拒绝'}
          </Tag>
        )}
        {(step.output || step.structuredData) && (
          <StepResultCollapse step={step} looksLikeMarkdown={looksLikeMarkdown} />
        )}
      </ContentCardBody>
    </ContentCard>
  )
}
