/**
 * Prizm 全局上下文 - 连接状态、配置、manager
 */
import {
  createContext,
  useContext,
  useCallback,
  useState,
  useMemo,
  useEffect,
  type ReactNode
} from 'react'
import {
  PrizmClientManager,
  buildServerUrl,
  ONLINE_SCOPE,
  createClientLogger
} from '@prizm/client-core'
import type { PrizmConfig, NotificationPayload } from '@prizm/client-core'
import { toast } from '@lobehub/ui'
import { setLastSyncEvent, subscribeSyncEventStore } from '../events/syncEventStore'

const log = createClientLogger('PrizmContext')

export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'connecting'

function getManagerRef(): { current: PrizmClientManager | null } {
  if (typeof import.meta !== 'undefined' && import.meta.hot?.data?.managerRef) {
    return import.meta.hot.data.managerRef as {
      current: PrizmClientManager | null
    }
  }
  const ref = { current: null as PrizmClientManager | null }
  if (typeof import.meta !== 'undefined' && import.meta.hot) {
    import.meta.hot.data.managerRef = ref
  }
  return ref
}

const managerRef = getManagerRef()

/** 同步事件上下文 - 仅 lastSyncEvent，供 TestPage/useAgent 使用，与 PrizmContext 分离避免 WorkPage 重渲染 */
export interface SyncEventContextValue {
  lastSyncEvent: string | null
}

export interface PrizmContextValue {
  status: ConnectionStatus
  config: PrizmConfig | null
  manager: PrizmClientManager | null
  loadConfig: () => Promise<PrizmConfig | null>
  saveConfig: (cfg: PrizmConfig) => Promise<boolean>
  testConnection: (serverUrl: string) => Promise<boolean>
  registerClient: (
    serverUrl: string,
    clientName: string,
    scopes: string[]
  ) => Promise<string | null>
  initializePrizm: (
    cfg: PrizmConfig,
    opt: {
      onLog: (msg: string, type: 'info' | 'success' | 'error' | 'warning') => void
      onNotify: (payload: NotificationPayload) => void
    }
  ) => Promise<void>
  disconnect: () => void
  setConfig: (c: PrizmConfig | null) => void
}

const PrizmContext = createContext<PrizmContextValue | null>(null)
const SyncEventContext = createContext<SyncEventContextValue | null>(null)

export function PrizmProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [config, setConfigState] = useState<PrizmConfig | null>(null)
  const [, setTriggerUpdate] = useState({})

  const manager = managerRef.current

  const loadConfig = useCallback(async (): Promise<PrizmConfig | null> => {
    try {
      const c = await window.prizm.loadConfig()
      setConfigState(c)
      return c
    } catch (err) {
      log.error('Failed to load config:', err)
      return null
    }
  }, [])

  const saveConfig = useCallback(async (cfg: PrizmConfig): Promise<boolean> => {
    try {
      return await window.prizm.saveConfig(cfg)
    } catch (err) {
      log.error('Failed to save config:', err)
      return false
    }
  }, [])

  const testConnection = useCallback(async (serverUrl: string): Promise<boolean> => {
    try {
      return await window.prizm.testConnection(serverUrl)
    } catch (err) {
      log.warn('Connection test failed:', err)
      return false
    }
  }, [])

  const registerClient = useCallback(
    async (serverUrl: string, clientName: string, scopes: string[]): Promise<string | null> => {
      try {
        setStatus('connecting')
        const apiKey = await window.prizm.registerClient(serverUrl, clientName, scopes)
        if (apiKey) return apiKey
        throw new Error('注册失败')
      } catch (err) {
        log.error('Client registration failed:', err)
        setStatus('error')
        return null
      }
    },
    []
  )

  const initializePrizm = useCallback(
    async (
      cfg: PrizmConfig,
      opt: {
        onLog: (msg: string, type: 'info' | 'success' | 'error' | 'warning') => void
        onNotify: (payload: NotificationPayload) => void
      }
    ): Promise<void> => {
      try {
        log.info('Initializing Prizm, host:', cfg.server.host, 'port:', cfg.server.port)
        if (managerRef.current) {
          log.info('Disconnecting existing manager before re-init')
          managerRef.current.disconnect()
        }

        const m = new PrizmClientManager({
          config: cfg,
          subscribeEvents: 'all',
          notifyEvents: cfg.notify_events ?? [
            'notification',
            'todo_list:created',
            'todo_list:updated',
            'todo_list:deleted'
          ],
          onNotify: (payload: NotificationPayload) => {
            opt.onNotify(payload)
            const isUserInitiated =
              payload.sourceClientId != null && payload.sourceClientId === m.getClientId()
            if (isUserInitiated) {
              const msg = payload.body
                ? `${payload.title ?? '通知'}: ${payload.body}`
                : payload.title ?? '通知'
              toast.success(msg)
            } else if (cfg.tray?.show_notification === 'true') {
              const raw = (payload as { rawEvent?: { eventType: string; payload: unknown } })
                .rawEvent
              void window.prizm.showNotification(
                raw
                  ? { eventType: raw.eventType, payload: raw.payload, updateId: payload.updateId }
                  : {
                      eventType: 'notification',
                      payload: { title: payload.title, body: payload.body },
                      updateId: payload.updateId,
                      title: payload.title ?? '通知',
                      body: payload.body
                    }
              )
            }
          },
          onDataSync: (eventType: string, payload?: unknown) => {
            setLastSyncEvent(
              eventType as import('@prizm/client-core').EventType,
              payload as import('../events/syncEventEmitter').SyncEventPayload
            )
          },
          onConnected: (msg: { clientId: string }) => {
            setStatus('connected')
            opt.onLog(`WebSocket 已连接 - Client ID: ${msg.clientId}`, 'success')
            void window.prizm.startClipboardSync({
              serverUrl: buildServerUrl(cfg.server.host, cfg.server.port),
              apiKey: cfg.api_key,
              scope: ONLINE_SCOPE
            })
          },
          onDisconnected: () => {
            setStatus('disconnected')
            opt.onLog('WebSocket 已断开连接', 'warning')
            void window.prizm.stopClipboardSync()
          },
          onError: (error: Error) => {
            setStatus('error')
            opt.onLog(`错误: ${error.message}`, 'error')
          }
        })

        managerRef.current = m
        setTriggerUpdate({})
        await m.connect()
        log.info('Prizm initialized and connected')
      } catch (error) {
        setStatus('error')
        opt.onLog(`初始化失败: ${String(error)}`, 'error')
        throw error
      }
    },
    []
  )

  const disconnect = useCallback(() => {
    log.info('Disconnecting Prizm')
    managerRef.current?.disconnect()
    managerRef.current = null
    setTriggerUpdate({})
  }, [])

  const setConfig = useCallback((c: PrizmConfig | null) => {
    setConfigState(c)
  }, [])

  const prizmValue = useMemo<PrizmContextValue>(
    () => ({
      status,
      config,
      manager,
      loadConfig,
      saveConfig,
      testConnection,
      registerClient,
      initializePrizm,
      disconnect,
      setConfig
    }),
    [
      status,
      config,
      manager,
      loadConfig,
      saveConfig,
      testConnection,
      registerClient,
      initializePrizm,
      disconnect,
      setConfig
    ]
  )

  return <PrizmContext.Provider value={prizmValue}>{children}</PrizmContext.Provider>
}

/** 仅包裹 Agent/Test 页，lastSyncEvent 变更时只重渲染这些页，不影响 WorkPage */
export function SyncEventProvider({ children }: { children: ReactNode }) {
  const [lastSyncEvent, setState] = useState<string | null>(null)
  useEffect(() => subscribeSyncEventStore(setState), [])
  const value = useMemo(() => ({ lastSyncEvent }), [lastSyncEvent])
  return <SyncEventContext.Provider value={value}>{children}</SyncEventContext.Provider>
}

export function useSyncEventContext(): SyncEventContextValue {
  const ctx = useContext(SyncEventContext)
  if (!ctx) throw new Error('useSyncEventContext must be used within SyncEventProvider')
  return ctx
}

export function usePrizmContext(): PrizmContextValue {
  const ctx = useContext(PrizmContext)
  if (!ctx) throw new Error('usePrizmContext must be used within PrizmProvider')
  return ctx
}
