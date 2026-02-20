/**
 * useEditorMode — 编辑器模式状态 + localStorage 持久化
 *
 * 被 DocumentEditorView 和 DocumentPane 共享。
 */
import { useState, useCallback } from 'react'
import type { EditorMode } from '../components/editor'

function readStoredMode(storageKey: string): EditorMode {
  try {
    const stored = localStorage.getItem(storageKey) as EditorMode | null
    if (stored === 'source' || stored === 'preview' || stored === 'split' || stored === 'live')
      return stored
  } catch {
    /* ignore */
  }
  return 'live'
}

export function useEditorMode(storageKey: string) {
  const [editorMode, setEditorMode] = useState<EditorMode>(() => readStoredMode(storageKey))

  const handleModeChange = useCallback(
    (mode: EditorMode) => {
      setEditorMode(mode)
      try {
        localStorage.setItem(storageKey, mode)
      } catch {
        /* ignore */
      }
    },
    [storageKey]
  )

  return { editorMode, handleModeChange }
}
