/**
 * ImportContext - 通用导入服务 Provider
 * 管理导入流程状态：收集导入项 -> 显示确认对话框 -> 执行导入
 * 与触发方式（拖拽 / 手动按钮）解耦
 */
import { createClientLogger } from '@prizm/client-core'
import { createContext, useContext, useCallback, useState, useMemo } from 'react'

const log = createClientLogger('Import')
import type { ImportItem, ReadFileResult } from '../types/import'
import { fileResultToImportItem, textToImportItem } from '../types/import'

export interface ImportState {
  /** 确认对话框是否打开 */
  open: boolean
  /** 待导入项列表 */
  items: ImportItem[]
}

export interface ImportContextValue {
  /** 开始导入流程：传入待导入项，弹出确认对话框 */
  startImport: (items: ImportItem[]) => void

  /** 从纯文本开始导入（快捷方法） */
  startImportFromText: (text: string) => void

  /** 从文件读取结果开始导入 */
  startImportFromFileResults: (results: ReadFileResult[]) => void

  /** 通过原生文件对话框选择文件并开始导入 */
  startImportFromFileDialog: () => Promise<void>

  /** 当前导入状态 */
  importState: ImportState

  /** 更新单项状态 */
  updateItemStatus: (id: string, status: ImportItem['status'], errorMessage?: string) => void

  /** 批量更新状态 */
  updateAllItemsStatus: (
    status: ImportItem['status'],
    filter?: (item: ImportItem) => boolean
  ) => void

  /** 关闭导入对话框 */
  closeImport: () => void
}

const defaultValue: ImportContextValue = {
  startImport: () => {},
  startImportFromText: () => {},
  startImportFromFileResults: () => {},
  startImportFromFileDialog: async () => {},
  importState: { open: false, items: [] },
  updateItemStatus: () => {},
  updateAllItemsStatus: () => {},
  closeImport: () => {}
}

const ImportContext = createContext<ImportContextValue>(defaultValue)

export function useImportContext(): ImportContextValue {
  return useContext(ImportContext)
}

export function ImportProvider({ children }: { children: React.ReactNode }) {
  const [importState, setImportState] = useState<ImportState>({
    open: false,
    items: []
  })

  const startImport = useCallback((items: ImportItem[]) => {
    if (items.length === 0) return
    setImportState({ open: true, items })
  }, [])

  const startImportFromText = useCallback(
    (text: string) => {
      if (!text.trim()) return
      startImport([textToImportItem(text)])
    },
    [startImport]
  )

  const startImportFromFileResults = useCallback(
    (results: ReadFileResult[]) => {
      if (results.length === 0) return
      const items = results.map(fileResultToImportItem)
      startImport(items)
    },
    [startImport]
  )

  const startImportFromFileDialog = useCallback(async () => {
    try {
      const results = await window.prizm.selectAndReadFiles()
      if (!results || results.length === 0) return
      startImportFromFileResults(results)
    } catch (e) {
      log.error('selectAndReadFiles failed:', e)
    }
  }, [startImportFromFileResults])

  const updateItemStatus = useCallback(
    (id: string, status: ImportItem['status'], errorMessage?: string) => {
      setImportState((prev) => ({
        ...prev,
        items: prev.items.map((item) => (item.id === id ? { ...item, status, errorMessage } : item))
      }))
    },
    []
  )

  const updateAllItemsStatus = useCallback(
    (status: ImportItem['status'], filter?: (item: ImportItem) => boolean) => {
      setImportState((prev) => ({
        ...prev,
        items: prev.items.map((item) => (!filter || filter(item) ? { ...item, status } : item))
      }))
    },
    []
  )

  const closeImport = useCallback(() => {
    setImportState({ open: false, items: [] })
  }, [])

  const contextValue = useMemo<ImportContextValue>(
    () => ({
      startImport,
      startImportFromText,
      startImportFromFileResults,
      startImportFromFileDialog,
      importState,
      updateItemStatus,
      updateAllItemsStatus,
      closeImport
    }),
    [
      startImport,
      startImportFromText,
      startImportFromFileResults,
      startImportFromFileDialog,
      importState,
      updateItemStatus,
      updateAllItemsStatus,
      closeImport
    ]
  )

  return <ImportContext.Provider value={contextValue}>{children}</ImportContext.Provider>
}
