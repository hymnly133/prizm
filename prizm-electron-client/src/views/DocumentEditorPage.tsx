/**
 * DocumentEditorPage — 独立文档编辑页
 * 作为顶级页面挂载在 App.tsx 的 keep-alive 系统中
 * 消费 NavigationContext 的 pendingDocId 确定要打开的文档
 */
import { memo, useEffect, useState } from 'react'
import DocumentEditorView from '../components/DocumentEditorView'
import { useScope } from '../hooks/useScope'
import { useDocumentNavigation } from '../context/NavigationContext'

export interface DocumentEditorPageProps {
  /** 同步 dirty 状态到外部（供 App.tsx 离开保护使用） */
  dirtyRef?: React.MutableRefObject<boolean>
  /** 返回工作页 */
  onBack: () => void
}

function DocumentEditorPage({ dirtyRef, onBack }: DocumentEditorPageProps) {
  const { currentScope } = useScope()
  const { pendingDocId, consumePendingDoc } = useDocumentNavigation()

  /** 当前要打开的文档 ID — 每次 pendingDocId 变化时更新 */
  const [targetDocId, setTargetDocId] = useState<string | null>(null)

  useEffect(() => {
    if (pendingDocId) {
      const id = consumePendingDoc()
      if (id) setTargetDocId(id)
    }
  }, [pendingDocId, consumePendingDoc])

  return (
    <DocumentEditorView
      scope={currentScope}
      initialDocId={targetDocId}
      onBack={onBack}
      dirtyRef={dirtyRef}
    />
  )
}

export default memo(DocumentEditorPage)
