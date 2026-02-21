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
import { Spin } from 'antd'
import {
  BookOpen,
  Edit3,
  FolderOpen,
  Globe,
  Import,
  Plus,
  Search,
  Star,
  Trash2,
  Zap
} from 'lucide-react'
import { Segmented } from './ui/Segmented'
import { ContentCard, ContentCardHeader, ContentCardBody } from './ui/ContentCard'
import { ModalSidebar } from './ui/ModalSidebar'
import { EmptyState } from './ui/EmptyState'
import { RegistrySkillCard } from './skills/RegistrySkillCard'
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
  /** 来源唯一键，用于列表 key 与 installing 状态 */
  registryKey?: string
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

  // 详情面板（弹出抽屉）与编辑状态
  const [detailPanelSkill, setDetailPanelSkill] = useState<string | null>(null)
  const [editingSkill, setEditingSkill] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')

  // Registry state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<RegistrySkillItem[]>([])
  const [featuredSkills, setFeaturedSkills] = useState<RegistrySkillItem[]>([])
  const [searching, setSearching] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  // Collection browse state
  const [collectionOwnerRepo, setCollectionOwnerRepo] = useState('')
  const [collectionPath, setCollectionPath] = useState('skills')
  const [collectionSkills, setCollectionSkills] = useState<RegistrySkillItem[]>([])
  const [loadingCollection, setLoadingCollection] = useState(false)
  // SkillKit (built-in source) state
  const [skillkitQuery, setSkillkitQuery] = useState('')
  const [skillkitResults, setSkillkitResults] = useState<RegistrySkillItem[]>([])
  const [searchingSkillkit, setSearchingSkillkit] = useState(false)
  // SkillsMP (built-in source) state
  const [skillsmpApiKey, setSkillsmpApiKey] = useState('')
  const [skillsmpConfigured, setSkillsmpConfigured] = useState(false)
  const [skillsmpQuery, setSkillsmpQuery] = useState('')
  const [skillsmpResults, setSkillsmpResults] = useState<RegistrySkillItem[]>([])
  const [searchingSkillsmp, setSearchingSkillsmp] = useState(false)
  const [savingSkillsmp, setSavingSkillsmp] = useState(false)

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

  // Load SkillsMP configured state when Browse tab is shown
  useEffect(() => {
    if (tab === 'browse' && http) {
      http
        .getAgentTools()
        .then((data) =>
          setSkillsmpConfigured(
            !!(data.builtin as { skillsmp?: { configured?: boolean } })?.skillsmp?.configured
          )
        )
        .catch(() => {})
    }
  }, [tab, http])

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

  const openDetailPanel = useCallback(
    async (name: string) => {
      setDetailPanelSkill(name)
      const skill = skills.find((s) => s.name === name)
      if (skill?.body !== undefined) return
      if (!http) return
      try {
        const full = (await http.getSkill(name)) as SkillItem
        const idx = skills.findIndex((s) => s.name === name)
        if (idx >= 0) {
          const updated = [...skills]
          updated[idx] = { ...updated[idx], body: full.body }
          setSkills(updated)
        }
      } catch {
        // keep panel open with whatever we have
      }
    },
    [http, skills]
  )

  const closeDetailPanel = useCallback(() => {
    setDetailPanelSkill(null)
    setEditingSkill(null)
  }, [])

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

  const getItemKey = (item: RegistrySkillItem) =>
    item.registryKey ?? `${item.owner}/${item.repo}/${item.skillPath}`

  const handleInstall = async (item: RegistrySkillItem) => {
    if (!http) return
    const itemKey = getItemKey(item)
    setInstalling(itemKey)
    try {
      const source =
        item.source === 'github' ||
        item.source === 'curated' ||
        item.source === 'skillkit' ||
        item.source === 'skillsmp'
          ? item.source
          : undefined
      await http.installRegistrySkill(item.owner, item.repo, item.skillPath, source)
      toast.success(`已安装 Skill: ${item.name}`)
      loadSkills()
      http
        .getFeaturedSkills()
        .then((data) => setFeaturedSkills(data.skills as RegistrySkillItem[]))
        .catch(() => {})
      if (collectionSkills.length > 0) {
        http
          .getCollectionSkills(
            collectionSkills[0].owner,
            collectionSkills[0].repo,
            collectionPath || 'skills'
          )
          .then((data) => setCollectionSkills(data.skills as RegistrySkillItem[]))
          .catch(() => {})
      }
      if (skillkitResults.length > 0 && skillkitQuery.trim()) {
        http
          .searchSkillKitRegistry(skillkitQuery.trim())
          .then((res) => setSkillkitResults((res.items ?? []) as RegistrySkillItem[]))
          .catch(() => {})
      }
      if (skillsmpResults.length > 0 && skillsmpQuery.trim()) {
        http
          .searchSkillsMPRegistry(skillsmpQuery.trim())
          .then((res) => setSkillsmpResults((res.items ?? []) as RegistrySkillItem[]))
          .catch(() => {})
      }
    } catch (e) {
      let msg = (e as { error?: string })?.error ?? (e instanceof Error ? e.message : String(e))
      if (e instanceof Error && typeof msg === 'string' && msg.includes('"error"')) {
        try {
          const json = JSON.parse(msg.replace(/^[^:]+:\s*/, '')) as { error?: string }
          if (typeof json?.error === 'string') msg = json.error
        } catch {
          // ignore parse failure
        }
      }
      toast.error(msg ? (msg.length > 80 ? msg : `安装失败: ${msg}`) : '安装失败')
    } finally {
      setInstalling(null)
    }
  }

  const handleLoadCollection = async () => {
    const trimmed = collectionOwnerRepo.trim()
    if (!trimmed || !http) return
    const parts = trimmed
      .split('/')
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length < 2) {
      toast.error('请输入 owner/repo，如 anthropics/skills')
      return
    }
    const [owner, repo] = parts
    setLoadingCollection(true)
    setCollectionSkills([])
    try {
      const data = (await http.getCollectionSkills(owner, repo, collectionPath || 'skills')) as {
        skills: RegistrySkillItem[]
      }
      setCollectionSkills(data.skills)
      if (data.skills.length === 0) {
        toast.info('该路径下未发现 Skills')
      }
    } catch (e) {
      onLog(`加载集合失败: ${e}`, 'error')
      toast.error('加载集合失败')
    } finally {
      setLoadingCollection(false)
    }
  }

  const handleSearchSkillKit = async (q: string) => {
    setSkillkitQuery(q)
    if (!http) return
    if (!q.trim()) {
      setSkillkitResults([])
      return
    }
    setSearchingSkillkit(true)
    try {
      const result = (await http.searchSkillKitRegistry(q.trim())) as {
        items: RegistrySkillItem[]
        totalCount: number
        query: string
      }
      setSkillkitResults(result.items ?? [])
    } catch (e) {
      onLog(`SkillKit 搜索失败: ${e}`, 'error')
      setSkillkitResults([])
    } finally {
      setSearchingSkillkit(false)
    }
  }

  const handleSaveSkillsMPApiKey = async () => {
    if (!http) return
    setSavingSkillsmp(true)
    try {
      await http.updateSkillsMPSettings({ apiKey: skillsmpApiKey.trim() || undefined })
      setSkillsmpConfigured(!!skillsmpApiKey.trim())
      setSkillsmpApiKey('')
      toast.success('SkillsMP API Key 已保存')
    } catch (e) {
      toast.error(`保存失败: ${e}`)
    } finally {
      setSavingSkillsmp(false)
    }
  }

  const handleSearchSkillsMP = async (q: string) => {
    setSkillsmpQuery(q)
    if (!http) return
    if (!q.trim()) {
      setSkillsmpResults([])
      return
    }
    setSearchingSkillsmp(true)
    try {
      const result = (await http.searchSkillsMPRegistry(q.trim())) as {
        items: RegistrySkillItem[]
        totalCount: number
        query: string
      }
      setSkillsmpResults(result.items ?? [])
    } catch (e) {
      onLog(`SkillsMP 搜索失败: ${e}`, 'error')
      setSkillsmpResults([])
    } finally {
      setSearchingSkillsmp(false)
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
      .match(/(?:github\.com\/)?([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?:\/(?:tree\/[^/]+\/)?(.+))?/)
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
    if (loading) {
      return (
        <Flexbox horizontal align="center" gap={8} style={{ padding: 24 }}>
          <Spin size="small" />
          <Text type="secondary">加载中...</Text>
        </Flexbox>
      )
    }
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
          <div
            className="skill-entry-list skill-entry-list--grid skill-entry-list--grid-installed"
            role="list"
            aria-label="已安装 Skills 列表"
          >
            {skills.map((skill) => {
              const isEditing = editingSkill === skill.name

              return (
                <ContentCard
                  key={skill.name}
                  variant="default"
                  hoverable
                  className="skill-entry-card"
                  style={{ cursor: 'default' }}
                >
                  <div
                    className="skill-entry-card__row"
                    onClick={() => openDetailPanel(skill.name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openDetailPanel(skill.name)
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`查看 ${skill.name} 详情`}
                  >
                    <Zap
                      size={16}
                      style={{ color: 'var(--ant-color-warning)', flexShrink: 0 }}
                      aria-hidden
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="skill-entry-card__title">{skill.name}</div>
                      <div className="skill-entry-card__desc">{skill.description}</div>
                    </div>
                    <div className="skill-entry-card__meta">
                      {skill.source && skill.source !== 'prizm' && (
                        <Tag size="small" style={{ fontSize: 11 }}>
                          {skill.source}
                        </Tag>
                      )}
                      {skill.license && (
                        <Tag size="small" style={{ fontSize: 11 }}>
                          {skill.license}
                        </Tag>
                      )}
                      <ActionIcon
                        icon={Edit3}
                        size="small"
                        title="编辑内容"
                        aria-label={`编辑 ${skill.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingSkill(skill.name)
                          setEditBody(skill.body ?? '')
                          openDetailPanel(skill.name)
                        }}
                      />
                      <ActionIcon
                        icon={Trash2}
                        size="small"
                        title="删除"
                        aria-label={`删除 ${skill.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(skill.name)
                        }}
                      />
                    </div>
                  </div>
                </ContentCard>
              )
            })}
          </div>
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

        {/* Skill 内容详情：弹出抽屉 */}
        {detailPanelSkill &&
          (() => {
            const skill = skills.find((s) => s.name === detailPanelSkill)
            if (!skill) return null
            const isEditing = editingSkill === detailPanelSkill
            return (
              <ModalSidebar
                open={!!detailPanelSkill}
                onClose={closeDetailPanel}
                title={
                  <Flexbox horizontal align="center" gap={8}>
                    <Zap size={18} style={{ color: 'var(--ant-color-warning)' }} />
                    {skill.name}
                  </Flexbox>
                }
                width={520}
                extra={
                  !isEditing ? (
                    <Button
                      type="text"
                      size="small"
                      icon={<Edit3 size={14} />}
                      onClick={() => {
                        setEditingSkill(skill.name)
                        setEditBody(skill.body ?? '')
                      }}
                    >
                      编辑
                    </Button>
                  ) : null
                }
                bodyStyle={{
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  padding: 16
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    minHeight: 0,
                    gap: 16
                  }}
                >
                  {skill.description && (
                    <div style={{ flexShrink: 0 }}>
                      <Text
                        type="secondary"
                        style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
                      >
                        描述
                      </Text>
                      <Text style={{ fontSize: 13, lineHeight: 1.5 }}>{skill.description}</Text>
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      flex: 1,
                      minHeight: 0,
                      overflow: 'hidden'
                    }}
                  >
                    <Text
                      type="secondary"
                      style={{ fontSize: 12, display: 'block', marginBottom: 8, flexShrink: 0 }}
                    >
                      指令内容
                    </Text>
                    {isEditing ? (
                      <Flexbox gap={12} style={{ flex: 1, minHeight: 0, flexDirection: 'column' }}>
                        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                          <TextArea
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            placeholder="Skill 指令 (Markdown)"
                            style={{
                              fontFamily: 'var(--ant-font-family-mono)',
                              fontSize: 13,
                              height: '100%',
                              minHeight: 120
                            }}
                          />
                        </div>
                        <Flexbox horizontal gap={8} style={{ flexShrink: 0 }}>
                          <Button
                            type="primary"
                            onClick={() => {
                              handleSaveEdit(skill.name)
                              setEditingSkill(null)
                            }}
                          >
                            保存
                          </Button>
                          <Button onClick={() => setEditingSkill(null)}>取消</Button>
                        </Flexbox>
                      </Flexbox>
                    ) : (
                      <div
                        style={{
                          flex: 1,
                          minHeight: 0,
                          padding: 12,
                          background: 'var(--ant-color-fill-quaternary)',
                          borderRadius: 8,
                          fontSize: 13,
                          lineHeight: 1.6,
                          overflow: 'auto'
                        }}
                      >
                        {skill.body ? (
                          <Markdown>{skill.body}</Markdown>
                        ) : (
                          <Text type="secondary">(无指令内容)</Text>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </ModalSidebar>
            )
          })()}
      </>
    )
  }

  // ---- Render: Browse Tab ----
  function renderBrowse() {
    const displayItems = searchQuery.trim() ? searchResults : featuredSkills

    return (
      <Flexbox gap={16} style={{ flexDirection: 'column' }}>
        <ContentCard variant="default" hoverable={false} className="settings-card">
          <ContentCardHeader>
            <Flexbox horizontal align="center" gap={8}>
              <Star size={16} aria-hidden />
              <span>精选 / 搜索 GitHub</span>
            </Flexbox>
          </ContentCardHeader>
          <ContentCardBody>
            <p className="form-hint" style={{ marginBottom: 12 }}>
              精选 Skills 从默认集合仓库动态拉取；输入关键词可搜索 GitHub 上的 Skills。
            </p>
            <div style={{ marginBottom: 12 }}>
              <SearchInput
                onSearch={handleSearch}
                placeholder="搜索 GitHub 上的 Skills..."
                loading={searching}
              />
            </div>
            {searching ? (
              <Flexbox horizontal align="center" gap={8} style={{ padding: 12 }}>
                <Spin size="small" />
                <Text type="secondary">搜索中...</Text>
              </Flexbox>
            ) : displayItems.length === 0 ? (
              <EmptyState
                icon={Globe}
                description={searchQuery ? '未找到匹配的 Skills' : '暂无精选数据，请先搜索'}
              />
            ) : (
              <div
                className="skill-entry-list skill-entry-list--grid"
                role="list"
                aria-label="Skills 列表"
              >
                {displayItems.map((item) => (
                  <RegistrySkillCard
                    key={getItemKey(item)}
                    item={item}
                    installed={item.installed ?? installedNames.has(item.name)}
                    installing={installing === getItemKey(item)}
                    onInstall={() => handleInstall(item)}
                    showStars
                  />
                ))}
              </div>
            )}
          </ContentCardBody>
        </ContentCard>

        {/* SkillKit 市场（内置源） */}
        <ContentCard variant="default" hoverable={false} className="settings-card">
          <ContentCardHeader>
            <Flexbox horizontal align="center" gap={8}>
              <Search size={16} aria-hidden />
              <span>SkillKit 市场（内置源）</span>
            </Flexbox>
          </ContentCardHeader>
          <ContentCardBody>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              搜索 SkillKit 聚合的 Skills，安装后从 GitHub 拉取 SKILL.md
              至本地。若默认托管服务不可用，可在本机运行
              <code style={{ margin: '0 2px' }}>npx skillkit serve</code>
              并设置环境变量{' '}
              <code style={{ margin: '0 2px' }}>PRIZM_SKILLKIT_API_URL=http://localhost:3737</code>
              。
            </Text>
            <div style={{ marginBottom: 8 }}>
              <SearchInput
                onSearch={handleSearchSkillKit}
                placeholder="搜索 SkillKit 市场..."
                loading={searchingSkillkit}
              />
            </div>
            {searchingSkillkit && (
              <Flexbox horizontal align="center" gap={8} style={{ padding: 8 }}>
                <Spin size="small" />
                <Text type="secondary">搜索中...</Text>
              </Flexbox>
            )}
            {skillkitResults.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                  搜索结果（{skillkitResults.length} 个）
                </Text>
                <div className="skill-entry-list skill-entry-list--grid">
                  {skillkitResults.map((item) => (
                    <RegistrySkillCard
                      key={getItemKey(item)}
                      item={{ ...item, score: (item as { score?: number }).score }}
                      installed={item.installed ?? installedNames.has(item.name)}
                      installing={installing === getItemKey(item)}
                      onInstall={() => handleInstall(item)}
                      showScore
                    />
                  ))}
                </div>
              </div>
            )}
          </ContentCardBody>
        </ContentCard>

        {/* SkillsMP 市场（内置源） */}
        <ContentCard variant="default" hoverable={false} className="settings-card">
          <ContentCardHeader>
            <Flexbox horizontal align="center" gap={8}>
              <Globe size={16} aria-hidden />
              <span>SkillsMP 市场（内置源）</span>
            </Flexbox>
          </ContentCardHeader>
          <ContentCardBody>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              搜索 SkillsMP 聚合的 26 万+ Skills。需在
              <a
                href="https://skillsmp.com/auth/login"
                target="_blank"
                rel="noreferrer"
                style={{ margin: '0 4px' }}
              >
                skillsmp.com
              </a>
              获取 API Key（格式 sk_live_xxx）并保存后即可搜索、一键安装。
            </Text>
            <Flexbox horizontal gap={8} align="center" style={{ marginBottom: 12 }}>
              <Input
                type="password"
                size="small"
                placeholder={skillsmpConfigured ? '已配置，输入新 Key 可覆盖' : 'sk_live_xxx'}
                value={skillsmpApiKey}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSkillsmpApiKey(e.target.value)
                }
                style={{ flex: 1, maxWidth: 320 }}
              />
              <Button
                size="small"
                type="primary"
                loading={savingSkillsmp}
                onClick={handleSaveSkillsMPApiKey}
              >
                保存 API Key
              </Button>
            </Flexbox>
            <div style={{ marginBottom: 8 }}>
              <SearchInput
                onSearch={handleSearchSkillsMP}
                placeholder="搜索 SkillsMP 市场..."
                loading={searchingSkillsmp}
              />
            </div>
            {searchingSkillsmp && (
              <Flexbox horizontal align="center" gap={8} style={{ padding: 8 }}>
                <Spin size="small" />
                <Text type="secondary">搜索中...</Text>
              </Flexbox>
            )}
            {skillsmpResults.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                  搜索结果（{skillsmpResults.length} 个）
                </Text>
                <div className="skill-entry-list skill-entry-list--grid">
                  {skillsmpResults.map((item) => (
                    <RegistrySkillCard
                      key={getItemKey(item)}
                      item={item}
                      installed={item.installed ?? installedNames.has(item.name)}
                      installing={installing === getItemKey(item)}
                      onInstall={() => handleInstall(item)}
                    />
                  ))}
                </div>
              </div>
            )}
          </ContentCardBody>
        </ContentCard>

        {/* 浏览集合仓库 */}
        <ContentCard variant="default" hoverable={false} className="settings-card">
          <ContentCardHeader>
            <Flexbox horizontal align="center" gap={8}>
              <BookOpen size={16} aria-hidden />
              <span>浏览集合仓库</span>
            </Flexbox>
          </ContentCardHeader>
          <ContentCardBody>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              输入标准 skill 集合仓库的 owner/repo（可选子路径，默认
              skills），加载后列出该仓库下全部 Skills 并支持一键安装。
            </Text>
            <Flexbox horizontal gap={8} style={{ marginBottom: 8 }}>
              <Input
                size="small"
                placeholder="owner/repo，如 anthropics/skills"
                value={collectionOwnerRepo}
                onChange={(e) => setCollectionOwnerRepo(e.target.value)}
                style={{ flex: 1 }}
              />
              <Input
                size="small"
                placeholder="路径，默认 skills"
                value={collectionPath}
                onChange={(e) => setCollectionPath(e.target.value)}
                style={{ width: 120 }}
              />
              <Button
                size="small"
                type="primary"
                loading={loadingCollection}
                onClick={handleLoadCollection}
              >
                加载
              </Button>
            </Flexbox>
            {loadingCollection && (
              <Flexbox horizontal align="center" gap={8} style={{ padding: 8 }}>
                <Spin size="small" />
                <Text type="secondary">加载中...</Text>
              </Flexbox>
            )}
            {collectionSkills.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                  集合内 Skills（{collectionSkills.length} 个）
                </Text>
                <div className="skill-entry-list skill-entry-list--grid">
                  {collectionSkills.map((item) => (
                    <RegistrySkillCard
                      key={getItemKey(item)}
                      item={item}
                      installed={item.installed ?? installedNames.has(item.name)}
                      installing={installing === getItemKey(item)}
                      onInstall={() => handleInstall(item)}
                    />
                  ))}
                </div>
              </div>
            )}
          </ContentCardBody>
        </ContentCard>
      </Flexbox>
    )
  }

  // ---- Render: Import Tab ----
  function renderImport() {
    return (
      <Flexbox gap={16} style={{ flexDirection: 'column' }}>
        <ContentCard variant="default" hoverable={false} className="settings-card">
          <ContentCardHeader>
            <Flexbox horizontal align="center" gap={8}>
              <Import size={16} aria-hidden />
              <span>从 Claude Code 导入</span>
            </Flexbox>
          </ContentCardHeader>
          <ContentCardBody>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              自动扫描 ~/.claude/skills/ 和项目 .claude/skills/ 目录
            </Text>
            <Button icon={<Import size={14} />} size="small" onClick={handleImportClaudeCode}>
              扫描并导入
            </Button>
          </ContentCardBody>
        </ContentCard>

        <ContentCard variant="default" hoverable={false} className="settings-card">
          <ContentCardHeader>
            <Flexbox horizontal align="center" gap={8}>
              <FolderOpen size={16} aria-hidden />
              <span>从本地目录导入</span>
            </Flexbox>
          </ContentCardHeader>
          <ContentCardBody>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
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
          </ContentCardBody>
        </ContentCard>

        <ContentCard variant="default" hoverable={false} className="settings-card">
          <ContentCardHeader>
            <Flexbox horizontal align="center" gap={8}>
              <Globe size={16} aria-hidden />
              <span>从标准 skill 仓库安装</span>
            </Flexbox>
          </ContentCardHeader>
          <ContentCardBody>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              输入 GitHub 仓库路径（含 SKILL.md 的目录），如 anthropics/skills/skills/code-review
              或完整 URL
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
          </ContentCardBody>
        </ContentCard>
      </Flexbox>
    )
  }

  return (
    <div className="settings-section" role="region" aria-label="技能设置">
      <div className="settings-section-header">
        <h2>Agent Skills</h2>
        <p className="form-hint">
          管理 Agent 技能，兼容 Anthropic Agent Skills 规范。Skills 可在对话中通过 /skill
          命令或关键词自动激活。
        </p>
      </div>

      <div style={{ marginBottom: 12 }} role="tablist" aria-label="技能已安装、浏览、导入">
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

      {tab === 'installed' && (
        <div role="tabpanel" id="skills-installed-tabpanel" aria-labelledby="skills-installed-tab">
          {renderInstalled()}
        </div>
      )}
      {tab === 'browse' && (
        <div role="tabpanel" id="skills-browse-tabpanel" aria-labelledby="skills-browse-tab">
          {renderBrowse()}
        </div>
      )}
      {tab === 'import' && (
        <div role="tabpanel" id="skills-import-tabpanel" aria-labelledby="skills-import-tab">
          {renderImport()}
        </div>
      )}
    </div>
  )
}
