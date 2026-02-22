/**
 * WorkflowCreateChoice — 新建工作流时先选择一种创建方式（图 / YAML / 会话）
 * 不同时展示三种，避免双向不同步。
 */
import { memo, useCallback } from 'react'
import { Button } from 'antd'
import { GitBranch, Code2, Loader2, MessageSquare } from 'lucide-react'
import { Icon } from '@lobehub/ui'

export type WorkflowCreateMode = 'graph' | 'yaml' | 'session'

export interface WorkflowCreateChoiceProps {
  onChoose: (mode: WorkflowCreateMode) => void
  onCancel: () => void
  creatingSession?: boolean
}

const OPTIONS: { mode: WorkflowCreateMode; label: string; desc: string; icon: React.ReactNode }[] = [
  { mode: 'graph', label: '图编辑器', desc: '拖拽节点编排工作流', icon: <GitBranch size={24} /> },
  { mode: 'yaml', label: 'YAML', desc: '直接编写 YAML 定义', icon: <Code2 size={24} /> },
  { mode: 'session', label: '用对话创建', desc: '描述需求，AI 生成工作流', icon: <MessageSquare size={24} /> }
]

export const WorkflowCreateChoice = memo(function WorkflowCreateChoice({
  onChoose,
  onCancel,
  creatingSession = false
}: WorkflowCreateChoiceProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, mode: WorkflowCreateMode) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        if (mode === 'session' && creatingSession) return
        onChoose(mode)
      }
    },
    [onChoose, creatingSession]
  )

  return (
    <div className="wfp-create-choice">
      <div className="wfp-create-choice__header">
        <h2 className="wfp-create-choice__title">新建工作流</h2>
        <p className="wfp-create-choice__subtitle">请选择一种创建方式</p>
      </div>
      <div className="wfp-create-choice__options">
        {OPTIONS.map((opt) => {
          const disabled = opt.mode === 'session' && creatingSession
          return (
            <button
              key={opt.mode}
              type="button"
              className={`wfp-create-choice__card wfp-create-choice__card--${opt.mode}${disabled ? ' wfp-create-choice__card--disabled' : ''}`}
              onClick={() => !disabled && onChoose(opt.mode)}
              onKeyDown={(e) => handleKeyDown(e, opt.mode)}
              disabled={disabled}
              aria-label={`选择${opt.label}：${opt.desc}`}
              aria-busy={disabled && creatingSession}
            >
              <span className="wfp-create-choice__card-icon">{opt.icon}</span>
              <span className="wfp-create-choice__card-label">{opt.label}</span>
              <span className="wfp-create-choice__card-desc">{opt.desc}</span>
              {disabled && creatingSession && (
                <span className="wfp-create-choice__card-loading" aria-hidden>
                  <Icon icon={Loader2} size={20} className="wfp-create-choice__spinner" />
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="wfp-create-choice__footer">
        <Button type="text" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  )
})
