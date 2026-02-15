/**
 * 与文件相关的 Prizm 工具自定义卡片
 * 单击标题打开工作区预览，下拉保留显示工具详情
 * 通过 registerToolRender 注册，ToolCallCard 会优先使用此处注册的渲染
 */
import { Block, Collapse, Flexbox, Icon, Skeleton } from '@lobehub/ui'
import { FileText } from 'lucide-react'
import type { ToolCallRecord } from '@prizm/client-core'
import { getToolDisplayName, getToolMetadata, registerToolRender } from '@prizm/client-core'
import type { FileKind } from '../../hooks/useFileList'
import { useWorkNavigation } from '../../context/WorkNavigationContext'

function parseArgsSummary(argsStr: string): string {
  try {
    const obj = JSON.parse(argsStr || '{}') as Record<string, unknown>
    const parts: string[] = []
    if (obj.documentId) parts.push(`文档: ${String(obj.documentId).slice(0, 12)}…`)
    else if (obj.noteId) parts.push(`便签: ${String(obj.noteId).slice(0, 12)}…`)
    else if (obj.todoListId) parts.push(`待办列表: ${String(obj.todoListId).slice(0, 12)}…`)
    else if (obj.todoId) parts.push(`待办: ${String(obj.todoId).slice(0, 12)}…`)
    else if (obj.title) parts.push(`标题: ${String(obj.title).slice(0, 20)}…`)
    else if (obj.content) parts.push(`内容: ${String(obj.content).slice(0, 30)}…`)
    return parts.join(' ')
  } catch {
    return ''
  }
}

function parseFileRef(argsStr: string): { kind: FileKind; id: string } | null {
  try {
    const obj = JSON.parse(argsStr || '{}') as Record<string, unknown>
    if (obj.documentId && typeof obj.documentId === 'string')
      return { kind: 'document', id: obj.documentId }
    if (obj.noteId && typeof obj.noteId === 'string') return { kind: 'note', id: obj.noteId }
    if (obj.todoListId && typeof obj.todoListId === 'string')
      return { kind: 'todoList', id: obj.todoListId }
    return null
  } catch {
    return null
  }
}

function PrizmFileToolCard({ tc }: { tc: ToolCallRecord }) {
  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name)
  const meta = getToolMetadata(tc.name)
  const argsSummary = parseArgsSummary(tc.arguments)
  const fileRef = status === 'done' ? parseFileRef(tc.arguments) : null
  const { openFileAtWork } = useWorkNavigation()

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

  const desc = [argsSummary, tc.isError && '失败'].filter(Boolean).join(' · ') || undefined
  const label =
    fileRef != null ? (
      <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
        <span
          style={{ flex: 1, cursor: 'pointer' }}
          title="单击在工作区中打开"
          onClick={(e) => {
            e.stopPropagation()
            openFileAtWork(fileRef.kind, fileRef.id)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              openFileAtWork(fileRef.kind, fileRef.id)
            }
          }}
          role="button"
          tabIndex={0}
          className="tool-call-card__file-header"
        >
          {displayName}
          {desc ? ` · ${desc}` : ''}
        </span>
      </div>
    ) : (
      displayName
    )

  return (
    <Block variant="filled" shadow>
      <Collapse
        variant="filled"
        items={[
          {
            label,
            icon: FileText,
            desc: fileRef == null ? desc : undefined,
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

const FILE_RELATED_PRIZM_TOOLS = [
  'prizm_get_document',
  'prizm_get_document_content',
  'prizm_update_document',
  'prizm_delete_document',
  'prizm_read_note',
  'prizm_get_note',
  'prizm_update_note',
  'prizm_delete_note',
  'prizm_read_todo',
  'prizm_update_todo',
  'prizm_delete_todo',
  'prizm_update_todo_list'
] as const

function registerAll() {
  for (const name of FILE_RELATED_PRIZM_TOOLS) {
    registerToolRender(name, (props) => <PrizmFileToolCard tc={props.tc} />)
  }
}

registerAll()
