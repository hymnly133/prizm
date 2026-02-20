/**
 * Skills 设置 UI — 三栏 Tab 设计：已安装 / 浏览 / 导入
 */
import {
  ActionIcon,
  Button,
  Flexbox,
  Input,
  Markdown,
  Modal,
  Tag,
  Text,
  TextArea,
  toast
} from '@lobehub/ui'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Download,
  Edit3,
  ExternalLink,
  Globe,
  Import,
  Plus,
  Search,
  Star,
  Trash2,
  Zap
} from 'lucide-react'
import { Segmented } from './ui/Segmented'
import { EmptyState } from './ui/EmptyState'
import SearchInput from './ui/SearchInput'
import { useCallback, useEffect, useState } from 'react'
import type { PrizmClient } from '@prizm/client-core'

interface SkillItem {
  name: string
  description: string
  enabled: boolean
  source?: string
  license?: string
  path?: string
  body?: string
}

interface RegistrySkillItem {
  name: string
  description: string
  owner: string
  repo: string
  skillPath: string
  stars?: number
  license?: string
  source: string
  htmlUrl?: string
  installed?: boolean
}

type TabKey = 'installed' | 'browse' | 'import'

interface SkillsSettingsProps {
  http: PrizmClient | null
  onLog: (msg: string, type?: 'info' | 'success' | 'error' | 'warning') => void
}

export function SkillsSettings({ http, onLog }: SkillsSettingsProps) {
  const [tab, setTab] = useState<TabKey>('installed')
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [loading, setLoading] = useState(false)

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', body: '', license: '' })

  // Expand/edit state
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)
  const [editingSkill, setEditingSkill] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')

  // Registry state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<RegistrySkillItem[]>([])
  const [featuredSkills, setFeaturedSkills] = useState<RegistrySkillItem[]>([])
  const [searching, setSearching] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)

  // Import state
  const [importPath, setImportPath] = useState('')
  const [ghUrl, setGhUrl] = useState('')

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

  // Load featured skills when Browse tab is shown
  useEffect(() => {
    if (tab === 'browse' && featuredSkills.length === 0 && http) {
      http
        .getFeaturedSkills()
        .then((data) => setFeaturedSkills(data.skills as RegistrySkillItem[]))
        .catch(() => {})
    }
  }, [tab, http, featuredSkills.length])

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

  const handleSaveEdit = async (name: string) => {
    if (!http) return
    try {
      await http.updateSkill(name, { body: editBody })
      toast.success('Skill 内容已更新')
      setEditingSkill(null)
      loadSkills()
    } catch (e) {
      toast.error(`更新失败: ${e}`)
    }
  }

  const handleToggleExpand = async (name: string) => {
    if (expandedSkill === name) {
      setExpandedSkill(null)
      return
    }
    if (!http) return
    try {
      const full = (await http.getSkill(name)) as SkillItem
      const idx = skills.findIndex((s) => s.name === name)
      if (idx >= 0) {
        const updated = [...skills]
        updated[idx] = { ...updated[idx], body: full.body }
        setSkills(updated)
      }
      setExpandedSkill(name)
    } catch {
      setExpandedSkill(name)
    }
  }

  const handleSearch = async (q: string) => {
    setSearchQuery(q)
    if (!q.trim() || !http) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const result = await http.searchSkillRegistry(q)
      setSearchResults(result.items as RegistrySkillItem[])
    } catch (e) {
      onLog(`搜索失败: ${e}`, 'error')
    } finally {
      setSearching(false)
    }
  }

  const handleInstall = async (item: RegistrySkillItem) => {
    if (!http) return
    setInstalling(item.name)
    try {
      await http.installRegistrySkill(item.owner, item.repo, item.skillPath)
      toast.success(`已安装 Skill: ${item.name}`)
      loadSkills()
      // Refresh featured to update installed status
      http
        .getFeaturedSkills()
        .then((data) => setFeaturedSkills(data.skills as RegistrySkillItem[]))
        .catch(() => {})
    } catch (e) {
      toast.error(`安装失败: ${e}`)
    } finally {
      setInstalling(null)
    }
  }

  const handleImportClaudeCode = async () => {
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

  const handleImportPath = async () => {
    if (!http || !importPath.trim()) {
      toast.error('请输入目录路径')
      return
    }
    try {
      const result = await http.importSkills('github', importPath.trim())
      toast.success(`已导入 ${result.imported} 个 Skills`)
      setImportPath('')
      loadSkills()
    } catch (e) {
      toast.error(`导入失败: ${e}`)
    }
  }

  const handleImportGitHub = async () => {
    if (!http || !ghUrl.trim()) {
      toast.error('请输入 GitHub 仓库路径')
      return
    }
    // Parse owner/repo/path from URL or shorthand
    const match = ghUrl
      .trim()
      .match(
        /(?:github\.com\/)?([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?:\/(?:tree\/[^/]+\/)?(.+))?/
      )
    if (!match) {
      toast.error('格式无效，请输入 owner/repo 或 owner/repo/path')
      return
    }
    const [, owner, repo, skillPath] = match
    try {
      await http.installRegistrySkill(owner, repo, skillPath || '.')
      toast.success(`已从 GitHub 安装 Skill`)
      setGhUrl('')
      loadSkills()
    } catch (e) {
      toast.error(`安装失败: ${e}`)
    }
  }

  const installedNames = new Set(skills.map((s) => s.name))

  // ---- Render: Installed Tab ----
  function renderInstalled() {
    return (
      <>
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
        </Flexbox>

        {skills.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            description="暂无 Skills"
            actions={
              <Flexbox gap={8} horizontal>
                <Button size="small" onClick={() => setTab('browse')}>
                  浏览商店
                </Button>
                <Button size="small" onClick={() => setTab('import')}>
                  导入
                </Button>
              </Flexbox>
            }
          />
        ) : (
          <Flexbox gap={6}>
            {skills.map((skill) => {
              const isExpanded = expandedSkill === skill.name
              const isEditing = editingSkill === skill.name

              return (
                <div key={skill.name} className="content-card content-card--default">
                  <div
                    className="content-card__header"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      padding: '10px 12px'
                    }}
                    onClick={() => handleToggleExpand(skill.name)}
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
                    ) : (
                      <ChevronRight size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
                    )}
                    <Zap size={14} style={{ color: 'var(--ant-color-warning)', flexShrink: 0 }} />
                    <span style={{ fontWeight: 500, flex: 1, minWidth: 0 }}>{skill.name}</span>
                    {skill.source && skill.source !== 'prizm' && (
                      <Tag size="small" style={{ fontSize: 10 }}>
                        {skill.source}
                      </Tag>
                    )}
                    {skill.license && (
                      <Tag size="small" style={{ fontSize: 10 }}>
                        {skill.license}
                      </Tag>
                    )}
                    <ActionIcon
                      icon={Edit3}
                      size="small"
                      title="编辑内容"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingSkill(skill.name)
                        setEditBody(skill.body ?? '')
                        if (!isExpanded) handleToggleExpand(skill.name)
                      }}
                    />
                    <ActionIcon
                      icon={Trash2}
                      size="small"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(skill.name)
                      }}
                    />
                  </div>
                  <div style={{ padding: '0 12px 8px', fontSize: 12, opacity: 0.7 }}>
                    {skill.description.length > 120
                      ? skill.description.slice(0, 120) + '...'
                      : skill.description}
                  </div>
                  {isExpanded && (
                    <div
                      className="content-card__body"
                      style={{ borderTop: '1px solid var(--ant-color-border-secondary)' }}
                    >
                      {isEditing ? (
                        <Flexbox gap={8}>
                          <TextArea
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            autoSize={{ minRows: 6, maxRows: 20 }}
                            placeholder="Skill 指令 (Markdown)"
                          />
                          <Flexbox horizontal gap={8}>
                            <Button
                              size="small"
                              type="primary"
                              onClick={() => handleSaveEdit(skill.name)}
                            >
                              保存
                            </Button>
                            <Button size="small" onClick={() => setEditingSkill(null)}>
                              取消
                            </Button>
                          </Flexbox>
                        </Flexbox>
                      ) : (
                        <div
                          style={{
                            maxHeight: 300,
                            overflow: 'auto',
                            fontSize: 13,
                            lineHeight: 1.6
                          }}
                        >
                          {skill.body ? (
                            <Markdown>{skill.body}</Markdown>
                          ) : (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              (无指令内容)
                            </Text>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </Flexbox>
        )}

        {/* Create modal */}
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
      </>
    )
  }

  // ---- Render: Browse Tab ----
  function renderBrowse() {
    const displayItems = searchQuery.trim() ? searchResults : featuredSkills

    return (
      <>
        <div style={{ marginBottom: 12 }}>
          <SearchInput
            onSearch={handleSearch}
            placeholder="搜索 GitHub 上的 Skills..."
            loading={searching}
          />
        </div>

        {!searchQuery.trim() && (
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            精选 Skills（来自 Anthropic Agent Skills 开放规范）
          </Text>
        )}

        {displayItems.length === 0 && !searching ? (
          <EmptyState
            icon={Globe}
            description={searchQuery ? '未找到匹配的 Skills' : '加载中...'}
          />
        ) : (
          <Flexbox gap={6}>
            {displayItems.map((item) => {
              const alreadyInstalled = installedNames.has(item.name) || (item as { installed?: boolean }).installed
              return (
                <div
                  key={`${item.owner}/${item.repo}/${item.skillPath}`}
                  className="content-card content-card--default content-card--hoverable"
                  style={{ padding: '10px 12px' }}
                >
                  <Flexbox horizontal align="center" gap={8}>
                    <Download
                      size={14}
                      style={{ color: 'var(--ant-color-primary)', flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{item.name}</div>
                      <div
                        style={{
                          fontSize: 12,
                          opacity: 0.65,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {item.description}
                      </div>
                    </div>
                    <Flexbox horizontal gap={6} align="center" style={{ flexShrink: 0 }}>
                      {item.stars != null && item.stars > 0 && (
                        <Flexbox
                          horizontal
                          gap={2}
                          align="center"
                          style={{ fontSize: 11, opacity: 0.6 }}
                        >
                          <Star size={11} />
                          {item.stars >= 1000
                            ? `${(item.stars / 1000).toFixed(1)}k`
                            : item.stars}
                        </Flexbox>
                      )}
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {item.owner}/{item.repo}
                      </Text>
                      {item.htmlUrl && (
                        <ActionIcon
                          icon={ExternalLink}
                          size="small"
                          title="在 GitHub 上查看"
                          onClick={() => window.open(item.htmlUrl, '_blank')}
                        />
                      )}
                      {alreadyInstalled ? (
                        <Tag color="green" style={{ fontSize: 11 }}>
                          已安装
                        </Tag>
                      ) : (
                        <Button
                          size="small"
                          type="primary"
                          loading={installing === item.name}
                          onClick={() => handleInstall(item)}
                        >
                          安装
                        </Button>
                      )}
                    </Flexbox>
                  </Flexbox>
                </div>
              )
            })}
          </Flexbox>
        )}
      </>
    )
  }

  // ---- Render: Import Tab ----
  function renderImport() {
    return (
      <Flexbox gap={16}>
        {/* Claude Code import */}
        <div className="content-card content-card--default" style={{ padding: '12px' }}>
          <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 13 }}>
            从 Claude Code 导入
          </div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            自动扫描 ~/.claude/skills/ 和项目 .claude/skills/ 目录
          </Text>
          <Button icon={<Import size={14} />} size="small" onClick={handleImportClaudeCode}>
            扫描并导入
          </Button>
        </div>

        {/* Local directory */}
        <div className="content-card content-card--default" style={{ padding: '12px' }}>
          <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 13 }}>从本地目录导入</div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            指定包含 SKILL.md 子目录的本地路径
          </Text>
          <Flexbox horizontal gap={8}>
            <Input
              size="small"
              placeholder="目录路径，如 C:\skills 或 /home/user/skills"
              value={importPath}
              onChange={(e) => setImportPath(e.target.value)}
              style={{ flex: 1 }}
            />
            <Button size="small" onClick={handleImportPath}>
              导入
            </Button>
          </Flexbox>
        </div>

        {/* GitHub URL */}
        <div className="content-card content-card--default" style={{ padding: '12px' }}>
          <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 13 }}>从 GitHub 安装</div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            输入仓库路径，如 anthropics/skills/skills/code-review 或完整 GitHub URL
          </Text>
          <Flexbox horizontal gap={8}>
            <Input
              size="small"
              placeholder="owner/repo/path 或 GitHub URL"
              value={ghUrl}
              onChange={(e) => setGhUrl(e.target.value)}
              style={{ flex: 1 }}
            />
            <Button size="small" onClick={handleImportGitHub}>
              安装
            </Button>
          </Flexbox>
        </div>
      </Flexbox>
    )
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

      <div style={{ marginBottom: 12 }}>
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as TabKey)}
          options={[
            { label: `已安装 (${skills.length})`, value: 'installed' },
            { label: '浏览', value: 'browse' },
            { label: '导入', value: 'import' }
          ]}
        />
      </div>

      {tab === 'installed' && renderInstalled()}
      {tab === 'browse' && renderBrowse()}
      {tab === 'import' && renderImport()}
    </div>
  )
}
