/**
 * WorkflowDefDetail — 定义详情主面板
 *
 * Header（名称 + 操作按钮）+ 4 Tab（总览/运行/工作空间/YAML）。
 * 编辑统一通过「编辑」→ 直接打开 WorkflowEditor Modal。
 */

import { useMemo, useCallback, useState, useEffect } from 'react'
import {
  Button,
  Popconfirm,
  Modal,
  message,
  Space,
  Input as AntInput,
  Switch,
  Typography,
  Tag
} from 'antd'
import { MessageOutlined, UserAddOutlined, ReloadOutlined } from '@ant-design/icons'
import { Flexbox, Input } from '@lobehub/ui'
import { Icon } from '@lobehub/ui'
import { Segmented } from '../ui/Segmented'
import { Database, Workflow } from 'lucide-react'
import { useCollabInteraction } from '../../hooks/useCollabInteraction'
import { useWorkflowStore } from '../../store/workflowStore'
import {
  PlayCircleOutlined,
  DeleteOutlined,
  CopyOutlined,
  ExportOutlined,
  CodeOutlined,
  FormOutlined
} from '@ant-design/icons'
import yaml from 'js-yaml'
import type {
  WorkflowDefRecord,
  WorkflowRun,
  WorkflowDef,
  WorkflowWorkspaceMode
} from '@prizm/shared'
import type { WorkflowPageTab } from '../../hooks/useWorkflowPageState'
import { WorkflowDefOverviewTab } from './WorkflowDefOverviewTab'
import { WorkflowDefRunsTab } from './WorkflowDefRunsTab'
import { WorkflowWorkspacePanel } from './WorkflowWorkspacePanel'
import { WorkflowEditor } from './editor'
import { getWorkflowArgsSchema } from './workflowArgsSchema'

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
  /** 外部请求打开编辑器（如侧栏「编辑」）：选中该 def 时打开 Modal */
  openEditorForDefId?: string | null
  /** 关闭编辑器 Modal 时清除外部请求 */
  onClearOpenEditorRequest?: () => void
  /** 在侧边栏以标签打开管理会话 */
  onOpenManagementSession?: (sessionId: string) => void
  /** 为当前工作流重建管理会话（删除旧会话并新建，更新 def 引用） */
  onRefreshManagementSession?: (
    sessionId: string,
    onDone?: (result: { newSessionId: string; label: string }) => void
  ) => void
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
  onDeleteDef,
  openEditorForDefId,
  onClearOpenEditorRequest,
  onOpenManagementSession,
  onRefreshManagementSession
}: WorkflowDefDetailProps) {
  const [showRunModal, setShowRunModal] = useState(false)
  const [editorModalOpen, setEditorModalOpen] = useState(false)
  const [argsInput, setArgsInput] = useState('')
  const [formFields, setFormFields] = useState<Record<string, string>>({})
  const [useJsonMode, setUseJsonMode] = useState(false)
  const [creatingMgmt, setCreatingMgmt] = useState(false)

  useEffect(() => {
    if (openEditorForDefId === defRecord.id) {
      setEditorModalOpen(true)
    }
  }, [openEditorForDefId, defRecord.id])

  const handleCloseEditorModal = useCallback(() => {
    setEditorModalOpen(false)
    onClearOpenEditorRequest?.()
  }, [onClearOpenEditorRequest])

  const { openSession } = useCollabInteraction()
  const createManagementSession = useWorkflowStore((s) => s.createManagementSession)
  const refreshDefs = useWorkflowStore((s) => s.refreshDefs)

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

  /**
   * 运行弹窗用参数列表：复用 getWorkflowArgsSchema（与总览「参数 Schema」同源），再转为表单所需字段
   */
  const argsInfo = useMemo<Array<{
    key: string
    description: string
    defaultValue?: string
    optional: boolean
  }> | null>(() => {
    const raw = getWorkflowArgsSchema(parsedDef)
    if (!raw?.length) return null
    return raw.map((p) => ({
      key: p.key,
      description: p.description,
      defaultValue: p.default !== undefined ? String(p.default) : undefined,
      optional: p.optional
    }))
  }, [parsedDef])

  const handleCreateMgmtSession = useCallback(async () => {
    if (creatingMgmt) return
    setCreatingMgmt(true)
    try {
      const sessionId = await createManagementSession(defRecord.id)
      if (sessionId) {
        message.success('工作流管理会话已创建')
        if (onOpenManagementSession) {
          onOpenManagementSession(sessionId)
        } else {
          openSession(sessionId, `${defRecord.name} 管理会话`)
        }
      } else {
        message.error('创建失败')
      }
      void refreshDefs()
    } finally {
      setCreatingMgmt(false)
    }
  }, [
    creatingMgmt,
    createManagementSession,
    defRecord.id,
    defRecord.name,
    openSession,
    onOpenManagementSession,
    refreshDefs
  ])

  const handleOpenRunModal = useCallback(() => {
    const initialFields: Record<string, string> = {}
    if (argsInfo) {
      for (const info of argsInfo) {
        initialFields[info.key] = info.defaultValue ?? ''
      }
    }
    setFormFields(initialFields)
    setArgsInput('')
    setUseJsonMode(false)
    setShowRunModal(true)
  }, [argsInfo])

  const handleRun = useCallback(() => {
    let args: Record<string, unknown> | undefined

    if (useJsonMode) {
      if (argsInput.trim()) {
        try {
          args = JSON.parse(argsInput) as Record<string, unknown>
        } catch {
          message.error('参数 JSON 格式错误')
          return
        }
      } else {
        args = {}
      }
    } else if (argsInfo && argsInfo.length > 0) {
      const built: Record<string, unknown> = {}
      for (const info of argsInfo) {
        const v = (formFields[info.key] ?? '').trim()
        if (v) {
          built[info.key] = v
        } else if (info.defaultValue !== undefined) {
          built[info.key] = info.defaultValue
        } else if (!info.optional) {
          message.error(`请填写必填参数：${info.key}`)
          return
        }
      }
      args = built
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
          {defRecord.description && <p className="wfp-def-header__desc">{defRecord.description}</p>}
          <div className="wfp-def-header__meta">
            <Tag>{parsedDef?.steps.length ?? 0} 步骤</Tag>
            <Tag color="cyan">{wsModeLabel[wsMode]}工作空间</Tag>
            {toolGroupEntries.map((g) => (
              <Tag key={g} color="geekblue">
                {g}
              </Tag>
            ))}
          </div>
        </div>
        <div className="wfp-def-header__actions">
          <Button
            icon={<CodeOutlined />}
            onClick={() => setEditorModalOpen(true)}
            title="打开图/YAML 编辑器"
          >
            编辑
          </Button>
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleOpenRunModal}>
            运行
          </Button>
          <Button icon={<ExportOutlined />} onClick={handleExportYaml} title="导出 YAML" />
          <Popconfirm
            title="确定删除此工作流定义？"
            description="关联的运行记录将保留。"
            onConfirm={() => onDeleteDef(defRecord.id)}
          >
            <Button danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </div>
      </div>

      {/* 工作流管理会话（双向引用） */}
      <div className="wfp-def-mgmt-session">
        <Text strong style={{ fontSize: 13, marginRight: 8 }}>
          工作流管理会话
        </Text>
        {defRecord.workflowManagementSessionId ? (
          <Space size={8} wrap>
            <code style={{ fontSize: 11 }}>
              {defRecord.workflowManagementSessionId.slice(0, 12)}…
            </code>
            <Button
              size="small"
              type="primary"
              icon={<MessageOutlined />}
              onClick={() => {
                if (onOpenManagementSession) {
                  onOpenManagementSession(defRecord.workflowManagementSessionId!)
                } else {
                  openSession(defRecord.workflowManagementSessionId!, `${defRecord.name} 管理会话`)
                }
              }}
            >
              在侧边栏打开管理会话
            </Button>
            {onRefreshManagementSession && (
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() =>
                  onRefreshManagementSession(defRecord.workflowManagementSessionId!, (result) =>
                    openSession(result.newSessionId, result.label)
                  )
                }
              >
                重建管理会话
              </Button>
            )}
          </Space>
        ) : (
          <Button
            size="small"
            icon={<UserAddOutlined />}
            loading={creatingMgmt}
            onClick={handleCreateMgmtSession}
          >
            创建管理会话
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="wfp-def-tabs">
        <Segmented
          value={activeTab}
          onChange={(v) => onTabChange(v as WorkflowPageTab)}
          options={[
            { label: '总览', value: 'overview' },
            { label: `运行 (${defRuns.length})`, value: 'runs' },
            { label: '工作空间', value: 'workspace' },
            { label: 'YAML', value: 'yaml' }
          ]}
        />
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && parsedDef && (
        <WorkflowDefOverviewTab
          def={parsedDef}
          runs={defRuns}
          defId={defRecord.id}
          onRollbackSuccess={refreshDefs}
        />
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
      {activeTab === 'workspace' && (
        <div className="wfp-tab-content wfp-fade-appear">
          <WorkflowWorkspacePanel
            workflowName={defRecord.name}
            mode="overview"
            runsForWorkflow={defRuns}
            onSelectRun={onSelectRun}
            onCancelRun={onCancelRun}
          />
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

      {/* 编辑器 Modal：主区「编辑」或侧栏「编辑」请求打开 */}
      <Modal
        title={`编辑 — ${defRecord.name}`}
        open={editorModalOpen}
        onCancel={handleCloseEditorModal}
        footer={null}
        width="90vw"
        className="wfe-modal"
        destroyOnClose
      >
        <WorkflowEditor
          defRecord={defRecord}
          onSave={onSaveDef}
          onRun={(name) => onRunWorkflow(name)}
          onClose={handleCloseEditorModal}
        />
      </Modal>

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
              <FormOutlined
                style={{
                  color: !useJsonMode
                    ? 'var(--ant-color-primary)'
                    : 'var(--ant-color-text-quaternary)'
                }}
              />
              <Switch size="small" checked={useJsonMode} onChange={setUseJsonMode} />
              <CodeOutlined
                style={{
                  color: useJsonMode
                    ? 'var(--ant-color-primary)'
                    : 'var(--ant-color-text-quaternary)'
                }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {useJsonMode ? 'JSON 模式' : '表单模式'}
              </Text>
            </div>
          )}

          {useJsonMode ? (
            <AntInput.TextArea
              placeholder={
                argsInfo && argsInfo.length > 0
                  ? `参数 JSON，例:\n{${argsInfo.map((a) => `\n  "${a.key}": "..."`).join(',')}\n}`
                  : '可选参数 JSON，例: {"key": "value"}'
              }
              rows={6}
              value={argsInput}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setArgsInput(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          ) : argsInfo && argsInfo.length > 0 ? (
            <Flexbox gap={14} style={{ flexDirection: 'column' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                有默认值的参数可不填，运行时将使用默认值。
              </Text>
              {argsInfo.map((info) => (
                <div key={info.key}>
                  <div
                    style={{
                      marginBottom: 4,
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 6,
                      flexWrap: 'wrap'
                    }}
                  >
                    <Text strong style={{ fontSize: 13 }}>
                      {info.key}
                    </Text>
                    <Text
                      type="secondary"
                      style={{ fontSize: 12 }}
                      title={info.optional ? '有默认值即可选' : undefined}
                    >
                      {info.optional ? '（可选）' : '（必填）'}
                    </Text>
                    {info.description && (
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {info.description}
                      </Text>
                    )}
                  </div>
                  <AntInput
                    placeholder={
                      info.optional
                        ? info.defaultValue
                          ? `选填，不填则使用默认值：${info.defaultValue}`
                          : '选填'
                        : `请输入 ${info.key}`
                    }
                    value={formFields[info.key] ?? ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setFormFields((prev) => ({ ...prev, [info.key]: e.target.value }))
                    }
                    style={{ fontSize: 13 }}
                  />
                </div>
              ))}
            </Flexbox>
          ) : (
            <Text type="secondary" style={{ fontSize: 13 }}>
              此工作流无需参数，直接点击「运行」即可。
            </Text>
          )}
        </Flexbox>
      </Modal>
    </div>
  )
}
