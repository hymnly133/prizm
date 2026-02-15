/**
 * 工具卡片 - 使用 Lobe UI Block/Collapse 宽卡片风格
 * 从 client-core 引入元数据与分发逻辑，UI 使用 @lobehub/ui
 * 与文件相关的工具由 PrizmFileToolCards 注册自定义卡片（单击打开预览、下拉详情）
 */
import { Block, Collapse, Flexbox, Icon, Skeleton } from '@lobehub/ui'
import { FileText, Search, Wrench } from 'lucide-react'
import type { ToolCallRecord } from '@prizm/client-core'
import {
  getToolDisplayName,
  getToolMetadata,
  getToolRender,
  isPrizmTool,
  isTavilyTool
} from '@prizm/client-core'

export interface ToolCallCardProps {
  tc: ToolCallRecord
}

function parseArgsSummary(argsStr: string): string {
  try {
    const obj = JSON.parse(argsStr || '{}') as Record<string, unknown>
    const parts: string[] = []
    if (obj.documentId) parts.push(`文档: ${String(obj.documentId).slice(0, 12)}…`)
    else if (obj.noteId) parts.push(`便签: ${String(obj.noteId).slice(0, 12)}…`)
    else if (obj.todoId) parts.push(`待办: ${String(obj.todoId).slice(0, 12)}…`)
    else if (obj.query) parts.push(`关键词: ${String(obj.query).slice(0, 20)}…`)
    else if (obj.title) parts.push(`标题: ${String(obj.title).slice(0, 20)}…`)
    else if (obj.content) parts.push(`内容: ${String(obj.content).slice(0, 30)}…`)
    return parts.join(' ')
  } catch {
    return ''
  }
}

function parseQuery(argsStr: string): string {
  try {
    const obj = JSON.parse(argsStr || '{}') as { query?: string }
    return typeof obj.query === 'string' ? obj.query : ''
  } catch {
    return ''
  }
}

function PrizmToolCard({ tc }: { tc: ToolCallRecord }) {
  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name)
  const meta = getToolMetadata(tc.name)
  const argsSummary = parseArgsSummary(tc.arguments)

  if (status === 'preparing') {
    return (
      <Block variant="filled" shadow>
        <Flexbox gap={8} horizontal align="center">
          <Icon icon={FileText} size={18} />
          <Flexbox flex={1} gap={4}>
            <span style={{ fontWeight: 600 }}>{displayName}</span>
            <Skeleton paragraph={false} title={{ width: 120 }} active />
          </Flexbox>
        </Flexbox>
      </Block>
    )
  }

  if (status === 'running') {
    return (
      <Block variant="filled" shadow>
        <Flexbox gap={8} horizontal align="center">
          <Icon icon={FileText} size={18} />
          <Flexbox flex={1} gap={4}>
            <span style={{ fontWeight: 600 }}>{displayName}</span>
            {argsSummary && (
              <span style={{ fontSize: 12, color: 'var(--color-text-description)' }}>
                {argsSummary}
              </span>
            )}
            <Skeleton paragraph={false} title={{ width: 80 }} active />
          </Flexbox>
        </Flexbox>
      </Block>
    )
  }

  return (
    <Block variant="filled" shadow>
      <Collapse
        variant="filled"
        items={[
          {
            label: displayName,
            icon: FileText,
            desc: [argsSummary, tc.isError && '失败'].filter(Boolean).join(' · ') || undefined,
            children: (
              <Flexbox gap={12} style={{ marginTop: 8 }}>
                {tc.arguments && (
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--color-text-description)',
                        marginBottom: 4
                      }}
                    >
                      参数
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: 8,
                        fontSize: 12,
                        background: 'var(--color-fill-quaternary)',
                        borderRadius: 6,
                        overflow: 'auto'
                      }}
                    >
                      {tc.arguments || '{}'}
                    </pre>
                  </div>
                )}
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--color-text-description)',
                      marginBottom: 4
                    }}
                  >
                    结果
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 8,
                      fontSize: 12,
                      background: 'var(--color-fill-quaternary)',
                      borderRadius: 6,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word'
                    }}
                  >
                    {tc.result}
                  </pre>
                </div>
                {meta?.docUrl && (
                  <a
                    href={meta.docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12 }}
                  >
                    查看文档
                  </a>
                )}
              </Flexbox>
            )
          }
        ]}
      />
    </Block>
  )
}

function TavilyToolCard({ tc }: { tc: ToolCallRecord }) {
  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name)
  const meta = getToolMetadata(tc.name)
  const query = parseQuery(tc.arguments)

  if (status === 'preparing') {
    return (
      <Block variant="filled" shadow>
        <Flexbox gap={8} horizontal align="center">
          <Icon icon={Search} size={18} />
          <Flexbox flex={1} gap={4}>
            <span style={{ fontWeight: 600 }}>{displayName}</span>
            <Skeleton paragraph={false} title={{ width: 120 }} active />
          </Flexbox>
        </Flexbox>
      </Block>
    )
  }

  if (status === 'running') {
    return (
      <Block variant="filled" shadow>
        <Flexbox gap={8} horizontal align="center">
          <Icon icon={Search} size={18} />
          <Flexbox flex={1} gap={4}>
            <span style={{ fontWeight: 600 }}>{displayName}</span>
            {query && (
              <span style={{ fontSize: 12, color: 'var(--color-text-description)' }}>{query}</span>
            )}
            <Skeleton paragraph={false} title={{ width: 80 }} active />
          </Flexbox>
        </Flexbox>
      </Block>
    )
  }

  const resultCount = tc.result ? (tc.result.match(/\n\n---\n\n/g)?.length ?? 0) + 1 : 0

  return (
    <Block variant="filled" shadow>
      <Collapse
        variant="filled"
        items={[
          {
            label: displayName,
            icon: Search,
            desc:
              [
                query && `搜索: ${query}`,
                resultCount > 0 && `${resultCount} 条结果`,
                tc.isError && '失败'
              ]
                .filter(Boolean)
                .join(' · ') || undefined,
            children: (
              <Flexbox gap={12} style={{ marginTop: 8 }}>
                {query && <div style={{ fontSize: 12 }}>搜索词: {query}</div>}
                <pre
                  style={{
                    margin: 0,
                    padding: 8,
                    fontSize: 12,
                    background: 'var(--color-fill-quaternary)',
                    borderRadius: 6,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                  }}
                >
                  {tc.result}
                </pre>
                {meta?.docUrl && (
                  <a
                    href={meta.docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12 }}
                  >
                    查看 Tavily 文档
                  </a>
                )}
              </Flexbox>
            )
          }
        ]}
      />
    </Block>
  )
}

function DefaultToolCard({ tc }: { tc: ToolCallRecord }) {
  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name)

  if (status === 'preparing') {
    return (
      <Block variant="filled" shadow>
        <Flexbox gap={8} horizontal align="center">
          <Icon icon={Wrench} size={18} />
          <Flexbox flex={1} gap={4}>
            <span style={{ fontWeight: 600 }}>{displayName}</span>
            <Skeleton paragraph={false} title={{ width: 100 }} active />
          </Flexbox>
        </Flexbox>
      </Block>
    )
  }

  if (status === 'running') {
    return (
      <Block variant="filled" shadow>
        <Flexbox gap={8} horizontal align="center">
          <Icon icon={Wrench} size={18} />
          <Flexbox flex={1} gap={4}>
            <span style={{ fontWeight: 600 }}>{displayName}</span>
            <Skeleton paragraph={false} title={{ width: 80 }} active />
          </Flexbox>
        </Flexbox>
      </Block>
    )
  }

  return (
    <Block variant="filled" shadow>
      <Collapse
        variant="filled"
        items={[
          {
            label: displayName,
            icon: Wrench,
            desc: tc.isError ? '失败' : undefined,
            children: (
              <Flexbox gap={12} style={{ marginTop: 8 }}>
                <pre
                  style={{
                    margin: 0,
                    padding: 8,
                    fontSize: 12,
                    background: 'var(--color-fill-quaternary)',
                    borderRadius: 6,
                    overflow: 'auto'
                  }}
                >
                  {tc.arguments || '{}'}
                </pre>
                <pre
                  style={{
                    margin: 0,
                    padding: 8,
                    fontSize: 12,
                    background: 'var(--color-fill-quaternary)',
                    borderRadius: 6,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                  }}
                >
                  {tc.result}
                </pre>
              </Flexbox>
            )
          }
        ]}
      />
    </Block>
  )
}

export function ToolCallCard({ tc }: ToolCallCardProps) {
  const customRender = getToolRender(tc.name)
  if (customRender) {
    return <>{customRender({ tc })}</>
  }
  if (isTavilyTool(tc.name)) return <TavilyToolCard tc={tc} />
  if (isPrizmTool(tc.name)) return <PrizmToolCard tc={tc} />
  return <DefaultToolCard tc={tc} />
}
