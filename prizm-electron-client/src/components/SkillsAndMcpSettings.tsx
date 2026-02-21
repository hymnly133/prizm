/**
 * 技能与 MCP 设置容器：顶层标签页（技能 | MCP）+ 分别挂载 SkillsSettings / McpSettings
 */
import { memo, useState } from 'react'
import { Segmented } from './ui/Segmented'
import { SkillsSettings } from './SkillsSettings'
import { McpSettings } from './McpSettings'
import type { PrizmClient } from '@prizm/client-core'

export interface SkillsAndMcpSettingsProps {
  http: PrizmClient | null
  onLog: (msg: string, type?: 'info' | 'success' | 'error' | 'warning') => void
}

type MainTabKey = 'skills' | 'mcp'

function SkillsAndMcpSettingsInner({ http, onLog }: SkillsAndMcpSettingsProps) {
  const [mainTab, setMainTab] = useState<MainTabKey>('skills')

  return (
    <div className="settings-section" role="region" aria-label="技能与 MCP 设置">
      <div className="settings-section-header">
        <h2>技能与 MCP</h2>
        <p className="form-hint">
          管理 Agent 技能与 MCP 服务器，技能可增强对话能力，MCP 提供外部工具与数据源。
        </p>
      </div>
      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={mainTab}
          onChange={(v) => setMainTab(v as MainTabKey)}
          options={[
            { label: '技能', value: 'skills' },
            { label: 'MCP', value: 'mcp' }
          ]}
          role="tablist"
          aria-label="技能与 MCP 切换"
        />
      </div>
      {mainTab === 'skills' && (
        <div role="tabpanel" id="skills-tabpanel" aria-labelledby="skills-tab">
          <SkillsSettings http={http} onLog={onLog} />
        </div>
      )}
      {mainTab === 'mcp' && (
        <div role="tabpanel" id="mcp-tabpanel" aria-labelledby="mcp-tab">
          <McpSettings http={http} onLog={onLog} />
        </div>
      )}
    </div>
  )
}

export const SkillsAndMcpSettings = memo(SkillsAndMcpSettingsInner)
