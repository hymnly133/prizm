/**
 * HomeStatusBar — 主页连接状态条
 * 显示 WebSocket 状态、ping 延迟、Embedding 模型状态
 */
import { useCallback, useEffect, useState } from 'react'
import { Activity, Brain, Wifi, WifiOff, Loader2, AlertCircle } from 'lucide-react'
import { buildServerUrl } from '@prizm/client-core'
import { usePrizmContext } from '../context/PrizmContext'

interface HealthInfo {
  status: string
  uptime?: number
  embedding?: {
    enabled: boolean
    model: string
    ready: boolean
  }
}

export function HomeStatusBar() {
  const { status, config } = usePrizmContext()
  const [pingMs, setPingMs] = useState<number | null>(null)
  const [healthInfo, setHealthInfo] = useState<HealthInfo | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)

  const fetchHealth = useCallback(async () => {
    if (!config) return
    setHealthError(null)
    const serverUrl = buildServerUrl(config.server.host, config.server.port)
    const start = performance.now()
    try {
      const res = await fetch(`${serverUrl}/health`)
      const elapsed = Math.round(performance.now() - start)
      setPingMs(elapsed)
      if (res.ok) {
        const data = await res.json()
        setHealthInfo(data)
      } else {
        setHealthError(`HTTP ${res.status}`)
      }
    } catch (e) {
      setHealthError(e instanceof Error ? e.message : String(e))
      setPingMs(null)
    }
  }, [config])

  useEffect(() => {
    void fetchHealth()
    const id = setInterval(() => void fetchHealth(), 30_000)
    return () => clearInterval(id)
  }, [fetchHealth])

  const wsConnected = status === 'connected'
  const embeddingReady = healthInfo?.embedding?.ready === true
  const embeddingEnabled = healthInfo?.embedding?.enabled === true

  return (
    <div className="home-status-bar">
      <div
        className={`home-status-bar__item${
          wsConnected ? ' home-status-bar__item--ok' : ' home-status-bar__item--warn'
        }`}
      >
        {wsConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
        <span>{wsConnected ? '已连接' : status === 'connecting' ? '连接中' : '未连接'}</span>
      </div>

      {pingMs != null && (
        <div className="home-status-bar__item home-status-bar__item--ok">
          <Activity size={13} />
          <span>{pingMs}ms</span>
        </div>
      )}

      {healthError && (
        <div className="home-status-bar__item home-status-bar__item--warn">
          <AlertCircle size={13} />
          <span>Health 错误</span>
        </div>
      )}

      {embeddingEnabled && (
        <div
          className={`home-status-bar__item${
            embeddingReady ? ' home-status-bar__item--ok' : ' home-status-bar__item--loading'
          }`}
        >
          {embeddingReady ? <Brain size={13} /> : <Loader2 size={13} className="spinning" />}
          <span>Embedding {embeddingReady ? '就绪' : '加载中'}</span>
        </div>
      )}
    </div>
  )
}
