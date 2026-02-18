/**
 * Skills 设置 UI
 * 管理 Agent Skills 列表、创建/导入/激活
 */
import { ActionIcon, Button, Flexbox, Input, Modal, Text, TextArea, toast } from '@lobehub/ui'
import { BookOpen, Import, Plus, Trash2, Zap } from 'lucide-react'
import { SettingsListItem } from './ui/SettingsListItem'
import { useCallback, useEffect, useState } from 'react'
import type { PrizmClient } from '@prizm/client-core'

interface SkillItem {
  name: string
  description: string
  enabled: boolean
  source?: string
  license?: string
  path?: string
}

interface SkillsSettingsProps {
  http: PrizmClient | null
  onLog: (msg: string, type?: 'info' | 'success' | 'error' | 'warning') => void
}

export function SkillsSettings({ http, onLog }: SkillsSettingsProps) {
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    name: '',
    description: '',
    body: '',
    license: ''
  })

  const loadSkills = useCallback(async () => {
    if (!http) return
    setLoading(true)
    try {
      const data = await http.listSkills()
      setSkills(data.skills as SkillItem[])
    } catch (e) {
      onLog(`加载 Skills 失败: ${e}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [http, onLog])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  const handleCreate = async () => {
    if (!http || !form.name.trim() || !form.description.trim()) {
      toast.error('名称和描述不能为空')
      return
    }
    try {
      await http.createSkill({
        name: form.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-'),
        description: form.description.trim(),
        body: form.body,
        license: form.license || undefined
      })
      toast.success('Skill 已创建')
      setShowCreate(false)
      setForm({ name: '', description: '', body: '', license: '' })
      loadSkills()
    } catch (e) {
      toast.error(`创建失败: ${e}`)
    }
  }

  const handleDelete = async (name: string) => {
    if (!http) return
    try {
      await http.deleteSkill(name)
      toast.success('Skill 已删除')
      loadSkills()
    } catch (e) {
      toast.error(`删除失败: ${e}`)
    }
  }

  const handleImport = async () => {
    if (!http) return
    try {
      const result = await http.importSkills('claude-code')
      toast.success(`已导入 ${result.imported} 个 Skills`)
      onLog(`从 Claude Code 导入了 ${result.imported} 个 Skills`, 'success')
      loadSkills()
    } catch (e) {
      toast.error(`导入失败: ${e}`)
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>Agent Skills</h2>
        <p className="form-hint">
          管理 Agent 技能，兼容 Anthropic Agent Skills 规范。Skills 可在对话中通过 /skill
          命令或关键词自动激活。
        </p>
      </div>

      <Flexbox gap={8} style={{ marginBottom: 12 }}>
        <Button
          icon={<Plus size={14} />}
          size="small"
          onClick={() => {
            setForm({ name: '', description: '', body: '', license: '' })
            setShowCreate(true)
          }}
        >
          新建 Skill
        </Button>
        <Button icon={<Import size={14} />} size="small" onClick={handleImport}>
          从 Claude Code 导入
        </Button>
      </Flexbox>

      {skills.length === 0 ? (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            color: 'var(--ant-color-text-tertiary)',
            border: '1px dashed var(--ant-color-border)',
            borderRadius: 8
          }}
        >
          <BookOpen size={32} style={{ marginBottom: 8, opacity: 0.5 }} />
          <div>暂无 Skills</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            创建 SKILL.md 或从 Claude Code 导入
          </Text>
        </div>
      ) : (
        <Flexbox gap={4}>
          {skills.map((skill) => (
            <SettingsListItem
              key={skill.name}
              icon={<Zap size={14} style={{ color: 'var(--ant-color-warning)' }} />}
              title={skill.name}
              badges={
                <>
                  {skill.source && skill.source !== 'prizm' && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      ({skill.source})
                    </Text>
                  )}
                  {skill.license && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {skill.license}
                    </Text>
                  )}
                </>
              }
              description={
                skill.description.length > 80
                  ? skill.description.slice(0, 80) + '…'
                  : skill.description
              }
              actions={
                <ActionIcon icon={Trash2} size="small" onClick={() => handleDelete(skill.name)} />
              }
            />
          ))}
        </Flexbox>
      )}

      {/* 创建模态框 */}
      <Modal
        open={showCreate}
        title="新建 Agent Skill"
        onCancel={() => setShowCreate(false)}
        onOk={handleCreate}
        okText="创建"
      >
        <Flexbox gap={12} style={{ marginTop: 12 }}>
          <Input
            placeholder="Skill 名称（小写+连字符，如 code-review）"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            placeholder="描述（用于自动激活匹配）"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <Input
            placeholder="许可证（可选，如 Apache-2.0）"
            value={form.license}
            onChange={(e) => setForm((f) => ({ ...f, license: e.target.value }))}
          />
          <TextArea
            placeholder={`Skill 指令内容（Markdown 格式）\n激活后将注入到 Agent 系统提示中`}
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            autoSize={{ minRows: 8, maxRows: 20 }}
          />
        </Flexbox>
      </Modal>
    </div>
  )
}
