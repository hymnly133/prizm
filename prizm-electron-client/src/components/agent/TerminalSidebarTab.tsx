/**
 * TerminalSidebarTab — 右侧边栏中的终端标签页
 *
 * 功能：
 * - 终端列表管理（创建、关闭、状态展示）
 * - 双 Exec Worker 状态展示（main 主工作区 / session 临时工作区）+ 命令历史
 * - 嵌入式 xterm.js 交互终端
 * - 通过 WebSocket 实时 I/O
 * - 终端切换与多终端支持
 */

import { createClientLogger } from '@prizm/client-core'
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'

const log = createClientLogger('TerminalUI')
import { Button, Tooltip, Badge, Empty } from 'antd'
import {
  PlusOutlined,
  CloseOutlined,
  ReloadOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ClockCircleFilled,
  ThunderboltFilled,
  FolderFilled,
  ExperimentFilled,
  LoadingOutlined
} from '@ant-design/icons'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { usePrizmContext } from '../../context/PrizmContext'
import { TerminalConnection } from '@prizm/client-core'
import type {
  TerminalSessionInfo,
  ExecWorkerInfo,
  ExecRecordInfo,
  ExecWorkspaceType
} from '@prizm/client-core'

export interface TerminalSidebarTabProps {
  sessionId: string | undefined
  scope: string
}

interface TerminalTabState {
  terminal: Terminal
  fitAddon: FitAddon
  mounted: boolean
}

// ---- 常量 ----

const WS_LABELS: Record<ExecWorkspaceType, string> = {
  main: '主工作区',
  session: '临时工作区'
}

const WS_COLORS: Record<ExecWorkspaceType, string> = {
  main: '#a855f7',
  session: '#3b82f6'
}

// ---- Exec Workers 区域 ----

function ExecWorkersSection({
  workers,
  records,
  expanded,
  onToggle
}: {
  workers: ExecWorkerInfo[]
  records: ExecRecordInfo[]
  expanded: boolean
  onToggle: () => void
}) {
  if (workers.length === 0 && records.length === 0) return null

  const totalCommands = workers.reduce((sum, w) => sum + w.commandCount, 0) || records.length
  const anyBusy = workers.some((w) => w.busy && !w.exited)

  return (
    <div className="exec-worker-section">
      <div className="exec-worker-section-header" onClick={onToggle} role="button" tabIndex={0}>
        <div className="exec-worker-info">
          <ThunderboltFilled style={{ color: '#a855f7', fontSize: 13 }} />
          <span className="exec-worker-title">命令执行器</span>
          {anyBusy && <LoadingOutlined style={{ fontSize: 10, color: '#faad14' }} />}
        </div>
        <span className="exec-worker-count">{totalCommands} 条命令</span>
      </div>

      {expanded && (
        <div className="exec-worker-section-body">
          {/* Worker 状态卡片 */}
          {workers.map((w) => (
            <ExecWorkerCard key={w.workspaceType} worker={w} />
          ))}

          {/* 如果没有 worker 但有记录 */}
          {workers.length === 0 && records.length > 0 && (
            <div className="exec-worker-meta" style={{ padding: '4px 12px' }}>
              <span style={{ color: '#8c8c8c' }}>Worker 未启动（有历史记录）</span>
            </div>
          )}

          {/* 命令历史 */}
          {records.length > 0 ? (
            <div className="exec-history-list">
              {records
                .slice()
                .reverse()
                .slice(0, 30)
                .map((r) => (
                  <ExecRecordItem key={r.id} record={r} />
                ))}
            </div>
          ) : (
            <div className="exec-history-empty">暂无执行记录</div>
          )}
        </div>
      )}
    </div>
  )
}

function ExecWorkerCard({ worker }: { worker: ExecWorkerInfo }) {
  const shellName = worker.shell.split(/[\\/]/).pop() || 'Shell'
  const statusColor = worker.exited ? '#ff4d4f' : worker.busy ? '#faad14' : '#52c41a'
  const statusText = worker.exited ? '已退出' : worker.busy ? '执行中' : '空闲'
  const wsColor = WS_COLORS[worker.workspaceType]
  const WsIcon = worker.workspaceType === 'main' ? FolderFilled : ExperimentFilled

  return (
    <div className="exec-worker-card">
      <div className="exec-worker-card-row">
        <WsIcon style={{ color: wsColor, fontSize: 11 }} />
        <span className="exec-worker-ws-label" style={{ color: wsColor }}>
          {WS_LABELS[worker.workspaceType]}
        </span>
        <span className="exec-worker-status" style={{ color: statusColor }}>
          {worker.busy && !worker.exited && (
            <LoadingOutlined style={{ fontSize: 9, marginRight: 3 }} />
          )}
          {statusText}
        </span>
        <span className="exec-worker-cmd-count">{worker.commandCount} 条</span>
      </div>
      <div className="exec-worker-meta">
        <span>{shellName}</span>
        <span>PID {worker.pid}</span>
        <span className="exec-worker-cwd" title={worker.cwd}>
          {shortenPath(worker.cwd)}
        </span>
      </div>
    </div>
  )
}

function ExecRecordItem({ record }: { record: ExecRecordInfo }) {
  const [showOutput, setShowOutput] = useState(false)
  const duration = record.finishedAt - record.startedAt
  const isSuccess = record.exitCode === 0
  const isTimeout = record.timedOut
  const wsColor = WS_COLORS[record.workspaceType]

  const icon = isTimeout ? (
    <ClockCircleFilled style={{ color: '#faad14', fontSize: 11 }} />
  ) : isSuccess ? (
    <CheckCircleFilled style={{ color: '#52c41a', fontSize: 11 }} />
  ) : (
    <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 11 }} />
  )

  return (
    <div className="exec-record">
      <div
        className="exec-record-header"
        onClick={() => setShowOutput((v) => !v)}
        role="button"
        tabIndex={0}
      >
        {icon}
        <span
          className="exec-record-ws-dot"
          style={{ background: wsColor }}
          title={WS_LABELS[record.workspaceType]}
        />
        <span className="exec-record-cmd">
          {record.command.length > 50 ? record.command.slice(0, 50) + '...' : record.command}
        </span>
        <span className="exec-record-duration">{formatDuration(duration)}</span>
      </div>
      {showOutput && (
        <pre className="exec-record-output">
          {record.output.slice(0, 2000) || '(无输出)'}
          {record.output.length > 2000 && '\n...(已截断)'}
        </pre>
      )}
    </div>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`
}

function shortenPath(p: string, maxLen = 30): string {
  if (p.length <= maxLen) return p
  const parts = p.split(/[\\/]/)
  if (parts.length <= 2) return '...' + p.slice(-maxLen + 3)
  return parts[0] + '/.../' + parts.slice(-2).join('/')
}

// ---- Main Component ----

export const TerminalSidebarTab: React.FC<TerminalSidebarTabProps> = ({ sessionId, scope }) => {
  const { manager } = usePrizmContext()
  const http = useMemo(() => manager?.getHttpClient(), [manager])

  const [terminals, setTerminals] = useState<TerminalSessionInfo[]>([])
  const [execWorkers, setExecWorkers] = useState<ExecWorkerInfo[]>([])
  const [execRecords, setExecRecords] = useState<ExecRecordInfo[]>([])
  const [execExpanded, setExecExpanded] = useState(true)
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const tabStatesRef = useRef<Map<string, TerminalTabState>>(new Map())
  const connectionRef = useRef<TerminalConnection | null>(null)
  const xtermContainerRef = useRef<HTMLDivElement>(null)
  const xtermWrapRef = useRef<HTMLDivElement>(null)
  const activeTerminalIdRef = useRef<string | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  // 同步 ref 供 ResizeObserver 回调读取（避免闭包过期）
  activeTerminalIdRef.current = activeTerminalId

  // WebSocket 连接管理
  useEffect(() => {
    if (!http) return
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
  }, [http])

  // 加载终端列表 + exec workers + history
  const fetchTerminals = useCallback(async () => {
    if (!http || !sessionId) return
    setLoading(true)
    try {
      const [termData, historyData] = await Promise.all([
        http.listTerminalsWithExec(sessionId, scope),
        http.getExecHistory(sessionId, 50, scope)
      ])
      setTerminals(termData.terminals)
      setExecWorkers(termData.execWorkers)
      setExecRecords(historyData.records)
      if (termData.terminals.length > 0 && !activeTerminalId) {
        setActiveTerminalId(termData.terminals[0].id)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [http, sessionId, scope, activeTerminalId])

  useEffect(() => {
    fetchTerminals()
  }, [fetchTerminals])

  // 定时刷新 exec worker 状态（轻量轮询）
  useEffect(() => {
    if (!http || !sessionId) return
    const interval = setInterval(async () => {
      try {
        const data = await http.getExecHistory(sessionId, 50, scope)
        setExecWorkers(data.execWorkers)
        setExecRecords(data.records)
      } catch {
        // ignore
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [http, sessionId, scope])

  // 创建新终端
  const handleCreate = useCallback(async () => {
    if (!http || !sessionId) return
    try {
      const terminal = await http.createTerminal(sessionId, {}, scope)
      setTerminals((prev) => [...prev, terminal])
      setActiveTerminalId(terminal.id)
    } catch (err) {
      log.error('Failed to create terminal:', err)
    }
  }, [http, sessionId, scope])

  // 关闭终端
  const handleKill = useCallback(
    async (termId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      if (!http || !sessionId) return
      try {
        await http.killTerminal(sessionId, termId, scope)
      } catch {
        // ignore
      }
      const tab = tabStatesRef.current.get(termId)
      if (tab) {
        tab.terminal.dispose()
        tabStatesRef.current.delete(termId)
      }
      setTerminals((prev) => prev.filter((t) => t.id !== termId))
      if (activeTerminalId === termId) {
        setActiveTerminalId((prev) => {
          const remaining = terminals.filter((t) => t.id !== termId)
          return remaining.length > 0 ? remaining[0].id : null
        })
      }
    },
    [http, sessionId, scope, activeTerminalId, terminals]
  )

  // 切换终端时 attach
  useEffect(() => {
    const conn = connectionRef.current
    if (!conn || !activeTerminalId) return
    conn.attach(activeTerminalId)
  }, [activeTerminalId])

  // 挂载/切换 xterm 实例
  useEffect(() => {
    const container = xtermContainerRef.current
    if (!container || !activeTerminalId) return

    for (const [id, tab] of tabStatesRef.current) {
      if (tab.mounted && id !== activeTerminalId) {
        const el = tab.terminal.element
        if (el) el.style.display = 'none'
      }
    }

    let tab = tabStatesRef.current.get(activeTerminalId)
    if (tab && tab.mounted) {
      const el = tab.terminal.element
      if (el) el.style.display = ''
      // 切换回已挂载的终端后，等一帧再 fit，确保 display 切换已生效
      requestAnimationFrame(() => {
        try {
          tab!.fitAddon.fit()
        } catch {
          // ignore
        }
      })
      return
    }

    if (!tab) {
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: '"Cascadia Code", "Fira Code", Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: '#1e1e1e',
          foreground: '#cccccc',
          cursor: '#ffffff',
          selectionBackground: '#264f78'
        },
        scrollback: 3000,
        convertEol: true
      })
      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.loadAddon(new WebLinksAddon())

      tab = { terminal: term, fitAddon, mounted: false }
      tabStatesRef.current.set(activeTerminalId, tab)
    }

    if (!tab.mounted) {
      tab.terminal.open(container)

      try {
        const webglAddon = new WebglAddon()
        webglAddon.onContextLoss(() => webglAddon.dispose())
        tab.terminal.loadAddon(webglAddon)
      } catch {
        // 回退到 Canvas
      }

      tab.mounted = true

      tab.terminal.onData((data) => {
        connectionRef.current?.write(data)
      })
      tab.terminal.onResize(({ cols, rows }) => {
        connectionRef.current?.resize(cols, rows)
      })

      // Double rAF：等待布局完全稳定后再 fit，避免容器尺寸尚未确定时列数计算错误
      const capturedTab = tab
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            capturedTab.fitAddon.fit()
          } catch {
            // ignore
          }
        })
      })
    }
  }, [activeTerminalId])

  // 容器 resize 时 fit —— 观察始终存在的 wrap 元素，通过 ref 获取活动终端
  useEffect(() => {
    const wrap = xtermWrapRef.current
    if (!wrap) return

    let rafId = 0
    const observer = new ResizeObserver(() => {
      // 用 rAF 节流，防止快速连续 resize 时过多 fit 调用
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const id = activeTerminalIdRef.current
        if (!id) return
        const tab = tabStatesRef.current.get(id)
        if (tab?.mounted) {
          try {
            tab.fitAddon.fit()
          } catch {
            // ignore
          }
        }
      })
    })
    observer.observe(wrap)
    resizeObserverRef.current = observer

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      observer.disconnect()
      resizeObserverRef.current = null
    }
  }, [])

  // 清理
  useEffect(() => {
    return () => {
      for (const tab of tabStatesRef.current.values()) {
        tab.terminal.dispose()
      }
      tabStatesRef.current.clear()
    }
  }, [])

  if (!sessionId) {
    return (
      <div className="term-sidebar">
        <div className="term-sidebar-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择会话后可使用终端" />
        </div>
      </div>
    )
  }

  const activeTerminal = terminals.find((t) => t.id === activeTerminalId)

  return (
    <div className="term-sidebar">
      {/* 标题栏 */}
      <div className="term-sidebar-header">
        <span className="term-sidebar-title">终端</span>
        <div className="term-sidebar-actions">
          <Tooltip title="刷新列表">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={fetchTerminals}
              loading={loading}
            />
          </Tooltip>
          <Tooltip title="新建终端">
            <Button type="text" size="small" icon={<PlusOutlined />} onClick={handleCreate} />
          </Tooltip>
        </div>
      </div>

      {/* Exec Workers 状态区域 */}
      <ExecWorkersSection
        workers={execWorkers}
        records={execRecords}
        expanded={execExpanded}
        onToggle={() => setExecExpanded((v) => !v)}
      />

      {/* Interactive 终端列表 */}
      <div className="term-sidebar-list">
        {terminals.length === 0 ? (
          <div className="term-sidebar-list-empty">
            <span>暂无终端</span>
            <Button type="link" size="small" icon={<PlusOutlined />} onClick={handleCreate}>
              新建
            </Button>
          </div>
        ) : (
          terminals.map((t) => (
            <div
              key={t.id}
              className={`term-sidebar-item${t.id === activeTerminalId ? ' active' : ''}${
                t.status === 'exited' ? ' exited' : ''
              }`}
              onClick={() => setActiveTerminalId(t.id)}
            >
              <Badge
                status={t.status === 'running' ? 'processing' : 'default'}
                className="term-sidebar-item-badge"
              />
              <div className="term-sidebar-item-info">
                <span className="term-sidebar-item-name">
                  {t.title || t.shell.split(/[\\/]/).pop() || 'Terminal'}
                </span>
                <span className="term-sidebar-item-meta">
                  PID {t.pid}
                  {t.status === 'exited' && ` · exit ${t.exitCode ?? '?'}`}
                </span>
              </div>
              <Tooltip title="关闭终端">
                <button
                  className="term-sidebar-item-kill"
                  onClick={(e) => handleKill(t.id, e)}
                  aria-label="关闭终端"
                >
                  <CloseOutlined style={{ fontSize: 10 }} />
                </button>
              </Tooltip>
            </div>
          ))
        )}
      </div>

      {/* xterm 渲染区 */}
      <div className="term-sidebar-xterm-wrap" ref={xtermWrapRef}>
        {activeTerminal ? (
          <div ref={xtermContainerRef} className="term-sidebar-xterm" />
        ) : (
          <div className="term-sidebar-xterm-empty">
            {terminals.length > 0 ? '选择一个终端' : '创建终端开始使用'}
          </div>
        )}
      </div>
    </div>
  )
}
