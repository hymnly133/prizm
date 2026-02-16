/**
 * useImportActions - 导入执行逻辑（与 UI 解耦的纯操作）
 * 提供直接导入、AI 整理、批量操作等方法
 *
 * AI 整理现在使用 @(file:path) 引用而非直接嵌入内容，
 * 避免大文件内容直接进入 LLM 上下文。
 */
import { useCallback } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { useChatWithFile } from '../context/ChatWithFileContext'
import type { ChatWithPayload } from '../context/ChatWithFileContext'
import { useScope } from './useScope'
import type { ImportItem } from '../types/import'
import type { FilePathRef } from '@prizm/shared'

/** 构建 AI 整理 prompt（文本型，无法通过路径引用） */
function buildTextAIPrompt(item: ImportItem): string {
  return `请帮我整理以下内容，整理为结构清晰的文档并保存到工作区：

${item.content ?? '(空内容)'}`
}

/** 构建多文本批量 AI 整理 prompt */
function buildBatchTextAIPrompt(items: ImportItem[]): string {
  const sections = items
    .map((item, idx) => `## 文本 ${idx + 1}\n${item.content ?? '(空内容)'}`)
    .join('\n\n')
  return `请帮我分别整理以下 ${items.length} 段内容，每段整理为一篇独立文档并保存：

${sections}`
}

/** 从 ImportItem 构建 FilePathRef */
function toFilePathRef(item: ImportItem): FilePathRef | null {
  if (item.type !== 'file' || !item.path) return null
  return { path: item.path, name: item.name }
}

export function useImportActions() {
  const { manager } = usePrizmContext()
  const { chatWith } = useChatWithFile()
  const { currentScope } = useScope()

  /** 直接导入单个 item 为文档 */
  const importDirect = useCallback(
    async (item: ImportItem): Promise<void> => {
      const http = manager?.getHttpClient()
      if (!http) throw new Error('未连接服务器')
      if (!item.content && !item.unsupported) {
        await http.createDocument({ title: item.name, content: '' }, currentScope)
        return
      }
      if (item.unsupported || item.content === null) {
        throw new Error('不支持导入该类型的文件')
      }
      const title =
        item.type === 'file'
          ? item.name.replace(/\.[^.]+$/, '')
          : item.content.slice(0, 50) || '导入文本'
      await http.createDocument({ title, content: item.content }, currentScope)
    },
    [manager, currentScope]
  )

  /** AI 整理单个 item（强制新建对话） */
  const importWithAI = useCallback(
    (item: ImportItem): void => {
      if (item.unsupported || item.content === null) return
      const fileRef = toFilePathRef(item)
      // [ImportAI-Chip] 调试：单项 AI 整理
      console.log('[ImportAI-Chip] importWithAI 调用', {
        itemType: item.type,
        itemPath: item.path,
        itemName: item.name,
        toFilePathRefResult: fileRef,
        hasPath: !!item.path
      })
      if (fileRef) {
        const payload: ChatWithPayload = {
          fileRefs: [fileRef],
          text: '请帮我整理这个文件的内容，整理为结构清晰的文档并保存到工作区。',
          forceNew: true
        }
        console.log('[ImportAI-Chip] 发送 payload (fileRefs)', payload)
        chatWith(payload)
      } else {
        console.log('[ImportAI-Chip] 发送 payload (纯文本，无 fileRefs)', {
          text: buildTextAIPrompt(item).slice(0, 80) + '...'
        })
        chatWith({ text: buildTextAIPrompt(item), forceNew: true })
      }
    },
    [chatWith]
  )

  /** 批量直接导入 */
  const importAllDirect = useCallback(
    async (
      items: ImportItem[],
      onItemDone: (id: string) => void,
      onItemError: (id: string, error: string) => void
    ): Promise<void> => {
      const http = manager?.getHttpClient()
      if (!http) throw new Error('未连接服务器')
      for (const item of items) {
        if (item.unsupported || item.content === null) continue
        if (item.status === 'done' || item.status === 'ai-sent') continue
        try {
          const title =
            item.type === 'file'
              ? item.name.replace(/\.[^.]+$/, '')
              : item.content.slice(0, 50) || '导入文本'
          await http.createDocument({ title, content: item.content }, currentScope)
          onItemDone(item.id)
        } catch (e) {
          onItemError(item.id, String(e))
        }
      }
    },
    [manager, currentScope]
  )

  /** 批量 AI 整理（合并到一个新对话） */
  const importAllWithAI = useCallback(
    (items: ImportItem[]): void => {
      const validItems = items.filter((i) => i.content && !i.unsupported)
      if (validItems.length === 0) return

      const fileItems = validItems.filter((i) => i.type === 'file' && i.path)
      const textItems = validItems.filter((i) => i.type !== 'file' || !i.path)

      const fileRefs: FilePathRef[] = fileItems
        .map(toFilePathRef)
        .filter((r): r is FilePathRef => r !== null)

      // [ImportAI-Chip] 调试：批量 AI 整理
      console.log('[ImportAI-Chip] importAllWithAI 调用', {
        validItemsCount: validItems.length,
        fileItemsCount: fileItems.length,
        textItemsCount: textItems.length,
        fileRefsCount: fileRefs.length,
        fileRefs,
        fileItemsPaths: fileItems.map((i) => ({ type: i.type, path: i.path, name: i.name }))
      })

      const payload: ChatWithPayload = { forceNew: true }

      if (fileRefs.length > 0) {
        payload.fileRefs = fileRefs
      }

      const promptParts: string[] = []
      if (fileRefs.length > 0 && textItems.length === 0) {
        promptParts.push(
          `请帮我分别整理这 ${fileRefs.length} 个文件的内容，每个整理为一篇独立文档并保存到工作区。`
        )
      } else if (fileRefs.length === 0 && textItems.length > 0) {
        promptParts.push(buildBatchTextAIPrompt(textItems))
      } else {
        if (textItems.length > 0) {
          promptParts.push(buildBatchTextAIPrompt(textItems))
        }
        if (fileRefs.length > 0) {
          promptParts.push(
            `同时请整理以上引用的 ${fileRefs.length} 个文件，每个整理为一篇独立文档并保存。`
          )
        }
      }

      payload.text = promptParts.join('\n\n')
      console.log('[ImportAI-Chip] 批量发送 payload', {
        fileRefsCount: payload.fileRefs?.length ?? 0,
        textPreview: payload.text?.slice(0, 60) + '...'
      })
      chatWith(payload)
    },
    [chatWith]
  )

  return {
    importDirect,
    importWithAI,
    importAllDirect,
    importAllWithAI
  }
}
