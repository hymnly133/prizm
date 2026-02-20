import { useEffect } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { useScope } from '../hooks/useScope'
import { useWorkNavigation } from '../context/WorkNavigationContext'
import { useChatWithFile } from '../context/ChatWithFileContext'
import { useLogsContext } from '../context/LogsContext'

export function QuickActionHandler({
  setActivePage
}: {
  setActivePage: (page: 'home' | 'work' | 'docs' | 'agent' | 'settings' | 'test') => void
}) {
  const { manager } = usePrizmContext()
  const { currentScope } = useScope()
  const { openFileAtWork } = useWorkNavigation()
  const { chatWith } = useChatWithFile()
  const { addLog } = useLogsContext()

  useEffect(() => {
    const unsub = window.prizm.onExecuteQuickAction(async ({ action, selectedText }) => {
      const http = manager?.getHttpClient()
      switch (action) {
        case 'create-document': {
          if (!http) {
            addLog('未连接服务器', 'error')
            return
          }
          try {
            const doc = await http.createDocument(
              { title: '未命名文档', content: '' },
              currentScope
            )
            openFileAtWork('document', doc.id)
            addLog('已创建文档', 'success')
          } catch (e) {
            addLog(`创建文档失败: ${String(e)}`, 'error')
          }
          break
        }
        case 'create-document-with-text': {
          if (!http) {
            addLog('未连接服务器', 'error')
            return
          }
          try {
            const doc = await http.createDocument(
              { title: selectedText.slice(0, 50) || '未命名', content: selectedText },
              currentScope
            )
            openFileAtWork('document', doc.id)
            addLog('已添加到文档', 'success')
          } catch (e) {
            addLog(`创建文档失败: ${String(e)}`, 'error')
          }
          break
        }
        case 'chat-with-text': {
          chatWith({ text: selectedText })
          break
        }
        case 'ai-organize-to-document': {
          chatWith({ text: '请将以下内容整理为文档并保存：\n\n' + selectedText })
          break
        }
        default:
          break
      }
    })
    return unsub
  }, [manager, currentScope, openFileAtWork, chatWith, setActivePage, addLog])

  return null
}
