/**
 * DocumentNavigationContext - 文档导航上下文
 * 提供跨页面文档导航能力：从 HomePage/WorkPage 点击文档跳转到 DocumentPage
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface DocumentNavigationContextType {
  /** 待加载的文档 ID */
  pendingDocId: string | null
  /** 导航到知识库页面并打开指定文档 */
  navigateToDocs: (docId: string) => void
  /** 消费 pendingDocId（DocumentPage 调用后清空） */
  consumePendingDoc: () => string | null
}

const DocumentNavigationContext = createContext<DocumentNavigationContextType>({
  pendingDocId: null,
  navigateToDocs: () => {},
  consumePendingDoc: () => null
})

interface DocumentNavigationProviderProps {
  children: ReactNode
  onNavigateToDocs: () => void
}

export function DocumentNavigationProvider({
  children,
  onNavigateToDocs
}: DocumentNavigationProviderProps) {
  const [pendingDocId, setPendingDocId] = useState<string | null>(null)

  const navigateToDocs = useCallback(
    (docId: string) => {
      setPendingDocId(docId)
      onNavigateToDocs()
    },
    [onNavigateToDocs]
  )

  const consumePendingDoc = useCallback(() => {
    const id = pendingDocId
    setPendingDocId(null)
    return id
  }, [pendingDocId])

  return (
    <DocumentNavigationContext.Provider value={{ pendingDocId, navigateToDocs, consumePendingDoc }}>
      {children}
    </DocumentNavigationContext.Provider>
  )
}

export function useDocumentNavigation(): DocumentNavigationContextType {
  return useContext(DocumentNavigationContext)
}
