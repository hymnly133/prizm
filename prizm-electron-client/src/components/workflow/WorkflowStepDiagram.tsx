/**
 * WorkflowStepDiagram — 只读步骤流程图可视化
 *
 * 水平布局展示工作流定义中各步骤类型、连接关系。
 * 当步骤超过阈值时自动切换为垂直布局。
 */

import { Fragment } from 'react'
import { ArrowLeftRight, Bot, CheckSquare } from 'lucide-react'
import type { WorkflowStepDef } from '@prizm/shared'

const MAX_HORIZONTAL = 8

const STEP_TYPE_ICON: Record<string, React.ReactNode> = {
  agent: <Bot size={20} />,
  approve: <CheckSquare size={20} />,
  transform: <ArrowLeftRight size={20} />
}

const STEP_TYPE_LABEL: Record<string, string> = {
  agent: 'Agent',
  approve: '审批',
  transform: '变换'
}

export interface WorkflowStepDiagramProps {
  steps: WorkflowStepDef[]
  compact?: boolean
}

export function WorkflowStepDiagram({ steps, compact }: WorkflowStepDiagramProps) {
  const isVertical = steps.length > MAX_HORIZONTAL

  return (
    <div className={`wfp-step-diagram${isVertical ? ' wfp-step-diagram--vertical' : ''}`}>
      {steps.map((step, i) => (
        <Fragment key={step.id}>
          {i > 0 && (
            <div className="wfp-step-diagram__connector">
              <div className="wfp-step-diagram__connector-line" />
            </div>
          )}
          <div className="wfp-step-diagram__node">
            <div className={`wfp-step-diagram__icon wfp-step-diagram__icon--${step.type}`}>
              {STEP_TYPE_ICON[step.type] ?? STEP_TYPE_ICON.agent}
            </div>
            {!compact && (
              <>
                <div className="wfp-step-diagram__label">{step.id}</div>
                <div className="wfp-step-diagram__type">
                  {STEP_TYPE_LABEL[step.type] ?? step.type}
                </div>
              </>
            )}
          </div>
        </Fragment>
      ))}
    </div>
  )
}
