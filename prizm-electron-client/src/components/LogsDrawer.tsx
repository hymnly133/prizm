import { Drawer, Button } from 'antd'
import { useLogsContext } from '../context/LogsContext'

interface LogsDrawerProps {
  open: boolean
  onClose: () => void
}

export function LogsDrawer({ open, onClose }: LogsDrawerProps) {
  const { logs, clearLogs } = useLogsContext()

  function exportLogs() {
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.type}]${l.source ? ` [${l.source}]` : ''} ${l.message}`)
      .join('\n')
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `prizm-logs-${new Date().toISOString().slice(0, 10)}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="日志"
      placement="bottom"
      extra={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" onClick={clearLogs}>
            清空
          </Button>
          <Button size="small" onClick={exportLogs}>
            导出
          </Button>
        </div>
      }
      styles={{
        wrapper: { height: 320 },
        body: { padding: 0 }
      }}
    >
      <div
        className="logs"
        style={{ maxHeight: '100%', height: '100%', borderRadius: 0, border: 'none' }}
      >
        {logs.length === 0 ? (
          <div className="log-placeholder">等待连接...</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className={`log-item ${log.type}`}>
              <span className="log-time">[{log.timestamp}]</span>
              {log.source && <span className="log-source">[{log.source}]</span>}
              <span className="log-msg">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </Drawer>
  )
}
