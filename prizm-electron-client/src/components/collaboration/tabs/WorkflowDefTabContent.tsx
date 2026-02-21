/**
 * WorkflowDefTabContent — single workflow *definition* detail for a tab.
 *
 * Fetches one WorkflowDefRecord by ID and renders metadata, YAML preview,
 * recent runs, and an "open editor" button (the full visual editor opens
 * in a modal to avoid cluttering the tab).
 */
import { memo, useEffect, useState, useCallback, useMemo } from 'react'
import {
  Button,
  Descriptions,
  Modal,
  Tag,
  Timeline,
  Typography,
  message,
  Space,
  Popconfirm
} from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  ExportOutlined,
  PlayCircleOutlined
} from '@ant-design/icons'
import { Blocks, MessageSquare, RefreshCw, UserPlus } from 'lucide-react'
import type { WorkflowDefRecord, WorkflowRun, WorkflowDef } from '@prizm/shared'
import yaml from 'js-yaml'
import { useWorkflowStore } from '../../../store/workflowStore'
import { WorkflowEditor } from '../../workflow/editor'
import { LoadingPlaceholder } from '../../ui/LoadingPlaceholder'
import { EmptyState } from '../../ui/EmptyState'
import type { TabContentProps } from '../CollabTabContent'
import { WORKFLOW_RUN_STATUS_META } from '../../workflow/workflowRunStatus'

const { Text, Paragraph } = Typography

export const WorkflowDefTabContent = memo(function WorkflowDefTabContent({
  entityId,
  onOpenEntity,
  onLoadSession
}: TabContentProps) {
  const defs = useWorkflowStore((s) => s.defs)
  const runs = useWorkflowStore((s) => s.runs)
  const refreshDefs = useWorkflowStore((s) => s.refreshDefs)
  const refreshRuns = useWorkflowStore((s) => s.refreshRuns)
  const registerDef = useWorkflowStore((s) => s.registerDef)
  const deleteDef = useWorkflowStore((s) => s.deleteDef)
  const runWorkflow = useWorkflowStore((s) => s.runWorkflow)
  const createManagementSession = useWorkflowStore((s) => s.createManagementSession)

  const [loading, setLoading] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const [creatingMgmt, setCreatingMgmt] = useState(false)

  useEffect(() => {
    setLoading(true)
    void Promise.all([refreshDefs(), refreshRuns()]).finally(() => setLoading(false))
  }, [refreshDefs, refreshRuns])

  const defRecord = useMemo(
    () => defs.find((d) => d.id === entityId),
    [defs, entityId]
  )

  const defRuns = useMemo(
    () =>
      defRecord
        ? runs
            .filter((r) => r.workflowName === defRecord.name)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 10)
        : [],
    [runs, defRecord]
  )

  const parsedDef = useMemo<WorkflowDef | null>(() => {
    if (!defRecord?.yamlContent) return null
    try {
      const raw = yaml.load(defRecord.yamlContent)
      if (!raw || typeof raw !== 'object') return null
      return raw as WorkflowDef
    } catch {
      return null
    }
  }, [defRecord?.yamlContent])

  const handleSaveDef = useCallback(
    async (name: string, yamlStr: string, description?: string) => {
      await registerDef(name, yamlStr, description)
      message.success('工作流定义已保存')
    },
    [registerDef]
  )

  const handleRun = useCallback(() => {
    if (!defRecord) return
    void runWorkflow({ workflow_name: defRecord.name }).then((result) => {
      if (result) {
        message.success('工作流已启动')
        void refreshRuns()
      }
    })
  }, [defRecord, runWorkflow, refreshRuns])

  const handleDelete = useCallback(() => {
    if (!defRecord) return
    void deleteDef(defRecord.id).then(() => message.success('工作流定义已删除'))
  }, [defRecord, deleteDef])

  const handleCreateMgmtSession = useCallback(async () => {
    if (!defRecord || creatingMgmt) return
    setCreatingMgmt(true)
    try {
      const sessionId = await createManagementSession(defRecord.id)
      if (sessionId) {
        message.success('工作流管理会话已创建')
        onOpenEntity?.('session', sessionId, '工作流管理会话')
      } else {
        message.error('创建失败')
      }
    } finally {
      setCreatingMgmt(false)
    }
  }, [defRecord, creatingMgmt, createManagementSession, onOpenEntity])

  const handleCopyYaml = useCallback(() => {
    if (defRecord?.yamlContent) {
      navigator.clipboard.writeText(defRecord.yamlContent)
      message.success('YAML 已复制')
    }
  }, [defRecord?.yamlContent])

  const handleExportYaml = useCallback(() => {
    if (!defRecord?.yamlContent) return
    const blob = new Blob([defRecord.yamlContent], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${defRecord.name}.yaml`
    a.click()
    URL.revokeObjectURL(url)
  }, [defRecord])

  if (!entityId) return <EmptyState description="缺少工作流定义 ID" />
  if (loading && !defRecord) return <LoadingPlaceholder />
  if (!defRecord) return <EmptyState description="未找到工作流定义" />

  const stepCount = parsedDef?.steps?.length ?? 0

  return (
    <div className="collab-tab-entity-detail">
      <div className="collab-tab-entity-detail__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Blocks size={16} style={{ opacity: 0.6 }} />
          <h3 className="collab-tab-entity-detail__title">{defRecord.name}</h3>
        </div>
        <Space size={4}>
          <Button size="small" type="text" icon={<RefreshCw size={12} />} onClick={() => void refreshDefs()} />
          <Button size="small" icon={<PlayCircleOutlined />} onClick={handleRun}>运行</Button>
          <Button size="small" onClick={() => setEditorOpen(true)}>编辑器</Button>
        </Space>
      </div>

      {defRecord.description && (
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
          {defRecord.description}
        </Paragraph>
      )}

      <Descriptions column={1} size="small" bordered style={{ margin: '8px 0' }}>
        <Descriptions.Item label="定义 ID">
          <code style={{ fontSize: 11 }}>{defRecord.id}</code>
        </Descriptions.Item>
        <Descriptions.Item label="步骤数">{stepCount}</Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {new Date(defRecord.createdAt).toLocaleString()}
        </Descriptions.Item>
        <Descriptions.Item label="更新时间">
          {new Date(defRecord.updatedAt).toLocaleString()}
        </Descriptions.Item>
      </Descriptions>

      {/* 工作流管理会话（双向引用） */}
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>工作流管理会话</Text>
        {defRecord.workflowManagementSessionId ? (
          <Space size={8} wrap>
            <code style={{ fontSize: 11 }}>{defRecord.workflowManagementSessionId.slice(0, 12)}…</code>
            <Button
              size="small"
              type="primary"
              icon={<MessageSquare size={12} />}
              onClick={() => onOpenEntity?.('session', defRecord.workflowManagementSessionId!, '工作流管理会话')}
            >
              打开会话
            </Button>
            {onLoadSession && (
              <Button
                size="small"
                icon={<MessageSquare size={12} />}
                onClick={() => onLoadSession(defRecord.workflowManagementSessionId!)}
              >
                定位到会话
              </Button>
            )}
          </Space>
        ) : (
          <Button
            size="small"
            type="default"
            icon={<UserPlus size={12} />}
            loading={creatingMgmt}
            onClick={handleCreateMgmtSession}
          >
            创建管理会话
          </Button>
        )}
      </div>

      <Space size={4} style={{ marginBottom: 12 }}>
        <Button size="small" type="text" icon={<CopyOutlined />} onClick={handleCopyYaml}>复制 YAML</Button>
        <Button size="small" type="text" icon={<ExportOutlined />} onClick={handleExportYaml}>导出</Button>
        <Popconfirm title="确认删除此工作流定义？" onConfirm={handleDelete} okText="删除" cancelText="取消">
          <Button size="small" type="text" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>

      {/* YAML preview */}
      {defRecord.yamlContent && (
        <div style={{ marginBottom: 12 }}>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>YAML 定义</Text>
          <pre className="collab-tab-yaml-preview">{defRecord.yamlContent}</pre>
        </div>
      )}

      {/* Recent runs */}
      {defRuns.length > 0 && (
        <div>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>最近运行</Text>
          <Timeline
            items={defRuns.map((r) => {
              const meta = WORKFLOW_RUN_STATUS_META[r.status] ?? WORKFLOW_RUN_STATUS_META.pending
              return {
                dot: meta.icon,
                children: (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        className="collab-ref-chip"
                        onClick={() => onOpenEntity?.('workflow', r.id, r.workflowName)}
                      >
                        {r.id.slice(0, 8)}
                      </button>
                      <Tag color={meta.color}>{meta.label}</Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {new Date(r.createdAt).toLocaleString()}
                      </Text>
                    </div>
                  </div>
                )
              }
            })}
          />
        </div>
      )}

      {/* Visual editor modal */}
      <Modal
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        footer={null}
        width="90vw"
        className="wfe-modal"
        destroyOnClose
      >
        <WorkflowEditor
          defRecord={defRecord}
          onSave={handleSaveDef}
          onRun={(name) => {
            void runWorkflow({ workflow_name: name }).then((result) => {
              if (result) {
                message.success('工作流已启动')
                void refreshRuns()
              }
            })
          }}
          onClose={() => setEditorOpen(false)}
        />
      </Modal>
    </div>
  )
})
