import { useEffect } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { useScope } from '../hooks/useScope'
import { useWorkNavigation } from '../context/WorkNavigationContext'
import { useChatWithFile } from '../context/ChatWithFileContext'
import { useLogsContext } from '../context/LogsContext'

export function QuickActionHandler({
  setActivePage
}: {
  setActivePage: (page: 'work' | 'agent' | 'settings' | 'test' | 'user') => void
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
        case 'create-note': {
          if (!http) {
            addLog('未连接服务器', 'error')
            return
          }
          try {
            const note = await http.createNote({ content: '' }, currentScope)
            openFileAtWork('note', note.id)
            setActivePage('work')
            addLog('已创建便签', 'success')
          } catch (e) {
            addLog(`创建便签失败: ${String(e)}`, 'error')
          }
          break
        }
        case 'create-note-with-text': {
          if (!http) {
            addLog('未连接服务器', 'error')
            return
          }
          try {
            const note = await http.createNote({ content: selectedText }, currentScope)
            openFileAtWork('note', note.id)
            setActivePage('work')
            addLog('已添加到便签', 'success')
          } catch (e) {
            addLog(`创建便签失败: ${String(e)}`, 'error')
          }
          break
        }
        case 'chat-with-text': {
          chatWith({ text: selectedText })
          break
        }
        case 'ai-organize-to-note': {
          chatWith({ text: '请将以下内容整理为便签并保存：\n\n' + selectedText })
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
