/**
 * WorkflowDefEditorTab — 内嵌 WorkflowEditor（非弹窗）
 *
 * 直接在 Tab 内渲染 ReactFlow 编辑器，占满可用空间。
 */

import type { WorkflowDefRecord } from '@prizm/shared'
import { WorkflowEditor } from './editor'

export interface WorkflowDefEditorTabProps {
  defRecord: WorkflowDefRecord
  onSave: (name: string, yaml: string, description?: string) => Promise<void>
  onRun?: (name: string) => void
}

export function WorkflowDefEditorTab({ defRecord, onSave, onRun }: WorkflowDefEditorTabProps) {
  return (
    <div className="wfp-tab-content wfp-editor-tab">
      <WorkflowEditor defRecord={defRecord} onSave={onSave} onRun={onRun} />
    </div>
  )
}
