/**
 * SelectionRefContext — 通用选区引用系统
 * 允许任意组件（FileViewer、Terminal 等）注册当前文本选区，
 * 由 Ctrl+L 快捷键统一消费并注入到 ChatInput 的 InputRef 列表。
 */
import { createContext, useCallback, useContext, useRef, useState } from 'react'

/** 选区信息 */
export interface SelectionInfo {
  /** 选区来源标识，如 'file-viewer' | 'terminal' */
  source: string
  /** 选中的文本内容 */
  text: string
  /** 文件路径（可选） */
  filePath?: string
  /** 起始行号 */
  startLine?: number
  /** 结束行号 */
  endLine?: number
  /** 语言标识（用于 markdown code fence） */
  language?: string
}

export interface SelectionRefContextValue {
  /** 当前选区信息，null 表示无选区 */
  currentSelection: SelectionInfo | null
  /** 由选区源组件调用，更新当前选区 */
  setSelection: (info: SelectionInfo | null) => void
}

const defaultValue: SelectionRefContextValue = {
  currentSelection: null,
  setSelection: () => {}
}

const SelectionRefContext = createContext<SelectionRefContextValue>(defaultValue)

export function SelectionRefProvider({ children }: { children: React.ReactNode }) {
  const [currentSelection, setCurrentSelection] = useState<SelectionInfo | null>(null)

  /** Ref 同步最新值，供外部在事件回调中同步读取 */
  const selectionRef = useRef(currentSelection)
  selectionRef.current = currentSelection

  const setSelection = useCallback((info: SelectionInfo | null) => {
    setCurrentSelection(info)
  }, [])

  return (
    <SelectionRefContext.Provider value={{ currentSelection, setSelection }}>
      {children}
    </SelectionRefContext.Provider>
  )
}

export function useSelectionRef(): SelectionRefContextValue {
  return useContext(SelectionRefContext)
}
