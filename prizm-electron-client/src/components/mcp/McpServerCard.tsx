/**
 * 统一的 MCP 服务器条目卡片
 * 用于设置页 MCP 服务器列表，保证与技能条目卡片一致的「卡片实体」视觉与交互。
 */
import { memo } from 'react'
import { ActionIcon, Button, Flexbox, Icon, Text } from '@lobehub/ui'
import { ContentCard } from '../ui/ContentCard'
import type { McpServerConfig } from '@prizm/client-core'
import { Edit, Link, Terminal, Trash2 } from 'lucide-react'

export interface McpServerCardProps {
  server: McpServerConfig
  onEdit: () => void
  onDelete: () => void
  onTest: () => void
  testDisabled?: boolean
}

const TRANSPORT_LABELS: Record<string, string> = {
  stdio: 'STDIO',
  'streamable-http': 'Streamable HTTP',
  sse: 'SSE'
}

function McpServerCardInner({ server, onEdit, onDelete, onTest, testDisabled }: McpServerCardProps) {
  const transportLabel = TRANSPORT_LABELS[server.transport] ?? server.transport

  const rowStyle = {
    paddingBlock: 4,
    paddingInline: 0,
    borderBottom: '1px solid var(--ant-color-border-secondary, var(--ant-color-fill-quaternary))'
  } as const
  const labelStyle = {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--ant-color-text-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: 6
  } as const
  const valueStyle = {
    paddingBlock: 2,
    paddingInline: 8,
    fontFamily: 'var(--ant-font-family-code)',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--ant-color-text)',
    background: 'var(--ant-color-fill-quaternary)',
    borderRadius: 4
  } as const

  return (
    <ContentCard
      variant="default"
      hoverable={false}
      className="settings-card"
      style={{ cursor: 'default', padding: '12px 16px' }}
    >
      <Flexbox horizontal align="center" justify="space-between" gap={8} style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        <Flexbox horizontal align="center" gap={8}>
          <Text strong>{server.name}</Text>
          <Text style={{ fontSize: 12 }} type="secondary">
            {server.id}
          </Text>
        </Flexbox>
        <Flexbox horizontal gap={4}>
          <ActionIcon
            icon={Edit}
            onClick={onEdit}
            size="small"
            title="编辑"
            aria-label={`编辑 ${server.name}`}
          />
          <ActionIcon
            icon={Trash2}
            onClick={onDelete}
            size="small"
            title="删除"
            aria-label={`删除 ${server.name}`}
          />
          <Button onClick={onTest} size="small" disabled={testDisabled}>
            测试
          </Button>
        </Flexbox>
      </Flexbox>
      <Flexbox gap={0} style={{ paddingInline: 0 }}>
        <Flexbox horizontal align="center" justify="space-between" style={rowStyle}>
          <span style={labelStyle}>
            <Icon icon={server.transport === 'stdio' ? Terminal : Link} size={14} />
            传输类型
          </span>
          <Text style={valueStyle}>{transportLabel}</Text>
        </Flexbox>
        {server.url && (
          <Flexbox horizontal align="center" justify="space-between" style={rowStyle}>
            <span style={labelStyle}>URL</span>
            <span style={valueStyle}>{server.url}</span>
          </Flexbox>
        )}
        {server.stdio && (
          <>
            {server.stdio.command && (
              <Flexbox horizontal align="center" justify="space-between" style={rowStyle}>
                <span style={labelStyle}>命令</span>
                <span style={valueStyle}>{server.stdio.command}</span>
              </Flexbox>
            )}
            {server.stdio.args && server.stdio.args.length > 0 && (
              <Flexbox horizontal align="center" justify="space-between" style={rowStyle}>
                <span style={labelStyle}>参数</span>
                <span style={valueStyle}>{server.stdio.args.join(' ')}</span>
              </Flexbox>
            )}
            {server.stdio.env && Object.keys(server.stdio.env).length > 0 && (
              <Flexbox horizontal align="center" justify="space-between" style={rowStyle}>
                <span style={labelStyle}>环境变量</span>
                <span style={valueStyle}>已配置</span>
              </Flexbox>
            )}
          </>
        )}
        {server.headers && Object.keys(server.headers).length > 0 && (
          <Flexbox horizontal align="center" justify="space-between" style={rowStyle}>
            <span style={labelStyle}>鉴权</span>
            <span style={valueStyle}>已配置</span>
          </Flexbox>
        )}
      </Flexbox>
    </ContentCard>
  )
}

export const McpServerCard = memo(McpServerCardInner)
