/**
 * WorkflowDefDetail — 定义详情主面板
 *
 * Header（名称 + 操作按钮）+ 5 Tab（总览/运行/编辑器/工作空间/YAML）
 */

import { useMemo, useCallback, useState } from 'react'
import { Button, Popconfirm, Modal, message, Space, Input as AntInput, Switch, Typography, Tag } from 'antd'
import { Flexbox, Input } from '@lobehub/ui'
import { Icon } from '@lobehub/ui'
import { Segmented } from '../ui/Segmented'
import { Database, Workflow } from 'lucide-react'
import {
  PlayCircleOutlined,
  DeleteOutlined,
  CopyOutlined,
  ExportOutlined,
  CodeOutlined,
  FormOutlined
} from '@ant-design/icons'
import yaml from 'js-yaml'
import type { WorkflowDefRecord, WorkflowRun, WorkflowDef, WorkflowWorkspaceMode } from '@prizm/shared'
import type { WorkflowPageTab } from '../../hooks/useWorkflowPageState'
import { WorkflowDefOverviewTab } from './WorkflowDefOverviewTab'
import { WorkflowDefRunsTab } from './WorkflowDefRunsTab'
import { WorkflowDefEditorTab } from './WorkflowDefEditorTab'
import { WorkflowWorkspacePanel } from './WorkflowWorkspacePanel'

const { Text } = Typography

export interface WorkflowDefDetailProps {
  defRecord: WorkflowDefRecord
  runs: WorkflowRun[]
  loading?: boolean
  activeTab: WorkflowPageTab
  onTabChange: (tab: WorkflowPageTab) => void
  onSelectRun: (runId: string) => void
  onCancelRun: (runId: string) => void
  onRefreshRuns: () => void
  onRunWorkflow: (name: string, args?: Record<string, unknown>) => void
  onSaveDef: (name: string, yaml: string, description?: string) => Promise<void>
  onDeleteDef: (defId: string) => void
}

export function WorkflowDefDetail({
  defRecord,
  runs,
  loading,
  activeTab,
  onTabChange,
  onSelectRun,
  onCancelRun,
  onRefreshRuns,
  onRunWorkflow,
  onSaveDef,
  onDeleteDef
}: WorkflowDefDetailProps) {
  const [showRunModal, setShowRunModal] = useState(false)
  const [argsInput, setArgsInput] = useState('')
  const [formFields, setFormFields] = useState<Record<string, string>>({})
  const [useJsonMode, setUseJsonMode] = useState(false)

  const parsedDef = useMemo<WorkflowDef | null>(() => {
    if (!defRecord.yamlContent) return null
    try {
      const raw = yaml.load(defRecord.yamlContent)
      if (!raw || typeof raw !== 'object') return null
      return raw as WorkflowDef
    } catch {
      return null
    }
  }, [defRecord.yamlContent])

  const defRuns = useMemo(
    () => runs.filter((r) => r.workflowName === defRecord.name),
    [runs, defRecord.name]
  )

  /** Structured arg info: key, description, default value */
  const argsInfo = useMemo<Array<{ key: string; description?: string; defaultValue?: string }> | null>(() => {
    if (!defRecord.yamlContent) return null
    const pattern = /\$args\.([a-zA-Z_][a-zA-Z0-9_.]*)/g
    const keys = new Set<string>()
    let match
    while ((match = pattern.exec(defRecord.yamlContent)) !== null) {
      keys.add(match[1])
    }
    if (keys.size === 0) return null

    const defArgs = parsedDef?.args
    return Array.from(keys).map((key) => {
      const schema = defArgs?.[key]
      return {
        key,
        description: schema?.description,
        defaultValue: schema?.default !== undefined ? String(schema.default) : undefined
      }
    })
  }, [defRecord.yamlContent, parsedDef])

  const handleOpenRunModal = useCallback(() => {
    const initialFields: Record<string, string> = {}
    if (argsInfo) {
      for (const info of argsInfo) {
        initialFields[info.key] = info.defaultValue ?? ''
      }
    }
    setFormFields(initialFields)
    setArgsInput('')
    setUseJsonMode(!argsInfo || argsInfo.length === 0)
    setShowRunModal(true)
  }, [argsInfo])

  const handleRun = useCallback(() => {
    let args: Record<string, unknown> | undefined

    if (useJsonMode) {
      if (argsInput.trim()) {
        try {
          args = JSON.parse(argsInput)
        } catch {
          message.error('参数 JSON 格式错误')
          return
        }
      }
    } else if (argsInfo) {
      const hasAnyValue = Object.values(formFields).some((v) => v.trim())
      if (hasAnyValue) {
        args = { ...formFields }
      }
    }

    onRunWorkflow(defRecord.name, args)
    setShowRunModal(false)
    onTabChange('runs')
  }, [defRecord.name, argsInput, formFields, useJsonMode, argsInfo, onRunWorkflow, onTabChange])

  const handleCopyYaml = useCallback(() => {
    if (defRecord.yamlContent) {
      navigator.clipboard.writeText(defRecord.yamlContent)
      message.success('YAML 已复制')
    }
  }, [defRecord.yamlContent])

  const handleExportYaml = useCallback(() => {
    if (!defRecord.yamlContent) return
    const blob = new Blob([defRecord.yamlContent], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${defRecord.name}.yaml`
    a.click()
    URL.revokeObjectURL(url)
  }, [defRecord])

  const wsMode: WorkflowWorkspaceMode = parsedDef?.config?.workspaceMode ?? 'dual'
  const wsModeLabel: Record<WorkflowWorkspaceMode, string> = {
    dual: '双层',
    shared: '共享',
    isolated: '隔离'
  }

  const toolGroupEntries = useMemo(() => {
    if (!parsedDef?.steps) return []
    const groups = new Set<string>()
    for (const step of parsedDef.steps) {
      const tg = step.sessionConfig?.toolGroups
      if (tg) {
        for (const [k, v] of Object.entries(tg)) {
          if (v) groups.add(k)
        }
      }
    }
    return Array.from(groups)
  }, [parsedDef])

  return (
    <div className="wfp-def-detail wfp-fade-appear">
      {/* Header with gradient band */}
      <div className="wfp-def-header wfp-def-header--gradient">
        <div className="wfp-def-header__icon-wrap">
          <Icon icon={Workflow} size={28} />
        </div>
        <div className="wfp-def-header__info">
          <h2 className="wfp-def-header__name">{defRecord.name}</h2>
          {defRecord.description && (
            <p className="wfp-def-header__desc">{defRecord.description}</p>
          )}
          <div className="wfp-def-header__meta">
            <Tag>{parsedDef?.steps.length ?? 0} 步骤</Tag>
            <Tag color="cyan">{wsModeLabel[wsMode]}工作空间</Tag>
            {toolGroupEntries.map((g) => (
              <Tag key={g} color="geekblue">{g}</Tag>
            ))}
          </div>
        </div>
        <div className="wfp-def-header__actions">
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleOpenRunModal}
          >
            运行
          </Button>
          <Button
            icon={<ExportOutlined />}
            onClick={handleExportYaml}
            title="导出 YAML"
          />
          <Popconfirm
            title="确定删除此工作流定义？"
            description="关联的运行记录将保留。"
            onConfirm={() => onDeleteDef(defRecord.id)}
          >
            <Button danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </div>
      </div>

      {/* Tabs */}
      <div className="wfp-def-tabs">
        <Segmented
          value={activeTab}
          onChange={(v) => onTabChange(v as WorkflowPageTab)}
          options={[
            { label: '总览', value: 'overview' },
            { label: `运行 (${defRuns.length})`, value: 'runs' },
            { label: '编辑器', value: 'editor' },
            { label: '工作空间', value: 'workspace' },
            { label: 'YAML', value: 'yaml' }
          ]}
        />
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && parsedDef && (
        <WorkflowDefOverviewTab def={parsedDef} runs={defRuns} />
      )}
      {activeTab === 'runs' && (
        <WorkflowDefRunsTab
          runs={defRuns}
          loading={loading}
          onSelectRun={onSelectRun}
          onCancelRun={onCancelRun}
          onRefresh={onRefreshRuns}
        />
      )}
      {activeTab === 'editor' && (
        <WorkflowDefEditorTab
          defRecord={defRecord}
          onSave={onSaveDef}
          onRun={(name) => onRunWorkflow(name)}
        />
      )}
      {activeTab === 'workspace' && (
        <div className="wfp-tab-content wfp-fade-appear">
          <WorkflowWorkspacePanel workflowName={defRecord.name} />
        </div>
      )}
      {activeTab === 'yaml' && (
        <div className="wfp-tab-content wfp-fade-appear">
          <div className="wfp-yaml-view">
            <Button
              className="wfp-yaml-view__copy"
              size="small"
              icon={<CopyOutlined />}
              onClick={handleCopyYaml}
            >
              复制
            </Button>
            <pre>{defRecord.yamlContent ?? '(空)'}</pre>
          </div>
        </div>
      )}

      {/* Run modal with structured form / JSON input */}
      <Modal
        title={`运行 ${defRecord.name}`}
        open={showRunModal}
        onCancel={() => setShowRunModal(false)}
        onOk={handleRun}
        okText="运行"
        width={560}
      >
        <Flexbox gap={12}>
          {/* Mode toggle: form vs JSON — only show when args are detected */}
          {argsInfo && argsInfo.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <FormOutlined style={{ color: !useJsonMode ? 'var(--ant-color-primary)' : 'var(--ant-color-text-quaternary)' }} />
              <Switch
                size="small"
                checked={useJsonMode}
                onChange={setUseJsonMode}
              />
              <CodeOutlined style={{ color: useJsonMode ? 'var(--ant-color-primary)' : 'var(--ant-color-text-quaternary)' }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {useJsonMode ? 'JSON 模式' : '表单模式'}
              </Text>
            </div>
          )}

          {useJsonMode ? (
            <AntInput.TextArea
              placeholder={
                argsInfo
                  ? `参数 JSON，例:\n{${argsInfo.map((a) => `\n  "${a.key}": "..."`).join(',')}\n}`
                  : '参数 JSON（可选），例: {"key": "value"}'
              }
              rows={6}
              value={argsInput}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setArgsInput(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          ) : argsInfo && argsInfo.length > 0 ? (
            <Flexbox gap={14}>
              {argsInfo.map((info) => (
                <div key={info.key}>
                  <div style={{ marginBottom: 4, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <Text strong style={{ fontSize: 13 }}>{info.key}</Text>
                    {info.description && (
                      <Text type="secondary" style={{ fontSize: 11 }}>{info.description}</Text>
                    )}
                  </div>
                  <AntInput.TextArea
                    placeholder={`输入 ${info.key} 的值…`}
                    autoSize={{ minRows: 1, maxRows: 12 }}
                    value={formFields[info.key] ?? ''}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setFormFields((prev) => ({ ...prev, [info.key]: e.target.value }))
                    }
                    style={{ fontSize: 13 }}
                  />
                </div>
              ))}
            </Flexbox>
          ) : (
            <Text type="secondary" style={{ fontSize: 13 }}>
              此工作流无需参数，直接点击"运行"即可。
            </Text>
          )}
        </Flexbox>
      </Modal>
    </div>
  )
}
