/**
 * SkillManagerPanel — 对话中的 Skill 管理浮层
 *
 * 以 Popover 形式从 ActionBar 触发，展示：
 * 1. 当前会话已激活的 Skills（可取消激活）
 * 2. 可用 Skills（可手动激活）
 */
import { memo, useCallback, useEffect, useState } from 'react'
import { ActionIcon, Flexbox, Tag, Text, toast } from '@lobehub/ui'
import { Sparkles, X, Zap, ZapOff } from 'lucide-react'
import { usePrizmContext } from '../../context/PrizmContext'

interface SkillMeta {
  name: string
  description: string
  enabled: boolean
  source?: string
}

interface ActiveSkill {
  skillName: string
  activatedAt: number
  autoActivated: boolean
}

interface SkillManagerPanelProps {
  sessionId: string
  scope: string
  onClose?: () => void
}

export const SkillManagerPanel = memo<SkillManagerPanelProps>(({ sessionId, scope, onClose }) => {
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient() ?? null

  const [allSkills, setAllSkills] = useState<SkillMeta[]>([])
  const [activeSkills, setActiveSkills] = useState<ActiveSkill[]>([])
  const [loading, setLoading] = useState(false)
  const [activating, setActivating] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!http || !sessionId) return
    setLoading(true)
    try {
      const [skillsData, activeData] = await Promise.all([
        http.listSkills(),
        http.getActiveSessionSkills(sessionId, scope)
      ])
      setAllSkills(skillsData.skills as SkillMeta[])
      setActiveSkills(activeData.skills as ActiveSkill[])
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [http, sessionId, scope])

  useEffect(() => {
    loadData()
  }, [loadData])

  const activeNames = new Set(activeSkills.map((a) => a.skillName))
  const availableSkills = allSkills.filter((s) => !activeNames.has(s.name))

  const handleActivate = useCallback(
    async (name: string) => {
      if (!http) return
      setActivating(name)
      try {
        await http.activateSessionSkill(sessionId, name, scope)
        toast.success(`已激活 Skill: ${name}`)
        await loadData()
      } catch (e) {
        toast.error(`激活失败: ${e}`)
      } finally {
        setActivating(null)
      }
    },
    [http, sessionId, scope, loadData]
  )

  const handleDeactivate = useCallback(
    async (name: string) => {
      if (!http) return
      try {
        await http.deactivateSessionSkill(sessionId, name, scope)
        toast.success(`已取消 Skill: ${name}`)
        await loadData()
      } catch (e) {
        toast.error(`取消失败: ${e}`)
      }
    },
    [http, sessionId, scope, loadData]
  )

  return (
    <div
      className="skill-manager-panel"
      style={{
        width: 320,
        maxHeight: 400,
        overflow: 'auto',
        background: 'var(--ant-color-bg-elevated)',
        borderRadius: 10,
        boxShadow: '0 6px 20px rgba(0,0,0,.15)',
        border: '1px solid var(--ant-color-border)',
        padding: 12
      }}
    >
      <Flexbox horizontal justify="space-between" align="center" style={{ marginBottom: 8 }}>
        <Flexbox horizontal gap={6} align="center">
          <Sparkles size={14} style={{ color: 'var(--ant-color-warning)' }} />
          <Text style={{ fontWeight: 600, fontSize: 13 }}>Skills</Text>
        </Flexbox>
        {onClose && <ActionIcon icon={X} size="small" onClick={onClose} />}
      </Flexbox>

      {/* Active skills */}
      {activeSkills.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
            已激活 ({activeSkills.length})
          </Text>
          <Flexbox gap={4}>
            {activeSkills.map((s) => (
              <Flexbox
                key={s.skillName}
                horizontal
                align="center"
                gap={6}
                style={{
                  padding: '5px 8px',
                  borderRadius: 6,
                  background: 'var(--ant-color-primary-bg)',
                  fontSize: 12
                }}
              >
                <Zap size={12} style={{ color: 'var(--ant-color-warning)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontWeight: 500 }}>{s.skillName}</span>
                {s.autoActivated && (
                  <Tag size="small" style={{ fontSize: 10 }}>
                    自动
                  </Tag>
                )}
                <ActionIcon
                  icon={ZapOff}
                  size={{ blockSize: 20, size: 12 }}
                  title="取消激活"
                  onClick={() => handleDeactivate(s.skillName)}
                />
              </Flexbox>
            ))}
          </Flexbox>
        </div>
      )}

      {/* Available skills */}
      {availableSkills.length > 0 && (
        <div>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
            可用 ({availableSkills.length})
          </Text>
          <Flexbox gap={3}>
            {availableSkills.map((s) => (
              <Flexbox
                key={s.name}
                horizontal
                align="center"
                gap={6}
                style={{
                  padding: '5px 8px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 12,
                  opacity: activating === s.name ? 0.5 : 1,
                  transition: 'background .15s'
                }}
                className="content-card--hoverable"
                onClick={() => handleActivate(s.name)}
              >
                <Zap size={12} style={{ opacity: 0.4, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{s.name}</div>
                  <div
                    style={{
                      fontSize: 11,
                      opacity: 0.6,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {s.description.length > 60
                      ? s.description.slice(0, 60) + '...'
                      : s.description}
                  </div>
                </div>
              </Flexbox>
            ))}
          </Flexbox>
        </div>
      )}

      {allSkills.length === 0 && !loading && (
        <Text
          type="secondary"
          style={{ fontSize: 12, display: 'block', textAlign: 'center', padding: 16 }}
        >
          暂无可用 Skills，前往设置页面添加
        </Text>
      )}
    </div>
  )
})

SkillManagerPanel.displayName = 'SkillManagerPanel'
