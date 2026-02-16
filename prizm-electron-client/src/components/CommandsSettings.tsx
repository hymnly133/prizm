/**
 * 自定义命令设置 UI
 * 管理 slash 命令列表、创建/编辑/删除、导入
 */
import { ActionIcon, Button, Flexbox, Input, Modal, Text, TextArea, toast } from '@lobehub/ui'
import { Select } from './ui/Select'
import { Edit, FileText, Import, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { PrizmClient } from '@prizm/client-core'

interface CustomCommand {
  id: string
  name: string
  description?: string
  mode: 'prompt' | 'action'
  content: string
  source?: string
  enabled: boolean
  aliases?: string[]
}

interface CommandsSettingsProps {
  http: PrizmClient | null
  onLog: (msg: string, type?: 'info' | 'success' | 'error' | 'warning') => void
}

export function CommandsSettings({ http, onLog }: CommandsSettingsProps) {
  const [commands, setCommands] = useState<CustomCommand[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editCmd, setEditCmd] = useState<CustomCommand | null>(null)
  const [form, setForm] = useState({
    id: '',
    name: '',
    description: '',
    mode: 'prompt' as 'prompt' | 'action',
    content: '',
    aliases: ''
  })

  const loadCommands = useCallback(async () => {
    if (!http) return
    setLoading(true)
    try {
      const data = await http.listCustomCommands()
      setCommands(data.commands as CustomCommand[])
    } catch (e) {
      onLog(`加载命令失败: ${e}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [http, onLog])

  useEffect(() => {
    loadCommands()
  }, [loadCommands])

  const handleCreate = async () => {
    if (!http || !form.id.trim()) {
      toast.error('命令 ID 不能为空')
      return
    }
    try {
      await http.createCustomCommand({
        id: form.id
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '-'),
        name: form.name.trim() || form.id.trim(),
        description: form.description || undefined,
        mode: form.mode,
        content: form.content,
        aliases: form.aliases
          ? form.aliases
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined
      })
      toast.success('命令已创建')
      setShowCreate(false)
      resetForm()
      loadCommands()
    } catch (e) {
      toast.error(`创建失败: ${e}`)
    }
  }

  const handleUpdate = async () => {
    if (!http || !editCmd) return
    try {
      await http.updateCustomCommand(editCmd.id, {
        name: form.name.trim() || editCmd.name,
        description: form.description || undefined,
        mode: form.mode,
        content: form.content,
        aliases: form.aliases
          ? form.aliases
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined
      })
      toast.success('命令已更新')
      setEditCmd(null)
      resetForm()
      loadCommands()
    } catch (e) {
      toast.error(`更新失败: ${e}`)
    }
  }

  const handleDelete = async (id: string) => {
    if (!http) return
    try {
      await http.deleteCustomCommand(id)
      toast.success('命令已删除')
      loadCommands()
    } catch (e) {
      toast.error(`删除失败: ${e}`)
    }
  }

  const handleImport = async (source: 'cursor' | 'claude-code') => {
    if (!http) return
    try {
      const result = await http.importCommands(source)
      toast.success(`已导入 ${result.imported} 个命令`)
      onLog(`从 ${source} 导入了 ${result.imported} 个命令`, 'success')
      loadCommands()
    } catch (e) {
      toast.error(`导入失败: ${e}`)
    }
  }

  const resetForm = () => {
    setForm({ id: '', name: '', description: '', mode: 'prompt', content: '', aliases: '' })
  }

  const openEdit = (cmd: CustomCommand) => {
    setEditCmd(cmd)
    setForm({
      id: cmd.id,
      name: cmd.name,
      description: cmd.description || '',
      mode: cmd.mode,
      content: cmd.content,
      aliases: cmd.aliases?.join(', ') || ''
    })
  }

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>自定义命令</h2>
        <p className="form-hint">
          创建自定义 / 命令，支持 prompt 模式（注入 LLM）和 action 模式（直接返回）
        </p>
      </div>

      <Flexbox gap={8} style={{ marginBottom: 12 }}>
        <Button
          icon={<Plus size={14} />}
          size="small"
          onClick={() => {
            resetForm()
            setShowCreate(true)
          }}
        >
          新建命令
        </Button>
        <Button icon={<Import size={14} />} size="small" onClick={() => handleImport('cursor')}>
          从 Cursor 导入
        </Button>
        <Button
          icon={<Import size={14} />}
          size="small"
          onClick={() => handleImport('claude-code')}
        >
          从 Claude Code 导入
        </Button>
      </Flexbox>

      {commands.length === 0 ? (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            color: 'var(--ant-color-text-tertiary)',
            border: '1px dashed var(--ant-color-border)',
            borderRadius: 8
          }}
        >
          <FileText size={32} style={{ marginBottom: 8, opacity: 0.5 }} />
          <div>暂无自定义命令</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            使用 / 前缀触发命令，例如 /review-code
          </Text>
        </div>
      ) : (
        <Flexbox gap={4}>
          {commands.map((cmd) => (
            <Flexbox
              key={cmd.id}
              horizontal
              align="center"
              justify="space-between"
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--ant-color-border-secondary)',
                background: 'var(--ant-color-fill-quaternary)'
              }}
            >
              <Flexbox gap={4}>
                <Flexbox horizontal gap={8} align="center">
                  <Text style={{ fontFamily: 'var(--ant-font-family-code)', fontWeight: 600 }}>
                    /{cmd.id}
                  </Text>
                  <Text
                    type="secondary"
                    style={{
                      fontSize: 11,
                      padding: '1px 6px',
                      borderRadius: 4,
                      background:
                        cmd.mode === 'prompt'
                          ? 'var(--ant-color-primary-bg)'
                          : 'var(--ant-color-success-bg)'
                    }}
                  >
                    {cmd.mode}
                  </Text>
                  {cmd.source && cmd.source !== 'prizm' && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      ({cmd.source})
                    </Text>
                  )}
                </Flexbox>
                {cmd.description && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {cmd.description}
                  </Text>
                )}
              </Flexbox>
              <Flexbox horizontal gap={4}>
                <ActionIcon icon={Edit} size="small" onClick={() => openEdit(cmd)} />
                <ActionIcon icon={Trash2} size="small" onClick={() => handleDelete(cmd.id)} />
              </Flexbox>
            </Flexbox>
          ))}
        </Flexbox>
      )}

      {/* 创建/编辑模态框 */}
      <Modal
        open={showCreate || !!editCmd}
        title={editCmd ? `编辑命令: /${editCmd.id}` : '新建自定义命令'}
        onCancel={() => {
          setShowCreate(false)
          setEditCmd(null)
          resetForm()
        }}
        onOk={editCmd ? handleUpdate : handleCreate}
        okText={editCmd ? '保存' : '创建'}
      >
        <Flexbox gap={12} style={{ marginTop: 12 }}>
          {!editCmd && (
            <Input
              placeholder="命令 ID（如 review-code）"
              value={form.id}
              onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
            />
          )}
          <Input
            placeholder="显示名称"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            placeholder="描述（可选）"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <Select
            value={form.mode}
            options={[
              { label: 'prompt（注入 LLM 上下文）', value: 'prompt' },
              { label: 'action（直接返回结果）', value: 'action' }
            ]}
            onChange={(v) => setForm((f) => ({ ...f, mode: v as 'prompt' | 'action' }))}
          />
          <Input
            placeholder="别名（逗号分隔，可选）"
            value={form.aliases}
            onChange={(e) => setForm((f) => ({ ...f, aliases: e.target.value }))}
          />
          <TextArea
            placeholder={`命令模板内容（Markdown 格式）\n使用 $ARGUMENTS 引用用户输入`}
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            autoSize={{ minRows: 6, maxRows: 15 }}
          />
        </Flexbox>
      </Modal>
    </div>
  )
}
