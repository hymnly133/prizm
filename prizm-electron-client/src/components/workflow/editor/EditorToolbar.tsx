/**
 * EditorToolbar — 工作流编辑器顶部工具栏
 *
 * 添加步骤、自动布局、撤销/重做、保存、运行、YAML 预览切换
 */

import { memo, useCallback } from 'react'
import { Button, Dropdown, Space, Tooltip, Tag } from 'antd'
import type { MenuProps } from 'antd'
import {
  Bot,
  ShieldCheck,
  Shuffle,
  LayoutGrid,
  Undo2,
  Redo2,
  Save,
  Play,
  Code2,
  Trash2,
  Copy,
  Plus,
  LogIn,
  LogOut
} from 'lucide-react'
import { ActionIcon } from '@lobehub/ui'
import type { WorkflowStepType } from '@prizm/shared'
import { useWorkflowEditorStore } from '../../../store/workflowEditorStore'
import { INPUT_NODE_ID, OUTPUT_NODE_ID } from './workflowEditorUtils'

export interface EditorToolbarProps {
  onSave: () => void
  onRun?: () => void
  saving?: boolean
  yamlMode: boolean
  onToggleYaml: () => void
}

export const EditorToolbar = memo(function EditorToolbar({
  onSave,
  onRun,
  saving,
  yamlMode,
  onToggleYaml
}: EditorToolbarProps) {
  const addStep = useWorkflowEditorStore((s) => s.addStep)
  const addIONode = useWorkflowEditorStore((s) => s.addIONode)
  const deleteSelected = useWorkflowEditorStore((s) => s.deleteSelected)
  const duplicateSelected = useWorkflowEditorStore((s) => s.duplicateSelected)
  const autoLayout = useWorkflowEditorStore((s) => s.autoLayout)
  const undo = useWorkflowEditorStore((s) => s.undo)
  const redo = useWorkflowEditorStore((s) => s.redo)
  const selectedNodeId = useWorkflowEditorStore((s) => s.selectedNodeId)
  const dirty = useWorkflowEditorStore((s) => s.dirty)
  const undoStack = useWorkflowEditorStore((s) => s.undoStack)
  const redoStack = useWorkflowEditorStore((s) => s.redoStack)
  const workflowName = useWorkflowEditorStore((s) => s.workflowName)
  const nodes = useWorkflowEditorStore((s) => s.nodes)

  const hasInputNode = nodes.some((n) => n.id === INPUT_NODE_ID)
  const hasOutputNode = nodes.some((n) => n.id === OUTPUT_NODE_ID)

  const addItems: MenuProps['items'] = [
    {
      key: 'agent',
      icon: <Bot size={14} />,
      label: 'Agent 步骤',
      onClick: () => addStep('agent')
    },
    {
      key: 'approve',
      icon: <ShieldCheck size={14} />,
      label: '审批步骤',
      onClick: () => addStep('approve')
    },
    {
      key: 'transform',
      icon: <Shuffle size={14} />,
      label: '变换步骤',
      onClick: () => addStep('transform')
    },
    { type: 'divider' },
    {
      key: 'input',
      icon: <LogIn size={14} />,
      label: '输入参数节点',
      disabled: hasInputNode,
      onClick: () => addIONode('input')
    },
    {
      key: 'output',
      icon: <LogOut size={14} />,
      label: '输出结果节点',
      disabled: hasOutputNode,
      onClick: () => addIONode('output')
    }
  ]

  return (
    <div className="wfe-toolbar">
      <div className="wfe-toolbar__left">
        <Dropdown menu={{ items: addItems }} trigger={['click']}>
          <Button size="small" type="primary" icon={<Plus size={14} />}>
            添加步骤
          </Button>
        </Dropdown>

        <div className="wfe-toolbar__divider" />

        <Tooltip title="撤销 (Ctrl+Z)">
          <ActionIcon
            icon={Undo2}
            size="small"
            onClick={undo}
            disabled={undoStack.length === 0}
          />
        </Tooltip>
        <Tooltip title="重做 (Ctrl+Shift+Z)">
          <ActionIcon
            icon={Redo2}
            size="small"
            onClick={redo}
            disabled={redoStack.length === 0}
          />
        </Tooltip>

        <div className="wfe-toolbar__divider" />

        <Tooltip title="自动布局">
          <ActionIcon icon={LayoutGrid} size="small" onClick={autoLayout} />
        </Tooltip>

        {selectedNodeId && (
          <>
            <Tooltip title="复制节点">
              <ActionIcon icon={Copy} size="small" onClick={duplicateSelected} />
            </Tooltip>
            <Tooltip title="删除节点 (Delete)">
              <ActionIcon icon={Trash2} size="small" onClick={deleteSelected} />
            </Tooltip>
          </>
        )}
      </div>

      <div className="wfe-toolbar__center">
        <Tooltip title="连线表示执行顺序与数据依赖">
          <Tag color="default" style={{ marginRight: 8 }}>串行流水线</Tag>
        </Tooltip>
        {workflowName && (
          <span className="wfe-toolbar__name">{workflowName}</span>
        )}
        {dirty && <Tag color="warning" style={{ marginLeft: 6 }}>未保存</Tag>}
      </div>

      <div className="wfe-toolbar__right">
        <Tooltip title={yamlMode ? '切换到可视化' : '切换到 YAML'}>
          <ActionIcon
            icon={Code2}
            size="small"
            active={yamlMode}
            onClick={onToggleYaml}
          />
        </Tooltip>

        {onRun && (
          <Tooltip title="运行工作流">
            <ActionIcon icon={Play} size="small" onClick={onRun} />
          </Tooltip>
        )}

        <Button
          size="small"
          type="primary"
          icon={<Save size={14} />}
          loading={saving}
          onClick={onSave}
          disabled={!dirty && !saving}
        >
          保存
        </Button>
      </div>
    </div>
  )
})
