import { PrizmClient } from '../client'
import type { AgentSession, StreamChatOptions, StreamChatChunk, SessionStats } from '../../types'

declare module '../client' {
  interface PrizmClient {
    getAgentScopeContext(scope?: string): Promise<{ summary: string; scope: string }>
    getAgentSystemPrompt(
      scope?: string,
      sessionId?: string
    ): Promise<{ systemPrompt: string; scope: string; sessionId: string | null }>
    getAgentScopeItems(scope?: string): Promise<{
      refTypes: { key: string; label: string; aliases: string[] }[]
      items: {
        id: string
        kind: string
        title: string
        charCount: number
        isShort: boolean
        updatedAt: number
        groupOrStatus?: string
      }[]
    }>
    getAgentSlashCommands(scope?: string): Promise<{
      commands: { name: string; aliases: string[]; description: string }[]
    }>
    getAgentToolsMetadata(): Promise<{
      tools: Array<{
        name: string
        displayName: string
        description?: string
        docUrl?: string
        category?: string
        scopeActivity?: string
      }>
    }>
    getAgentSessionContext(
      sessionId: string,
      scope?: string
    ): Promise<{
      sessionId: string
      scope: string
      provisions: {
        itemId: string
        kind: string
        mode: string
        providedAt: number
        charCount: number
        version: number
        stale: boolean
      }[]
      totalProvidedChars: number
      activities: {
        toolName: string
        action: string
        itemKind?: string
        itemId?: string
        title?: string
        timestamp: number
      }[]
    }>
    getAgentSessionStats(sessionId: string, scope?: string): Promise<SessionStats>
    listAgentSessions(scope?: string): Promise<AgentSession[]>
    createAgentSession(scope?: string): Promise<AgentSession>
    getAgentSession(id: string, scope?: string): Promise<AgentSession>
    deleteAgentSession(id: string, scope?: string): Promise<void>
    updateAgentSession(
      id: string,
      update: { llmSummary?: string },
      scope?: string
    ): Promise<AgentSession>
    grantSessionPaths(
      sessionId: string,
      paths: string[],
      scope?: string
    ): Promise<{ grantedPaths: string[] }>
    respondToInteract(
      sessionId: string,
      requestId: string,
      approved: boolean,
      options?: { paths?: string[]; scope?: string }
    ): Promise<{ requestId: string; approved: boolean; grantedPaths: string[] }>
    streamChat(
      sessionId: string,
      content: string,
      options?: StreamChatOptions & { scope?: string }
    ): Promise<string>
    stopAgentChat(sessionId: string, scope?: string): Promise<{ stopped: boolean }>
    getAgentCapabilities(): Promise<{
      builtinTools: unknown[]
      slashCommands: unknown[]
      customCommands: unknown[]
      skills: unknown[]
      rules: unknown[]
    }>
  }
}

PrizmClient.prototype.getAgentScopeContext = async function (this: PrizmClient, scope?: string) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl('/agent/debug/scope-context', { scope: s })
  const response = await fetch(url, {
    method: 'GET',
    headers: this.buildHeaders()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  return (await response.json()) as { summary: string; scope: string }
}

PrizmClient.prototype.getAgentSystemPrompt = async function (
  this: PrizmClient,
  scope?: string,
  sessionId?: string
) {
  const s = scope ?? this.defaultScope
  const params: Record<string, string> = { scope: s }
  if (sessionId?.trim()) params.sessionId = sessionId.trim()
  const url = this.buildUrl('/agent/system-prompt', params)
  const response = await fetch(url, {
    method: 'GET',
    headers: this.buildHeaders()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  return (await response.json()) as {
    systemPrompt: string
    scope: string
    sessionId: string | null
  }
}

PrizmClient.prototype.getAgentScopeItems = async function (this: PrizmClient, scope?: string) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl('/agent/scope-items', { scope: s })
  const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  return (await response.json()) as {
    refTypes: { key: string; label: string; aliases: string[] }[]
    items: {
      id: string
      kind: string
      title: string
      charCount: number
      isShort: boolean
      updatedAt: number
      groupOrStatus?: string
    }[]
  }
}

PrizmClient.prototype.getAgentSlashCommands = async function (this: PrizmClient, scope?: string) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl('/agent/slash-commands', { scope: s })
  const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  return (await response.json()) as {
    commands: { name: string; aliases: string[]; description: string }[]
  }
}

PrizmClient.prototype.getAgentToolsMetadata = async function (this: PrizmClient) {
  const response = await fetch(this.buildUrl('/agent/tools/metadata'), {
    method: 'GET',
    headers: this.buildHeaders()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  return (await response.json()) as {
    tools: Array<{
      name: string
      displayName: string
      description?: string
      docUrl?: string
      category?: string
      scopeActivity?: string
    }>
  }
}

PrizmClient.prototype.getAgentSessionContext = async function (
  this: PrizmClient,
  sessionId: string,
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/context`, {
    scope: s
  })
  const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  const json = (await response.json()) as {
    sessionId: string
    scope: string
    provisions: {
      itemId: string
      kind: string
      mode: string
      providedAt: number
      charCount: number
      version: number
      stale: boolean
    }[]
    totalProvidedChars: number
    activities?: {
      toolName: string
      action: string
      itemKind?: string
      itemId?: string
      title?: string
      timestamp: number
    }[]
  }
  return {
    ...json,
    activities: json.activities ?? []
  }
}

PrizmClient.prototype.getAgentSessionStats = async function (
  this: PrizmClient,
  sessionId: string,
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/stats`, {
    scope: s
  })
  const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  return (await response.json()) as SessionStats
}

PrizmClient.prototype.listAgentSessions = async function (this: PrizmClient, scope?: string) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl('/agent/sessions', { scope: s })
  const response = await fetch(url, {
    method: 'GET',
    headers: this.buildHeaders()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  const data = (await response.json()) as { sessions: AgentSession[] }
  return data.sessions ?? []
}

PrizmClient.prototype.createAgentSession = async function (this: PrizmClient, scope?: string) {
  const data = await this.request<{ session: AgentSession }>('/agent/sessions', {
    method: 'POST',
    scope: scope ?? this.defaultScope,
    body: JSON.stringify({})
  })
  return data.session
}

PrizmClient.prototype.getAgentSession = async function (
  this: PrizmClient,
  id: string,
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(id)}`, {
    scope: s
  })
  const response = await fetch(url, {
    method: 'GET',
    headers: this.buildHeaders()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  const data = (await response.json()) as { session: AgentSession }
  return data.session
}

PrizmClient.prototype.deleteAgentSession = async function (
  this: PrizmClient,
  id: string,
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(id)}`, {
    scope: s
  })
  const response = await fetch(url, {
    method: 'DELETE',
    headers: this.buildHeaders()
  })
  if (!response.ok && response.status !== 204) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
}

PrizmClient.prototype.updateAgentSession = async function (
  this: PrizmClient,
  id: string,
  update: { llmSummary?: string },
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(id)}`, {
    scope: s
  })
  const response = await fetch(url, {
    method: 'PATCH',
    headers: this.buildHeaders(),
    body: JSON.stringify(update)
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  const data = (await response.json()) as { session: AgentSession }
  return data.session
}

PrizmClient.prototype.grantSessionPaths = async function (
  this: PrizmClient,
  sessionId: string,
  paths: string[],
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/grant-paths`, {
    scope: s
  })
  const response = await fetch(url, {
    method: 'POST',
    headers: this.buildHeaders(),
    body: JSON.stringify({ paths })
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  const data = (await response.json()) as { grantedPaths: string[] }
  return data
}

PrizmClient.prototype.respondToInteract = async function (
  this: PrizmClient,
  sessionId: string,
  requestId: string,
  approved: boolean,
  options?: { paths?: string[]; scope?: string }
) {
  const s = options?.scope ?? this.defaultScope
  const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/interact-response`, {
    scope: s
  })
  const response = await fetch(url, {
    method: 'POST',
    headers: this.buildHeaders(),
    body: JSON.stringify({
      requestId,
      approved,
      ...(options?.paths && { paths: options.paths })
    })
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  return (await response.json()) as {
    requestId: string
    approved: boolean
    grantedPaths: string[]
  }
}

PrizmClient.prototype.streamChat = async function (
  this: PrizmClient,
  sessionId: string,
  content: string,
  options?: StreamChatOptions & { scope?: string }
) {
  const scope = options?.scope ?? this.defaultScope
  const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/chat`, {
    scope
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: this.buildHeaders(),
    body: JSON.stringify({
      content,
      model: options?.model,
      includeScopeContext: options?.includeScopeContext,
      fullContextTurns: options?.fullContextTurns,
      cachedContextTurns: options?.cachedContextTurns,
      fileRefs: options?.fileRefs
    }),
    signal: options?.signal
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''

  try {
    while (true) {
      if (options?.signal?.aborted) break
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith(': heartbeat')) {
          try {
            options?.onChunk?.({ type: 'heartbeat' })
          } catch {
            // ignore heartbeat errors
          }
          continue
        }
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          try {
            const parsed = JSON.parse(data) as StreamChatChunk
            if (parsed.type === 'error') {
              options?.onError?.(typeof parsed.value === 'string' ? parsed.value : 'Unknown error')
            }
            try {
              options?.onChunk?.(parsed)
            } catch (chunkErr) {
              console.error('[streamChat] onChunk handler error:', chunkErr, 'chunk:', parsed)
            }
            if (parsed.type === 'text' && typeof parsed.value === 'string') {
              fullContent += parsed.value
            }
            if (parsed.type === 'tool_call') {
              await new Promise<void>((r) => setTimeout(r, 0))
            }
          } catch {
            // ignore JSON parse errors
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return fullContent
}

PrizmClient.prototype.stopAgentChat = async function (
  this: PrizmClient,
  sessionId: string,
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/stop`, {
    scope: s
  })
  const response = await fetch(url, {
    method: 'POST',
    headers: this.buildHeaders()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  return (await response.json()) as { stopped: boolean }
}

PrizmClient.prototype.getAgentCapabilities = async function (this: PrizmClient) {
  return this.request('/agent/capabilities')
}
