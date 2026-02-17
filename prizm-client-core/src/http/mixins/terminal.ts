import { PrizmClient } from '../client'
import type { TerminalSessionInfo, ExecWorkerInfo, ExecRecordInfo } from '../clientTypes'

declare module '../client' {
  interface PrizmClient {
    createTerminal(
      sessionId: string,
      opts?: { shell?: string; cwd?: string; cols?: number; rows?: number; title?: string },
      scope?: string
    ): Promise<TerminalSessionInfo>
    listTerminals(sessionId: string, scope?: string): Promise<TerminalSessionInfo[]>
    listTerminalsWithExec(
      sessionId: string,
      scope?: string
    ): Promise<{ terminals: TerminalSessionInfo[]; execWorkers: ExecWorkerInfo[] }>
    getExecHistory(
      sessionId: string,
      limit?: number,
      scope?: string
    ): Promise<{ records: ExecRecordInfo[]; execWorkers: ExecWorkerInfo[] }>
    getTerminalDetail(
      sessionId: string,
      terminalId: string,
      scope?: string
    ): Promise<{ terminal: TerminalSessionInfo; recentOutput: string }>
    resizeTerminal(
      sessionId: string,
      terminalId: string,
      cols: number,
      rows: number,
      scope?: string
    ): Promise<void>
    killTerminal(sessionId: string, terminalId: string, scope?: string): Promise<void>
    getTerminalWsUrl(): string
  }
}

PrizmClient.prototype.createTerminal = async function (
  this: PrizmClient,
  sessionId: string,
  opts?: { shell?: string; cwd?: string; cols?: number; rows?: number; title?: string },
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/terminals`, {
    scope: s
  })
  const response = await fetch(url, {
    method: 'POST',
    headers: this.buildHeaders(),
    body: JSON.stringify(opts ?? {})
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${text || 'Failed to create terminal'}`)
  }
  const data = (await response.json()) as { terminal: TerminalSessionInfo }
  return data.terminal
}

PrizmClient.prototype.listTerminals = async function (
  this: PrizmClient,
  sessionId: string,
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/terminals`, {
    scope: s
  })
  const response = await fetch(url, {
    method: 'GET',
    headers: this.buildHeaders()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${text || 'Failed to list terminals'}`)
  }
  const data = (await response.json()) as {
    terminals: TerminalSessionInfo[]
    execWorker?: ExecWorkerInfo | null
  }
  return data.terminals
}

PrizmClient.prototype.listTerminalsWithExec = async function (
  this: PrizmClient,
  sessionId: string,
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/terminals`, {
    scope: s
  })
  const response = await fetch(url, {
    method: 'GET',
    headers: this.buildHeaders()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${text || 'Failed to list terminals'}`)
  }
  const data = (await response.json()) as {
    terminals: TerminalSessionInfo[]
    execWorkers?: ExecWorkerInfo[]
  }
  return { terminals: data.terminals, execWorkers: data.execWorkers ?? [] }
}

PrizmClient.prototype.getExecHistory = async function (
  this: PrizmClient,
  sessionId: string,
  limit?: number,
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const params: Record<string, string> = { scope: s }
  if (limit) params.limit = String(limit)
  const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/exec-history`, params)
  const response = await fetch(url, {
    method: 'GET',
    headers: this.buildHeaders()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${text || 'Failed to get exec history'}`)
  }
  const data = (await response.json()) as {
    records: ExecRecordInfo[]
    execWorkers?: ExecWorkerInfo[]
  }
  return { records: data.records, execWorkers: data.execWorkers ?? [] }
}

PrizmClient.prototype.getTerminalDetail = async function (
  this: PrizmClient,
  sessionId: string,
  terminalId: string,
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl(
    `/agent/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(terminalId)}`,
    { scope: s }
  )
  const response = await fetch(url, {
    method: 'GET',
    headers: this.buildHeaders()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${text || 'Failed to get terminal detail'}`)
  }
  return response.json() as Promise<{ terminal: TerminalSessionInfo; recentOutput: string }>
}

PrizmClient.prototype.resizeTerminal = async function (
  this: PrizmClient,
  sessionId: string,
  terminalId: string,
  cols: number,
  rows: number,
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl(
    `/agent/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(
      terminalId
    )}/resize`,
    { scope: s }
  )
  const response = await fetch(url, {
    method: 'POST',
    headers: this.buildHeaders(),
    body: JSON.stringify({ cols, rows })
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${text || 'Failed to resize terminal'}`)
  }
}

PrizmClient.prototype.killTerminal = async function (
  this: PrizmClient,
  sessionId: string,
  terminalId: string,
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl(
    `/agent/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(terminalId)}`,
    { scope: s }
  )
  const response = await fetch(url, {
    method: 'DELETE',
    headers: this.buildHeaders()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${text || 'Failed to kill terminal'}`)
  }
}

PrizmClient.prototype.getTerminalWsUrl = function (this: PrizmClient) {
  const wsUrl = this.baseUrl.replace(/^http/, 'ws')
  const apiKeyParam = this.apiKey ? `?apiKey=${encodeURIComponent(this.apiKey)}` : ''
  return `${wsUrl}/ws/terminal${apiKeyParam}`
}
