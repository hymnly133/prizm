/**
 * Agent Rules 设置面板
 * 管理用户级（全局）和 Scope 级（工作区）自定义规则
 */
import { ActionIcon, Button, Flexbox, Input, Modal, Text, TextArea, toast } from '@lobehub/ui'
import { Segmented } from './ui/Segmented'
import { Checkbox } from 'antd'
import { Edit3, Plus, ScrollText, Trash2 } from 'lucide-react'
import { SettingsListItem } from './ui/SettingsListItem'
import { useCallback, useEffect, useState } from 'react'
import type { PrizmClient } from '@prizm/client-core'
import type {
  AgentRule,
  RuleLevel,
  CreateAgentRuleInput,
  UpdateAgentRuleInput
} from '@prizm/client-core'
import { useScope } from '../hooks/useScope'
import { EmptyState } from './ui/EmptyState'
import { LoadingPlaceholder } from './ui/LoadingPlaceholder'

interface AgentRulesSettingsProps {
  http: PrizmClient | null
  onLog: (msg: string, type?: 'info' | 'success' | 'error' | 'warning') => void
}

/** 空白创建表单 */
const emptyForm = {
  id: '',
  title: '',
  description: '',
  content: '',
  alwaysApply: true,
  globs: ''
}

export function AgentRulesSettings({ http, onLog }: AgentRulesSettingsProps) {
  const { currentScope } = useScope()
  const [level, setLevel] = useState<RuleLevel>('user')
  const [rules, setRules] = useState<AgentRule[]>([])
  const [loading, setLoading] = useState(false)

  // 创建/编辑
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)

  const scope = level === 'scope' ? currentScope : undefined

  const loadRules = useCallback(async () => {
    if (!http) return
    setLoading(true)
    try {
      const data = await http.listAgentRules(level, scope)
      setRules(data.rules ?? [])
    } catch (e) {
      onLog(`加载规则失败: ${e}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [http, level, scope, onLog])

  useEffect(() => {
    loadRules()
  }, [loadRules])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  const openEdit = (rule: AgentRule) => {
    setEditingId(rule.id)
    setForm({
      id: rule.id,
      title: rule.title,
      description: rule.description ?? '',
      content: rule.content,
      alwaysApply: rule.alwaysApply,
      globs: rule.globs?.join(', ') ?? ''
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!http) return
    if (!form.title.trim()) {
      toast.error('标题不能为空')
      return
    }

    const globs = form.globs
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    try {
      if (editingId) {
        const update: UpdateAgentRuleInput = {
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          content: form.content,
          alwaysApply: form.alwaysApply,
          globs: globs.length > 0 ? globs : undefined
        }
        await http.updateAgentRule(editingId, level, scope, update)
        toast.success('规则已更新')
      } else {
        const id = form.id.trim()
          ? form.id
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9_-]/g, '-')
          : form.title
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9_-]/g, '-')
              .replace(/-+/g, '-')
              .replace(/^-|-$/g, '')

        if (!id) {
          toast.error('ID 不能为空')
          return
        }

        const input: CreateAgentRuleInput = {
          id,
          title: form.title.trim(),
          content: form.content,
          level,
          scope,
          enabled: true,
          alwaysApply: form.alwaysApply,
          globs: globs.length > 0 ? globs : undefined,
          description: form.description.trim() || undefined
        }
        await http.createAgentRule(input)
        toast.success('规则已创建')
      }
      setShowModal(false)
      loadRules()
    } catch (e) {
      toast.error(`保存失败: ${e}`)
    }
  }

  const handleDelete = async (rule: AgentRule) => {
    if (!http) return
    try {
      await http.deleteAgentRule(rule.id, level, scope)
      toast.success('规则已删除')
      loadRules()
    } catch (e) {
      toast.error(`删除失败: ${e}`)
    }
  }

  const handleToggle = async (rule: AgentRule) => {
    if (!http) return
    try {
      await http.updateAgentRule(rule.id, level, scope, { enabled: !rule.enabled })
      loadRules()
    } catch (e) {
      toast.error(`切换失败: ${e}`)
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>Agent Rules</h2>
        <p className="form-hint">
          自定义 Agent 行为规则。用户级规则全局生效，Scope 级规则仅在对应工作区生效。
          启用且设为「始终应用」的规则会自动注入到每次对话中。
        </p>
      </div>

      {/* 层级切换 */}
      <Flexbox horizontal gap={12} align="center" style={{ marginBottom: 12 }}>
        <Segmented
          value={level}
          onChange={(v) => setLevel(v as RuleLevel)}
          options={[
            { label: '用户级（全局）', value: 'user' },
            { label: `Scope 级（${currentScope}）`, value: 'scope' }
          ]}
        />
        <Button icon={<Plus size={14} />} size="small" onClick={openCreate}>
          新建规则
        </Button>
      </Flexbox>

      {/* 规则列表 */}
      {loading ? (
        <LoadingPlaceholder />
      ) : rules.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          description={`暂无${
            level === 'user' ? '用户级' : 'Scope 级'
          }规则，点击「新建规则」添加自定义 Agent 行为指令`}
        />
      ) : (
        <Flexbox gap={6}>
          {rules.map((rule) => (
            <SettingsListItem
              key={rule.id}
              icon={<Checkbox checked={rule.enabled} onChange={() => handleToggle(rule)} />}
              title={
                <span style={{ textDecoration: rule.enabled ? 'none' : 'line-through' }}>
                  {rule.title}
                </span>
              }
              badges={
                <>
                  {rule.alwaysApply && (
                    <Text
                      type="secondary"
                      style={{
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: 'var(--ant-color-primary-bg)',
                        color: 'var(--ant-color-primary)'
                      }}
                    >
                      始终应用
                    </Text>
                  )}
                  {rule.globs && rule.globs.length > 0 && (
                    <Text type="secondary" style={{ fontSize: 10 }}>
                      {rule.globs.join(', ')}
                    </Text>
                  )}
                </>
              }
              description={rule.description}
              enabled={rule.enabled}
              actions={
                <>
                  <ActionIcon
                    icon={Edit3}
                    size="small"
                    title="编辑"
                    onClick={() => openEdit(rule)}
                  />
                  <ActionIcon
                    icon={Trash2}
                    size="small"
                    title="删除"
                    onClick={() => handleDelete(rule)}
                  />
                </>
              }
            />
          ))}
        </Flexbox>
      )}

      {/* 创建/编辑模态框 */}
      <Modal
        open={showModal}
        title={editingId ? '编辑规则' : '新建规则'}
        onCancel={() => setShowModal(false)}
        onOk={handleSave}
        okText={editingId ? '保存' : '创建'}
        width={600}
      >
        <Flexbox gap={12} style={{ marginTop: 12 }}>
          {!editingId && (
            <div>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                规则 ID（可选，留空将从标题自动生成）
              </Text>
              <Input
                placeholder="kebab-case，如 coding-style"
                value={form.id}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
              />
            </div>
          )}
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
              标题 *
            </Text>
            <Input
              placeholder="规则标题，如「代码风格规范」"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
              描述（可选）
            </Text>
            <Input
              placeholder="简述规则用途"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
              规则内容（Markdown）
            </Text>
            <TextArea
              placeholder={`输入规则指令内容（Markdown 格式）\n例如：\n- 使用 TypeScript strict 模式\n- 优先使用函数式组件\n- 错误处理必须使用 try/catch`}
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              autoSize={{ minRows: 10, maxRows: 24 }}
              style={{ fontFamily: 'monospace' }}
            />
          </div>
          <Flexbox horizontal gap={16} align="center">
            <Checkbox
              checked={form.alwaysApply}
              onChange={(e) => setForm((f) => ({ ...f, alwaysApply: e.target.checked }))}
            >
              始终应用
            </Checkbox>
            <Text type="secondary" style={{ fontSize: 12 }}>
              启用后规则将自动注入到每次对话的 system prompt 中
            </Text>
          </Flexbox>
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
              文件匹配模式（可选，逗号分隔）
            </Text>
            <Input
              placeholder="如 *.ts, *.tsx（留空表示不限文件类型）"
              value={form.globs}
              onChange={(e) => setForm((f) => ({ ...f, globs: e.target.value }))}
            />
          </div>
        </Flexbox>
      </Modal>
    </div>
  )
}
