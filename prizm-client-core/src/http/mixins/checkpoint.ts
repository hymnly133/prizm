import { PrizmClient } from '../client'
import type { SessionCheckpoint, CheckpointFileChange, AgentSession } from '../../types'

export interface RollbackResult {
  session: AgentSession
  rolledBackMessageCount: number
  restoredFiles: string[]
  rolledBackFileChanges: CheckpointFileChange[]
}

declare module '../client' {
  interface PrizmClient {
    listCheckpoints(sessionId: string, scope?: string): Promise<SessionCheckpoint[]>
    rollbackToCheckpoint(
      sessionId: string,
      checkpointId: string,
      options?: { restoreFiles?: boolean; scope?: string }
    ): Promise<RollbackResult>
  }
}

PrizmClient.prototype.listCheckpoints = async function (
  this: PrizmClient,
  sessionId: string,
  scope?: string
) {
  const result = await this.request<{ checkpoints: SessionCheckpoint[] }>(
    `/agent/sessions/${encodeURIComponent(sessionId)}/checkpoints`,
    { method: 'GET', scope: scope ?? this.defaultScope }
  )
  return result.checkpoints
}

PrizmClient.prototype.rollbackToCheckpoint = async function (
  this: PrizmClient,
  sessionId: string,
  checkpointId: string,
  options?: { restoreFiles?: boolean; scope?: string }
) {
  return this.request<RollbackResult>(
    `/agent/sessions/${encodeURIComponent(sessionId)}/rollback/${encodeURIComponent(checkpointId)}`,
    {
      method: 'POST',
      scope: options?.scope ?? this.defaultScope,
      body: JSON.stringify({ restoreFiles: options?.restoreFiles ?? true })
    }
  )
}
