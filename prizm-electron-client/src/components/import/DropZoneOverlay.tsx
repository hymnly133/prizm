/**
 * DropZoneOverlay - 全局拖拽覆盖层
 * 监听 window 级 drag 事件，外部文件/文本拖入时显示半透明覆盖层
 * drop 后通过 ImportService 开始导入流程
 * 过滤应用内部拖拽（如 FileTreeNode 的 @file: 引用）
 */
import { createClientLogger } from '@prizm/client-core'
import { memo, useState, useCallback, useEffect, useRef } from 'react'

const log = createClientLogger('DropZone')
import { AnimatePresence, motion } from 'motion/react'
import { Download } from 'lucide-react'
import { useImportContext } from '../../context/ImportContext'
import { textToImportItem } from '../../types/import'

const DropZoneOverlay = memo(() => {
  const { startImport, startImportFromFileResults } = useImportContext()
  const [isDragging, setIsDragging] = useState(false)
  const dragCountRef = useRef(0)

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    // 过滤应用内部拖拽（FileTreeNode 使用 text/plain + @file: 前缀）
    const types = e.dataTransfer?.types ?? []
    const hasFiles = types.includes('Files')
    const hasText = types.includes('text/plain')
    // 内部拖拽只有 text/plain 且没有 Files；外部文本拖拽也只有 text/plain
    // 区分：dragenter 时无法读取 data（安全限制），先都显示覆盖层
    // 在 drop 时再过滤 @file: 前缀
    if (!hasFiles && !hasText) return

    dragCountRef.current++
    if (dragCountRef.current === 1) {
      setIsDragging(true)
    }
  }, [])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    dragCountRef.current--
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCountRef.current = 0
      setIsDragging(false)

      if (!e.dataTransfer) return

      // 检查是否是文件拖拽
      const files = e.dataTransfer.files
      if (files.length > 0) {
        // Electron 40 中 File.path 已弃用，优先用 webUtils.getPathForFile
        const paths: string[] = []
        for (let i = 0; i < files.length; i++) {
          const file = files[i] as File & { path?: string }
          // 先试 getPathForFile，再试已弃用的 file.path
          const p = window.prizm.getPathForFile(file) || file.path || ''
          if (p) paths.push(p)
        }
        if (paths.length > 0) {
          try {
            const results = await window.prizm.readFiles(paths)
            if (results.length > 0) {
              startImportFromFileResults(results)
            }
          } catch (err) {
            log.error('readFiles failed:', err)
          }
          return
        }
      }

      // 检查是否是纯文本拖拽（或文件拖拽时 path 均不可用，text/plain 可能含路径）
      const text = e.dataTransfer.getData('text/plain')
      if (text) {
        // 过滤应用内部拖拽
        if (text.startsWith('@file:')) return
        const trimmed = text.trim()
        if (!trimmed) return
        // 若 text 形如 Windows 路径（D:\path\file.md），当作文件路径读取
        if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
          try {
            const results = await window.prizm.readFiles([trimmed])
            if (results.length > 0) {
              startImportFromFileResults(results)
              return
            }
          } catch {
            // 读失败则当作文本导入
          }
        }
        startImport([textToImportItem(trimmed)])
      }
    },
    [startImport, startImportFromFileResults]
  )

  useEffect(() => {
    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
    }
  }, [handleDragEnter, handleDragOver, handleDragLeave, handleDrop])

  return (
    <AnimatePresence>
      {isDragging && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0, 0, 0, 0.45)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            pointerEvents: 'none',
            backdropFilter: 'blur(4px)'
          }}
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.05, duration: 0.25, ease: [0.33, 1, 0.68, 1] }}
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              background: 'rgba(255, 255, 255, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Download size={36} color="white" />
          </motion.div>
          <motion.div
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.25 }}
            style={{
              color: 'white',
              fontSize: 18,
              fontWeight: 600,
              textShadow: '0 1px 4px rgba(0,0,0,0.3)'
            }}
          >
            松开以导入到 Prizm
          </motion.div>
          <motion.div
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 0.7 }}
            transition={{ delay: 0.15, duration: 0.25 }}
            style={{
              color: 'white',
              fontSize: 13
            }}
          >
            支持文本和文本文件
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})

DropZoneOverlay.displayName = 'DropZoneOverlay'

export default DropZoneOverlay
