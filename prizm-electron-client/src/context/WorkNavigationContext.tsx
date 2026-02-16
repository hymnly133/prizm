/**
 * 工作页导航 - 从 Agent 等页跳转到工作页并打开指定文件预览
 */
import { createContext, useContext, useCallback, useState } from 'react'
import type { FileKind } from '../hooks/useFileList'

export interface WorkNavigationContextValue {
  openFileAtWork: (kind: FileKind, id: string) => void
  pendingWorkFile: { kind: FileKind; id: string } | null
  consumePendingWorkFile: () => void
}

const defaultValue: WorkNavigationContextValue = {
  openFileAtWork: () => {},
  pendingWorkFile: null,
  consumePendingWorkFile: () => {}
}

export const WorkNavigationContext = createContext<WorkNavigationContextValue>(defaultValue)

export function useWorkNavigation(): WorkNavigationContextValue {
  return useContext(WorkNavigationContext)
}

export function WorkNavigationProvider({
  children,
  onNavigateToWork
}: {
  children: React.ReactNode
  onNavigateToWork: () => void
}) {
  const [pendingWorkFile, setPendingWorkFile] = useState<{
    kind: FileKind
    id: string
  } | null>(null)

  const openFileAtWork = useCallback(
    (kind: FileKind, id: string) => {
      setPendingWorkFile({ kind, id })
      onNavigateToWork()
    },
    [onNavigateToWork]
  )

  const consumePendingWorkFile = useCallback(() => {
    setPendingWorkFile(null)
  }, [])

  return (
    <WorkNavigationContext.Provider
      value={{ openFileAtWork, pendingWorkFile, consumePendingWorkFile }}
    >
      {children}
    </WorkNavigationContext.Provider>
  )
}
