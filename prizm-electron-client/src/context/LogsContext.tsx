/**
 * 日志共享上下文
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode
} from 'react'

export type LogType = 'info' | 'success' | 'error' | 'warning'

export interface LogEntry {
  message: string
  type: LogType
  timestamp: string
  source?: 'main' | 'renderer'
}

interface LogsContextValue {
  logs: LogEntry[]
  addLog: (message: string, type?: LogType) => void
  clearLogs: () => void
}

const LogsContext = createContext<LogsContextValue | null>(null)

function mapLevelToLogType(level: string): LogType {
  if (level === 'error') return 'error'
  if (level === 'warn') return 'warning'
  return 'info'
}

export function LogsProvider({ children }: { children: ReactNode }) {
  const [logs, setLogs] = useState<LogEntry[]>([])

  const addLog = useCallback((message: string, type: LogType = 'info') => {
    const timestamp = new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    const entry: LogEntry = { message, type, timestamp, source: 'renderer' }
    setLogs((prev) => {
      const next = [entry, ...prev]
      if (next.length > 50) next.pop()
      return next
    })
    if (typeof window !== 'undefined' && window.prizm?.logFromRenderer) {
      window.prizm.logFromRenderer(message, type).catch(() => {})
    }
  }, [])

  const clearLogs = useCallback(() => {
    setLogs([])
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.prizm?.onLogFromMain) return
    const unsubscribe = window.prizm.onLogFromMain((entry) => {
      const type = mapLevelToLogType(entry.level)
      const logEntry: LogEntry = {
        message: entry.message,
        type,
        timestamp: entry.timestamp,
        source: 'main'
      }
      setLogs((prev) => {
        const next = [logEntry, ...prev]
        if (next.length > 50) next.pop()
        return next
      })
    })
    return unsubscribe
  }, [])

  const contextValue = useMemo(() => ({ logs, addLog, clearLogs }), [logs, addLog, clearLogs])

  return <LogsContext.Provider value={contextValue}>{children}</LogsContext.Provider>
}

export function useLogsContext(): LogsContextValue {
  const ctx = useContext(LogsContext)
  if (!ctx) throw new Error('useLogsContext must be used within LogsProvider')
  return ctx
}
