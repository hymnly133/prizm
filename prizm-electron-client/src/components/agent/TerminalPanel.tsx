/**
 * TerminalPanel — Agent 会话中的终端面板
 *
 * 功能：
 * - Tab 式多终端管理
 * - xterm.js 终端渲染
 * - 可拖拽分隔线调整高度
 * - 创建/关闭/切换终端
 * - 通过 WebSocket 实时 I/O
 */

import { createClientLogger } from '@prizm/client-core'
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'

const log = createClientLogger('TerminalUI')
import { Button, Tabs, Tooltip, Badge, Dropdown, Empty } from 'antd'
import {
  PlusOutlined,
  CloseOutlined,
  CodeOutlined,
  ExpandOutlined,
  CompressOutlined,
  DeleteOutlined
} from '@ant-design/icons'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { usePrizmContext } from '../../context/PrizmContext'
import { TerminalConnection } from '@prizm/client-core'
import type { TerminalSessionInfo } from '@prizm/client-core'

export interface TerminalPanelProps {
  sessionId: string
  scope: string
  visible: boolean
  onToggle: () => void
  /** 当终端列表变化时回调（用于外部感知） */
  onTerminalsChange?: (terminals: TerminalSessionInfo[]) => void
}

/** 单个终端 Tab 的内部状态 */
interface TerminalTabState {
  terminal: Terminal
  fitAddon: FitAddon
  terminalInfo: TerminalSessionInfo
  containerRef: React.RefObject<HTMLDivElement | null>
  mounted: boolean
}

const MIN_PANEL_HEIGHT = 120
const MAX_PANEL_HEIGHT = 600
const DEFAULT_PANEL_HEIGHT = 260

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  sessionId,
  scope,
  visible,
  onToggle,
  onTerminalsChange
}) => {
  const { manager } = usePrizmContext()
  const http = useMemo(() => manager?.getHttpClient(), [manager])

  // 终端列表和连接状态
  const [terminals, setTerminals] = useState<TerminalSessionInfo[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT)
  const [isMaximized, setIsMaximized] = useState(false)

  // xterm 实例管理
  const tabStatesRef = useRef<Map<string, TerminalTabState>>(new Map())
  const connectionRef = useRef<TerminalConnection | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null)

  // 初始化 WebSocket 连接
  useEffect(() => {
    if (!http || !visible) return
    const wsUrl = http.getTerminalWsUrl()
    const conn = new TerminalConnection(wsUrl)
    connectionRef.current = conn
    conn.connect()

    conn.on('output', (evt) => {
      const tab = tabStatesRef.current.get(evt.terminalId)
      if (tab) {
        tab.terminal.write(evt.data)
      }
    })

    conn.on('exit', (evt) => {
      setTerminals((prev) =>
        prev.map((t) =>
          t.id === evt.terminalId
            ? { ...t, status: 'exited' as const, exitCode: evt.exitCode, signal: evt.signal }
            : t
        )
      )
    })

    conn.on('title', (evt) => {
      setTerminals((prev) =>
        prev.map((t) => (t.id === evt.terminalId ? { ...t, title: evt.title } : t))
      )
    })

    return () => {
      conn.dispose()
      connectionRef.current = null
    }
  }, [http, visible])

  // 加载终端列表
  const fetchTerminals = useCallback(async () => {
    if (!http) return
    try {
      const list = await http.listTerminals(sessionId, scope)
      setTerminals(list)
      onTerminalsChange?.(list)
    } catch {
      // ignore
    }
  }, [http, sessionId, scope, onTerminalsChange])

  useEffect(() => {
    if (visible) {
      fetchTerminals()
    }
  }, [visible, fetchTerminals])

  // 创建新终端
  const handleCreateTerminal = useCallback(async () => {
    if (!http) return
    try {
      const terminal = await http.createTerminal(sessionId, {}, scope)
      setTerminals((prev) => {
        const updated = [...prev, terminal]
        onTerminalsChange?.(updated)
        return updated
      })
      setActiveKey(terminal.id)
    } catch (err) {
      log.error('Failed to create terminal:', err)
    }
  }, [http, sessionId, scope, onTerminalsChange])

  // 关闭终端
  const handleCloseTerminal = useCallback(
    async (termId: string) => {
      if (!http) return
      try {
        await http.killTerminal(sessionId, termId, scope)
      } catch {
        // ignore
      }
      // 清理 xterm 实例
      const tab = tabStatesRef.current.get(termId)
      if (tab) {
        tab.terminal.dispose()
        tabStatesRef.current.delete(termId)
      }
      setTerminals((prev) => {
        const updated = prev.filter((t) => t.id !== termId)
        onTerminalsChange?.(updated)
        return updated
      })
      if (activeKey === termId) {
        setActiveKey((prev) => {
          const remaining = Array.from(tabStatesRef.current.keys())
          return remaining.length > 0 ? remaining[remaining.length - 1] : null
        })
      }
    },
    [http, sessionId, scope, activeKey, onTerminalsChange]
  )

  // 切换 Tab 时 attach 到对应终端
  useEffect(() => {
    const conn = connectionRef.current
    if (!conn || !activeKey) return
    conn.attach(activeKey)
  }, [activeKey])

  // 创建/挂载 xterm 实例
  const mountTerminal = useCallback(
    (termId: string, container: HTMLDivElement | null) => {
      if (!container) return
      let tab = tabStatesRef.current.get(termId)
      if (tab && tab.mounted) {
        // 已挂载，执行 fit
        tab.fitAddon.fit()
        return
      }
      if (!tab) {
        const term = new Terminal({
          cursorBlink: true,
          fontSize: 13,
          fontFamily: '"Cascadia Code", "Fira Code", Menlo, Monaco, "Courier New", monospace',
          theme: {
            background: '#1e1e1e',
            foreground: '#cccccc',
            cursor: '#ffffff',
            selectionBackground: '#264f78'
          },
          scrollback: 5000,
          convertEol: true
        })
        const fitAddon = new FitAddon()
        term.loadAddon(fitAddon)
        term.loadAddon(new WebLinksAddon())

        const info = terminals.find((t) => t.id === termId)
        if (!info) return

        tab = {
          terminal: term,
          fitAddon,
          terminalInfo: info,
          containerRef: { current: container },
          mounted: false
        }
        tabStatesRef.current.set(termId, tab)
      }

      // 挂载到 DOM
      tab.terminal.open(container)

      // 尝试启用 WebGL 渲染（性能提升 3-5x），失败则自动回退到 Canvas
      try {
        const webglAddon = new WebglAddon()
        webglAddon.onContextLoss(() => {
          webglAddon.dispose()
        })
        tab.terminal.loadAddon(webglAddon)
      } catch {
        // WebGL 不可用，回退到默认 Canvas 渲染
      }

      tab.fitAddon.fit()
      tab.mounted = true

      // 转发用户输入到 WebSocket
      tab.terminal.onData((data) => {
        connectionRef.current?.write(data)
      })

      // 监听尺寸变化同步到服务端
      tab.terminal.onResize(({ cols, rows }) => {
        connectionRef.current?.resize(cols, rows)
      })
    },
    [terminals]
  )

  // 窗口 resize 时 fit
  useEffect(() => {
    if (!visible) return
    const handleResize = () => {
      for (const tab of tabStatesRef.current.values()) {
        if (tab.mounted) {
          try {
            tab.fitAddon.fit()
          } catch {
            // ignore
          }
        }
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [visible])

  // 面板高度变化时 fit
  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => {
      for (const tab of tabStatesRef.current.values()) {
        if (tab.mounted) {
          try {
            tab.fitAddon.fit()
          } catch {
            /* ignore */
          }
        }
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [panelHeight, visible, isMaximized])

  // 拖拽分隔线
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragStateRef.current = { startY: e.clientY, startHeight: panelHeight }

      const handleDragMove = (ev: MouseEvent) => {
        if (!dragStateRef.current) return
        const delta = dragStateRef.current.startY - ev.clientY
        const newHeight = Math.max(
          MIN_PANEL_HEIGHT,
          Math.min(MAX_PANEL_HEIGHT, dragStateRef.current.startHeight + delta)
        )
        setPanelHeight(newHeight)
      }

      const handleDragEnd = () => {
        dragStateRef.current = null
        document.removeEventListener('mousemove', handleDragMove)
        document.removeEventListener('mouseup', handleDragEnd)
      }

      document.addEventListener('mousemove', handleDragMove)
      document.addEventListener('mouseup', handleDragEnd)
    },
    [panelHeight]
  )

  // 清理 xterm 实例
  useEffect(() => {
    return () => {
      for (const tab of tabStatesRef.current.values()) {
        tab.terminal.dispose()
      }
      tabStatesRef.current.clear()
    }
  }, [])

  if (!visible) return null

  const effectiveHeight = isMaximized ? MAX_PANEL_HEIGHT : panelHeight

  const tabItems = terminals.map((t) => ({
    key: t.id,
    label: (
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Badge
          status={t.status === 'running' ? 'processing' : 'default'}
          style={{ marginRight: 4 }}
        />
        <span
          style={{
            maxWidth: 120,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {t.title || t.shell}
        </span>
      </span>
    ),
    closable: true,
    children: (
      <div
        ref={(el) => {
          if (el && t.id === activeKey) {
            mountTerminal(t.id, el)
          }
        }}
        style={{
          height: effectiveHeight - 46,
          background: '#1e1e1e',
          borderRadius: '0 0 6px 6px'
        }}
      />
    )
  }))

  return (
    <div
      ref={panelRef}
      style={{
        borderTop: '1px solid var(--ant-color-border, #303030)',
        background: 'var(--ant-color-bg-elevated, #1f1f1f)',
        display: 'flex',
        flexDirection: 'column',
        height: effectiveHeight,
        flexShrink: 0
      }}
    >
      {/* 拖拽分隔线 */}
      <div
        onMouseDown={handleDragStart}
        style={{
          height: 4,
          cursor: 'ns-resize',
          background: 'transparent',
          flexShrink: 0
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = 'var(--ant-color-primary, #1677ff)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
        }}
      />

      {terminals.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            gap: 12
          }}
        >
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无终端" />
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateTerminal}>
            新建终端
          </Button>
        </div>
      ) : (
        <Tabs
          type="editable-card"
          activeKey={activeKey || undefined}
          onChange={(key) => setActiveKey(key)}
          onEdit={(targetKey, action) => {
            if (action === 'add') {
              handleCreateTerminal()
            } else if (action === 'remove' && typeof targetKey === 'string') {
              handleCloseTerminal(targetKey)
            }
          }}
          tabBarExtraContent={{
            right: (
              <div style={{ display: 'flex', gap: 2, paddingRight: 8 }}>
                <Tooltip title={isMaximized ? '恢复' : '最大化'}>
                  <Button
                    type="text"
                    size="small"
                    icon={isMaximized ? <CompressOutlined /> : <ExpandOutlined />}
                    onClick={() => setIsMaximized((v) => !v)}
                  />
                </Tooltip>
                <Tooltip title="关闭面板">
                  <Button type="text" size="small" icon={<CloseOutlined />} onClick={onToggle} />
                </Tooltip>
              </div>
            )
          }}
          items={tabItems}
          size="small"
          style={{ flex: 1, overflow: 'hidden' }}
          tabBarStyle={{
            margin: 0,
            paddingLeft: 8,
            background: 'var(--ant-color-bg-container, #141414)'
          }}
        />
      )}
    </div>
  )
}
