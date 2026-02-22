/**
 * 技能与 MCP 设置容器：技能与搜索配置 + 顶层标签页（技能 | MCP）+ 分别挂载 SkillsSettings / McpSettings
 */
import { memo, useCallback, useEffect, useState } from 'react'
import { Button, Form, Input, toast } from '@lobehub/ui'
import { Segmented } from './ui/Segmented'
import { SkillsSettings } from './SkillsSettings'
import { McpSettings } from './McpSettings'
import type { PrizmClient, ServerConfigSkills } from '@prizm/client-core'
import { Globe } from 'lucide-react'

export interface SkillsAndMcpSettingsProps {
  http: PrizmClient | null
  onLog: (msg: string, type?: 'info' | 'success' | 'error' | 'warning') => void
}

type MainTabKey = 'skills' | 'mcp'

function SkillsAndMcpSettingsInner({ http, onLog }: SkillsAndMcpSettingsProps) {
  const [mainTab, setMainTab] = useState<MainTabKey>('skills')
  const [skillsConfig, setSkillsConfig] = useState<Partial<ServerConfigSkills>>({})
  const [skillsConfigLoading, setSkillsConfigLoading] = useState(false)
  const [skillsConfigSaving, setSkillsConfigSaving] = useState(false)

  const loadSkillsConfig = useCallback(async () => {
    if (!http) return
    setSkillsConfigLoading(true)
    try {
      const res = await http.getServerConfig()
      setSkillsConfig(res.skills ?? {})
    } catch (e) {
      onLog(`加载技能配置失败: ${e}`, 'error')
    } finally {
      setSkillsConfigLoading(false)
    }
  }, [http, onLog])

  useEffect(() => {
    void loadSkillsConfig()
  }, [loadSkillsConfig])

  async function handleSaveSkillsConfig() {
    if (!http) return
    setSkillsConfigSaving(true)
    try {
      await http.updateServerConfig({ skills: skillsConfig })
      toast.success('技能与搜索配置已保存')
      onLog('技能与搜索配置已保存', 'success')
      void loadSkillsConfig()
    } catch (e) {
      toast.error(String(e))
      onLog(`保存技能配置失败: ${e}`, 'error')
    } finally {
      setSkillsConfigSaving(false)
    }
  }

  return (
    <div className="settings-section" role="region" aria-label="技能与 MCP 设置">
      <div className="settings-section-header">
        <h2>技能与 MCP</h2>
        <p className="form-hint">
          管理 Agent 技能与 MCP 服务器，技能可增强对话能力，MCP 提供外部工具与数据源。
        </p>
      </div>

      {/* 技能与搜索配置 */}
      <div className="settings-card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--ant-color-text-heading)'
          }}
        >
          <Globe size={16} />
          技能与搜索
        </div>
        <p className="form-hint" style={{ marginTop: 0, marginBottom: 10 }}>
          SkillKit 市场 API 与 GitHub Token（可选，提高限流）
        </p>
        {skillsConfigLoading ? (
          <p className="form-hint">加载中...</p>
        ) : (
          <Form className="compact-form" gap={8} layout="vertical">
            <Form.Item label="SkillKit API 地址" extra="技能市场 API 根地址">
              <Input
                value={skillsConfig.skillKitApiUrl ?? ''}
                onChange={(e) =>
                  setSkillsConfig((c) => ({
                    ...c,
                    skillKitApiUrl: e.target.value.trim() || undefined
                  }))
                }
                placeholder="https://skillkit.sh/api"
              />
            </Form.Item>
            <Form.Item label="GitHub Token" extra="可选，提高 GitHub 请求限流">
              <Input
                type="password"
                value={skillsConfig.githubToken ?? ''}
                onChange={(e) =>
                  setSkillsConfig((c) => ({
                    ...c,
                    githubToken: e.target.value || undefined
                  }))
                }
                placeholder={
                  (skillsConfig as { configured?: boolean })?.configured
                    ? '已配置，输入新值覆盖'
                    : 'ghp_...'
                }
              />
            </Form.Item>
            <div style={{ marginTop: 8 }}>
              <Button
                type="primary"
                onClick={() => void handleSaveSkillsConfig()}
                loading={skillsConfigSaving}
              >
                保存技能与搜索配置
              </Button>
            </div>
          </Form>
        )}
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
