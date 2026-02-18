import { createClientLogger } from '../../logger'
import { PrizmClient } from '../client'
import type {
  AgentSession,
  EnrichedSession,
  StreamChatOptions,
  StreamChatChunk,
  SessionStats
} from '../../types'

const log = createClientLogger('AgentHTTP')

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
    listAgentSessions(scope?: string): Promise<EnrichedSession[]>
    createAgentSession(scope?: string): Promise<AgentSession>
    getAgentSession(id: string, scope?: string): Promise<EnrichedSession>
    getSessionMessage(
      sessionId: string,
      messageId: string,
      scope?: string,
      context?: number
    ): Promise<{
      sessionId: string
      messageId: string
      messageIndex: number
      totalMessages: number
      message: AgentSession['messages'][number]
      context: AgentSession['messages']
    }>
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

    // BG Session management
    triggerBgSession(
      payload: {
        prompt: string
        systemInstructions?: string
        context?: Record<string, unknown>
        expectedOutputFormat?: string
        label?: string
        model?: string
        timeoutMs?: number
        autoCleanup?: boolean
      },
      scope?: string
    ): Promise<{ sessionId: string; status: string }>
    cancelBgSession(
      sessionId: string,
      scope?: string
    ): Promise<{ sessionId: string; status: string }>
    getBgSessionResult(
      sessionId: string,
      scope?: string
    ): Promise<{ sessionId: string; status: string; output: string; durationMs: number } | null>
    getBgSummary(scope?: string): Promise<{
      active: number
      completed: number
      failed: number
      timeout: number
      cancelled: number
    }>
    batchCancelBgSessions(sessionIds?: string[], scope?: string): Promise<{ cancelled: number }>
  }
}

PrizmClient.prototype.getAgentScopeContext = async function (this: PrizmClient, scope?: string) {
  return this.request<{ summary: string; scope: string }>('/agent/debug/scope-context', {
    method: 'GET',
    scope: scope ?? this.defaultScope
  })
}

PrizmClient.prototype.getAgentSystemPrompt = async function (
  this: PrizmClient,
  scope?: string,
  sessionId?: string
) {
  const sessionParam = sessionId?.trim() ? `?sessionId=${encodeURIComponent(sessionId.trim())}` : ''
  return this.request<{
    systemPrompt: string
    scope: string
    sessionId: string | null
  }>(`/agent/system-prompt${sessionParam}`, {
    method: 'GET',
    scope: scope ?? this.defaultScope
  })
}

PrizmClient.prototype.getAgentScopeItems = async function (this: PrizmClient, scope?: string) {
  return this.request<{
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
  }>('/agent/scope-items', { method: 'GET', scope: scope ?? this.defaultScope })
}

PrizmClient.prototype.getAgentSlashCommands = async function (this: PrizmClient, scope?: string) {
  return this.request<{
    commands: { name: string; aliases: string[]; description: string }[]
  }>('/agent/slash-commands', { method: 'GET', scope: scope ?? this.defaultScope })
}

PrizmClient.prototype.getAgentToolsMetadata = async function (this: PrizmClient) {
  return this.request<{
    tools: Array<{
      name: string
      displayName: string
      description?: string
      docUrl?: string
      category?: string
      scopeActivity?: string
    }>
  }>('/agent/tools/metadata', { method: 'GET' })
}

PrizmClient.prototype.getAgentSessionContext = async function (
  this: PrizmClient,
  sessionId: string,
  scope?: string
) {
  const json = await this.request<{
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
  }>(`/agent/sessions/${encodeURIComponent(sessionId)}/context`, {
    method: 'GET',
    scope: scope ?? this.defaultScope
  })
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
  return this.request<SessionStats>(`/agent/sessions/${encodeURIComponent(sessionId)}/stats`, {
    method: 'GET',
    scope: scope ?? this.defaultScope
  })
}

PrizmClient.prototype.listAgentSessions = async function (this: PrizmClient, scope?: string) {
  const data = await this.request<{ sessions: EnrichedSession[] }>('/agent/sessions', {
    method: 'GET',
    scope: scope ?? this.defaultScope
  })
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
  const data = await this.request<{ session: EnrichedSession }>(
    `/agent/sessions/${encodeURIComponent(id)}`,
    { method: 'GET', scope: scope ?? this.defaultScope }
  )
  return data.session
}

PrizmClient.prototype.getSessionMessage = async function (
  this: PrizmClient,
  sessionId: string,
  messageId: string,
  scope?: string,
  context?: number
) {
  const contextParam = context != null ? `?context=${context}` : ''
  const path = `/agent/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(
    messageId
  )}${contextParam}`
  return this.request(path, {
    method: 'GET',
    scope: scope ?? this.defaultScope
  })
}

PrizmClient.prototype.deleteAgentSession = async function (
  this: PrizmClient,
  id: string,
  scope?: string
) {
  await this.request<void>(`/agent/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    scope: scope ?? this.defaultScope
  })
}

PrizmClient.prototype.updateAgentSession = async function (
  this: PrizmClient,
  id: string,
  update: { llmSummary?: string },
  scope?: string
) {
  const data = await this.request<{ session: AgentSession }>(
    `/agent/sessions/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      scope: scope ?? this.defaultScope,
      body: JSON.stringify(update)
    }
  )
  return data.session
}

PrizmClient.prototype.grantSessionPaths = async function (
  this: PrizmClient,
  sessionId: string,
  paths: string[],
  scope?: string
) {
  return this.request<{ grantedPaths: string[] }>(
    `/agent/sessions/${encodeURIComponent(sessionId)}/grant-paths`,
    {
      method: 'POST',
      scope: scope ?? this.defaultScope,
      body: JSON.stringify({ paths })
    }
  )
}

PrizmClient.prototype.respondToInteract = async function (
  this: PrizmClient,
  sessionId: string,
  requestId: string,
  approved: boolean,
  options?: { paths?: string[]; scope?: string }
) {
  return this.request<{
    requestId: string
    approved: boolean
    grantedPaths: string[]
  }>(`/agent/sessions/${encodeURIComponent(sessionId)}/interact-response`, {
    method: 'POST',
    scope: options?.scope ?? this.defaultScope,
    body: JSON.stringify({
      requestId,
      approved,
      ...(options?.paths && { paths: options.paths })
    })
  })
}

// streamChat must use raw fetch for SSE streaming
PrizmClient.prototype.streamChat = async function (
  this: PrizmClient,
  sessionId: string,
  content: string,
  options?: StreamChatOptions & { scope?: string }
) {
  const scope = options?.scope ?? this.defaultScope
  log.info('Starting stream chat, sessionId:', sessionId)
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
      if (options?.signal?.aborted) {
        log.info('Stream aborted by signal')
        break
      }
      const { done, value } = await reader.read()
      if (done) {
        log.info('Stream reader done')
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith(': heartbeat')) {
          try {
            options?.onChunk?.({ type: 'heartbeat' })
          } catch (hbErr) {
            log.warn('Heartbeat handler error:', hbErr)
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
              log.error('onChunk handler error:', chunkErr)
            }
            if (parsed.type === 'text' && typeof parsed.value === 'string') {
              fullContent += parsed.value
            }
            if (parsed.type === 'tool_call') {
              await new Promise<void>((r) => setTimeout(r, 0))
            }
          } catch (parseErr) {
            log.warn('Failed to parse SSE data:', data.slice(0, 100))
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
  return this.request<{ stopped: boolean }>(
    `/agent/sessions/${encodeURIComponent(sessionId)}/stop`,
    { method: 'POST', scope: scope ?? this.defaultScope }
  )
}

PrizmClient.prototype.getAgentCapabilities = async function (this: PrizmClient) {
  return this.request('/agent/capabilities')
}

// ── BG Session 管理 ──

PrizmClient.prototype.triggerBgSession = async function (this: PrizmClient, payload, scope?) {
  return this.request<{ sessionId: string; status: string }>('/agent/sessions/trigger', {
    method: 'POST',
    scope: scope ?? this.defaultScope,
    body: JSON.stringify(payload)
  })
}

PrizmClient.prototype.cancelBgSession = async function (
  this: PrizmClient,
  sessionId: string,
  scope?: string
) {
  return this.request<{ sessionId: string; status: string }>(
    `/agent/sessions/${encodeURIComponent(sessionId)}/cancel`,
    { method: 'POST', scope: scope ?? this.defaultScope }
  )
}

PrizmClient.prototype.getBgSessionResult = async function (
  this: PrizmClient,
  sessionId: string,
  scope?: string
) {
  return this.request<{
    sessionId: string
    status: string
    output: string
    durationMs: number
  } | null>(`/agent/sessions/${encodeURIComponent(sessionId)}/result`, {
    method: 'GET',
    scope: scope ?? this.defaultScope
  })
}

PrizmClient.prototype.getBgSummary = async function (this: PrizmClient, scope?: string) {
  return this.request<{
    active: number
    completed: number
    failed: number
    timeout: number
    cancelled: number
  }>('/agent/background-summary', {
    method: 'GET',
    scope: scope ?? this.defaultScope
  })
}

PrizmClient.prototype.batchCancelBgSessions = async function (
  this: PrizmClient,
  sessionIds?: string[],
  scope?: string
) {
  return this.request<{ cancelled: number }>('/agent/background/batch-cancel', {
    method: 'POST',
    scope: scope ?? this.defaultScope,
    body: JSON.stringify(sessionIds ? { sessionIds } : {})
  })
}
