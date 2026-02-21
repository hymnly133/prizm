/**
 * SkillManagerPanel — 会话内 Skill / MCP 管理浮层
 * 全链路仅用 allowedSkills：每行一个「允许」Switch，全关 = 不限制（全部生效）。
 */
import { memo, createContext, useContext, useMemo } from 'react'
import { ActionIcon, Button, Text } from '@lobehub/ui'
import type { ListItemProps } from '@lobehub/ui'
import { Switch } from 'antd'
import { motion } from 'motion/react'
import { Sparkles, X, Zap, Plug } from 'lucide-react'
import {
  useSkillManagerPanel,
  type UseSkillManagerPanelResult
} from '../../hooks/useSkillManagerPanel'
import { SectionHeader } from '../ui/SectionHeader'
import { EmptyState } from '../ui/EmptyState'
import { LoadingPlaceholder } from '../ui/LoadingPlaceholder'
import { AccentList } from '../ui/AccentList'

import '../../styles/agent.css'

// ── Context (Provider/Selector) ──

const SkillManagerPanelContext = createContext<UseSkillManagerPanelResult | null>(null)

function useSkillManagerPanelContext(): UseSkillManagerPanelResult {
  const ctx = useContext(SkillManagerPanelContext)
  if (!ctx) throw new Error('SkillManagerPanel 必须在 SkillManagerPanelProvider 内使用')
  return ctx
}

// ── Panel Header ──

const PanelHeader = memo<{ onClose?: () => void }>(function PanelHeader({ onClose }) {
  return (
    <div className="skill-manager-panel__header">
      <div className="skill-manager-panel__title-row">
        <Sparkles size={16} className="skill-manager-panel__title-icon" aria-hidden />
        <Text style={{ fontWeight: 600, fontSize: 14 }}>Skills & MCP</Text>
      </div>
      {onClose && (
        <ActionIcon
          icon={X}
          size="small"
          onClick={onClose}
          aria-label="关闭"
          className="skill-manager-panel__close"
        />
      )}
    </div>
  )
})

// ── 统一列表容器类名（Skills / MCP 共用同一风格） ──
const LIST_CLASS = 'skill-manager-panel__list'

// ── Skills 单一列表（仅「允许」一枚 Switch） ──

const SkillsSection = memo(function SkillsSection() {
  const { allSkills, hasSession, allowedSkills, toggleSkillAllowed } = useSkillManagerPanelContext()

  const skillItems: ListItemProps[] = useMemo(
    () =>
      allSkills.map((s) => {
        const allowed = allowedSkills.length === 0 || allowedSkills.includes(s.name)
        return {
          key: s.name,
          title: s.name,
          description: s.description
            ? s.description.length > 60
              ? `${s.description.slice(0, 60)}…`
              : s.description
            : undefined,
          addon: (
            <span onClick={(e) => e.stopPropagation()} className="skill-manager-panel__row-addon">
              <Switch
                size="small"
                checked={allowed}
                disabled={!hasSession}
                onChange={(on) => toggleSkillAllowed(s.name, on)}
                aria-label={allowed ? `禁止会话使用 ${s.name}` : `允许会话使用 ${s.name}`}
              />
            </span>
          ),
          onClick: () => hasSession && toggleSkillAllowed(s.name, !allowed),
          active: allowed
        }
      }),
    [allSkills, allowedSkills, hasSession, toggleSkillAllowed]
  )

  if (allSkills.length === 0) return null

  const allowedCount = allowedSkills.length > 0 ? allowedSkills.length : undefined

  return (
    <section className="skill-manager-panel__section" aria-label="Skills">
      <SectionHeader
        icon={Zap}
        title="Skills"
        count={allowedCount}
        className="skill-manager-panel__section-header"
      />
      <Text type="secondary" className="skill-manager-panel__section-hint">
        允许 = 本会话可注入的 Skill；全关 = 不限制（全部生效）。
      </Text>
      <div className={LIST_CLASS}>
        <AccentList items={skillItems} />
      </div>
    </section>
  )
})

// ── MCP 单一列表 + 保存按钮 ──

const McpSection = memo(function McpSection() {
  const { mcpServers, allowedMcpServerIds, toggleMcpAllowed, saveAllowlists, saving, hasSession } =
    useSkillManagerPanelContext()

  const mcpItems: ListItemProps[] = useMemo(() => {
    if (mcpServers.length === 0) {
      return [
        {
          key: '__mcp_empty__',
          title: '请先在设置中添加 MCP 服务器',
          style: { fontSize: 12, color: 'var(--ant-color-text-tertiary)' }
        }
      ]
    }
    return mcpServers.map((s) => {
      const allowed = allowedMcpServerIds.length === 0 || allowedMcpServerIds.includes(s.id)
      return {
        key: s.id,
        title: s.name,
        addon: (
          <span onClick={(e) => e.stopPropagation()} className="skill-manager-panel__row-addon">
            <Switch
              size="small"
              checked={allowed}
              onChange={(on) => toggleMcpAllowed(s.id, on)}
              aria-label={`允许会话使用 MCP: ${s.name}`}
            />
          </span>
        ),
        onClick: () => toggleMcpAllowed(s.id, !allowed)
      }
    })
  }, [mcpServers, allowedMcpServerIds, toggleMcpAllowed])

  return (
    <section className="skill-manager-panel__section" aria-label="MCP 服务器">
      <SectionHeader
        icon={Plug}
        title="MCP 服务器"
        className="skill-manager-panel__section-header"
      />
      <div className={LIST_CLASS}>
        <AccentList items={mcpItems} />
      </div>
      <Button
        type="primary"
        size="small"
        loading={saving}
        disabled={!hasSession}
        onClick={() => void saveAllowlists()}
        className="skill-manager-panel__save-btn"
      >
        保存到当前会话
      </Button>
    </section>
  )
})

// ── 主面板（Provider + 组合） ──

export interface SkillManagerPanelProps {
  sessionId: string
  scope: string
  onClose?: () => void
}

export const SkillManagerPanel = memo<SkillManagerPanelProps>(function SkillManagerPanel({
  sessionId,
  scope,
  onClose
}) {
  const value = useSkillManagerPanel({ sessionId, scope })
  const { loading, hasSession, allSkills } = value

  const showEmpty = !loading && allSkills.length === 0
  const showHint = !hasSession

  return (
    <SkillManagerPanelContext.Provider value={value}>
      <div className="skill-manager-panel" role="dialog" aria-label="Skills 与 MCP 管理">
        <PanelHeader onClose={onClose} />

        {showHint && (
          <div className="skill-manager-panel__hint">
            <Text type="secondary">请先创建或选择会话后再设置允许的 Skill。</Text>
          </div>
        )}

        <div className="skill-manager-panel__intro">
          <Text type="secondary">
            开启「允许」后，该 Skill 说明会注入到对话上下文，发消息时模型会参考。
          </Text>
        </div>

        {loading && (
          <div className="skill-manager-panel__loading">
            <LoadingPlaceholder text="加载中…" />
          </div>
        )}

        {!loading && (
          <motion.div
            className="skill-manager-panel__body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <SkillsSection />

            {showEmpty && (
              <div className="skill-manager-panel__empty">
                <EmptyState icon={Sparkles} description="暂无可用 Skills，前往设置页面添加" />
              </div>
            )}

            <McpSection />
          </motion.div>
        )}
      </div>
    </SkillManagerPanelContext.Provider>
  )
})

SkillManagerPanel.displayName = 'SkillManagerPanel'

export { useSkillManagerPanelContext }
