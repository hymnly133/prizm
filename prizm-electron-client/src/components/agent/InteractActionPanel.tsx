/**
 * InteractActionPanel — 固定在聊天底部的交互授权面板
 *
 * 根据 interact kind 渲染不同的审批内容：
 * - file_access: 文件路径列表
 * - terminal_command: 命令预览
 * - destructive_operation: 资源变更警告
 * - custom: 通用标题 + 描述
 */
import { useState, useCallback, memo } from 'react'
import { Flexbox } from '@lobehub/ui'
import { ShieldCheck, AlertCircle, FolderOpen, Terminal, AlertTriangle, HelpCircle } from 'lucide-react'
import { getToolDisplayName } from '@prizm/client-core'
import type { InteractRequestPayload } from '@prizm/client-core'

export interface InteractActionPanelProps {
  pendingInteract: InteractRequestPayload
  onRespond: (requestId: string, approved: boolean, paths?: string[]) => Promise<void>
}

function InteractBody({ interact }: { interact: InteractRequestPayload }) {
  const kind = interact.kind ?? 'file_access'

  if (kind === 'terminal_command') {
    return (
      <>
        <div className="interact-panel__desc">工具需要执行以下命令，请确认是否允许：</div>
        <div className="interact-panel__command">
          <Terminal size={12} />
          <code>{interact.command}</code>
          {interact.cwd && (
            <span className="interact-panel__cwd">({interact.cwd})</span>
          )}
        </div>
      </>
    )
  }

  if (kind === 'destructive_operation') {
    return (
      <>
        <div className="interact-panel__desc">工具需要执行以下操作，请确认是否允许：</div>
        <div className="interact-panel__destructive">
          <AlertTriangle size={12} />
          <span>{interact.description}</span>
        </div>
      </>
    )
  }

  if (kind === 'custom') {
    return (
      <>
        <div className="interact-panel__desc">
          {interact.description || '工具需要您的确认才能继续：'}
        </div>
      </>
    )
  }

  const paths = interact.paths ?? []
  return (
    <>
      <div className="interact-panel__desc">工具需要访问以下路径，请确认是否允许：</div>
      {paths.length > 0 && (
        <div className="interact-panel__paths">
          {paths.map((p, i) => (
            <div key={i} className="interact-panel__path-item">
              <FolderOpen size={12} />
              <code>{p}</code>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function getKindIcon(kind?: string) {
  switch (kind) {
    case 'terminal_command': return Terminal
    case 'destructive_operation': return AlertTriangle
    case 'custom': return HelpCircle
    default: return ShieldCheck
  }
}

function getApproveLabel(kind?: string): string {
  switch (kind) {
    case 'terminal_command': return '允许执行'
    case 'destructive_operation': return '确认操作'
    case 'custom': return '批准'
    default: return '允许访问'
  }
}

export const InteractActionPanel = memo(function InteractActionPanel({
  pendingInteract,
  onRespond
}: InteractActionPanelProps) {
  const [responding, setResponding] = useState(false)
  const kind = pendingInteract.kind ?? 'file_access'

  const handleApprove = useCallback(async () => {
    if (responding) return
    setResponding(true)
    try {
      await onRespond(pendingInteract.requestId, true, pendingInteract.paths)
    } finally {
      setResponding(false)
    }
  }, [pendingInteract, onRespond, responding])

  const handleDeny = useCallback(async () => {
    if (responding) return
    setResponding(true)
    try {
      await onRespond(pendingInteract.requestId, false)
    } finally {
      setResponding(false)
    }
  }, [pendingInteract, onRespond, responding])

  const displayName = getToolDisplayName(pendingInteract.toolName)
  const KindIcon = getKindIcon(kind)
  const panelModifier = kind === 'destructive_operation' ? ' interact-panel--destructive'
    : kind === 'terminal_command' ? ' interact-panel--terminal'
    : ''

  return (
    <div className={`interact-panel${panelModifier}`}>
      <div className="interact-panel__header">
        <KindIcon size={16} className="interact-panel__icon" />
        <span className="interact-panel__title">
          <strong>{displayName}</strong> 需要您的授权
        </span>
      </div>

      <InteractBody interact={pendingInteract} />

      <Flexbox horizontal gap={10} style={{ marginTop: 10 }}>
        <button
          className={`interact-panel__btn interact-panel__btn--approve${kind === 'destructive_operation' ? ' interact-panel__btn--warn' : ''}`}
          onClick={handleApprove}
          disabled={responding}
        >
          <KindIcon size={14} />
          <span>{responding ? '处理中…' : getApproveLabel(kind)}</span>
        </button>
        <button
          className="interact-panel__btn interact-panel__btn--deny"
          onClick={handleDeny}
          disabled={responding}
        >
          <AlertCircle size={14} />
          <span>拒绝</span>
        </button>
      </Flexbox>
    </div>
  )
})
