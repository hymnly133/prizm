/**
 * ToolLLMManager — Tool LLM 会话生命周期管理
 *
 * 负责：
 * - start: 创建新 Tool LLM session → 执行首轮 chatCore
 * - resume: 在已有 session 上追加消息 → 执行 chatCore
 * - getSessionForWorkflow: 通过 DefMeta 查找关联 session
 * - confirm: 确认注册工作流并写入 DefMeta.workflowManagementSessionId
 *
 * 不走 BgSessionManager，直接管理 session 生命周期。
 */

import type { IAgentAdapter, LLMStreamChunk } from '../../adapters/interfaces'
import type { IChatService, ChatCoreChunkHandler } from '../../core/interfaces'
import {
  type WorkflowDef,
  isWorkflowManagementSession,
  WORKFLOW_MANAGEMENT_SOURCE,
  WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW,
  WORKFLOW_MANAGEMENT_TOOL_UPDATE_WORKFLOW
} from '@prizm/shared'
import type { ToolLLMStartRequest, ToolLLMResult, ToolLLMStatus } from './types'
import { WORKFLOW_MANAGEMENT_TOOLS, executeSubmitWorkflow } from './workflowSubmitTool'
import * as defStore from '../../core/workflowEngine/workflowDefStore'
import { emit } from '../../core/eventBus'
import { createLogger } from '../../logger'

const log = createLogger('ToolLLM')

/** 活跃 Tool LLM 会话的运行时状态 */
interface ActiveSession {
  scope: string
  domain: 'workflow'
  workflowName?: string
  version: number
  latestDef?: WorkflowDef
  latestYaml?: string
  status: ToolLLMStatus
}

export class ToolLLMManager {
  private adapter: IAgentAdapter | undefined
  private chatService: IChatService | undefined
  private activeSessions = new Map<string, ActiveSession>()

  init(adapter: IAgentAdapter | undefined, chatService: IChatService): void {
    this.adapter = adapter
    this.chatService = chatService
    log.info('ToolLLMManager initialized')
  }

  /**
   * 启动新的 Tool LLM 会话，或对已有「待创建」工作流管理会话发起首轮
   * @param request.sessionId 可选；传入则复用该会话（须为 workflow-management 且无 workflowDefId）
   * @returns sessionId — 会话 ID
   */
  async start(
    scope: string,
    request: ToolLLMStartRequest,
    onChunk: ChatCoreChunkHandler
  ): Promise<ToolLLMResult> {
    if (!this.chatService) {
      throw new Error('ToolLLMManager not initialized')
    }

    let sessionId: string

    if (request.sessionId && this.adapter?.getSession) {
      const existing = await this.adapter.getSession(scope, request.sessionId)
      if (!existing) {
        throw new Error('Session not found')
      }
      if (!isWorkflowManagementSession(existing)) {
        throw new Error('Session is not a workflow management session')
      }
      const boundId = existing.toolMeta?.workflowDefId ?? existing.bgMeta?.workflowDefId
      if (boundId) {
        throw new Error('Session is already bound to a workflow; use refine to continue')
      }
      sessionId = request.sessionId
    } else {
      if (!this.adapter?.createSession) {
        throw new Error('ToolLLMManager not initialized')
      }
      const session = await this.adapter.createSession(scope)
      await this.adapter.updateSession?.(scope, session.id, {
        kind: 'tool',
        toolMeta: {
          source: WORKFLOW_MANAGEMENT_SOURCE,
          label: `工作流管理: ${request.workflowName ?? '新建'}`
        }
      })
      sessionId = session.id
    }

    let active = this.activeSessions.get(sessionId)
    if (!active) {
      active = {
        scope,
        domain: 'workflow',
        workflowName: request.workflowName,
        version: 0,
        status: 'generating'
      }
      this.activeSessions.set(sessionId, active)
    }
    active.status = 'generating'

    const content = this.buildFirstTurnContent(request)
    return this.executeRound(scope, sessionId, content, request.existingYaml, onChunk)
  }

  /**
   * 复用已有 session 追加消息
   */
  async resume(
    scope: string,
    sessionId: string,
    message: string,
    onChunk: ChatCoreChunkHandler
  ): Promise<ToolLLMResult> {
    if (!this.chatService) {
      throw new Error('ToolLLMManager not initialized')
    }

    let active = this.activeSessions.get(sessionId)
    if (!active) {
      active = {
        scope,
        domain: 'workflow',
        version: 0,
        status: 'generating'
      }
      this.activeSessions.set(sessionId, active)
    }
    active.status = 'generating'

    return this.executeRound(scope, sessionId, message, active?.latestYaml, onChunk)
  }

  /**
   * 通过 workflow name 查找关联的 Tool LLM session ID
   */
  getSessionIdForWorkflow(scope: string, workflowName: string): string | undefined {
    const record = defStore.getDefByName(workflowName, scope)
    if (!record) return undefined
    return defStore.getDefMeta(workflowName, scope)?.workflowManagementSessionId
  }

  /**
   * 确认注册工作流并绑定 session（双向引用：写入 DefMeta 与 session.bgMeta）
   */
  async confirm(
    scope: string,
    sessionId: string,
    workflowName?: string
  ): Promise<ToolLLMResult & { defId?: string }> {
    const active = this.activeSessions.get(sessionId)
    if (!active || !active.latestYaml || !active.latestDef) {
      throw new Error('No pending workflow definition to confirm')
    }

    const name = workflowName ?? active.workflowName ?? active.latestDef.name
    if (!name) {
      throw new Error('Workflow name is required')
    }

    const record = defStore.registerDef(
      name,
      scope,
      active.latestYaml,
      active.latestDef.description
    )

    active.status = 'confirmed'
    active.workflowName = name

    // 双向引用：先写 session 再写 def，避免 updateSession 失败时 def 已带引用导致单向引用
    if (this.adapter?.getSession && this.adapter?.updateSession) {
      try {
        const existing = await this.adapter.getSession(scope, sessionId)
        if (existing && isWorkflowManagementSession(existing) && existing.toolMeta) {
          await this.adapter.updateSession(scope, sessionId, {
            toolMeta: {
              ...existing.toolMeta,
              workflowDefId: record.id,
              workflowName: name
            }
          })
        } else if (existing?.bgMeta) {
          const existingBg = existing.bgMeta
          await this.adapter.updateSession(scope, sessionId, {
            bgMeta: {
              ...existingBg,
              triggerType:
                (existingBg as { triggerType?: 'api' | 'tool_spawn' | 'cron' | 'event_hook' })
                  .triggerType ?? 'api',
              workflowDefId: record.id,
              workflowName: name
            }
          })
        }
        defStore.updateDefMeta(name, scope, { workflowManagementSessionId: sessionId })
      } catch (err) {
        log.warn('Tool LLM confirm: failed to update session for bidirectional link', err)
      }
    }

    log.info('Tool LLM confirmed workflow:', name, 'session:', sessionId, 'defId:', record.id)

    void emit('workflow:def.registered', { scope, defId: record.id, name: record.name })

    return {
      sessionId,
      defId: record.id,
      workflowDef: active.latestDef,
      yamlContent: active.latestYaml,
      version: active.version,
      status: 'confirmed'
    }
  }

  /**
   * 取消 Tool LLM 会话
   */
  cancel(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    if (active) {
      active.status = 'cancelled'
    }
    this.activeSessions.delete(sessionId)
  }

  /** 获取活跃会话状态 */
  getActiveSession(sessionId: string): ActiveSession | undefined {
    return this.activeSessions.get(sessionId)
  }

  // ── 内部方法 ──

  private buildFirstTurnContent(request: ToolLLMStartRequest): string {
    const parts: string[] = []

    if (request.intent) {
      parts.push(request.intent)
    }

    if (request.context) {
      parts.push(`\n补充上下文：${request.context}`)
    }

    return parts.join('\n') || '请帮我创建一个工作流'
  }

  private async executeRound(
    scope: string,
    sessionId: string,
    content: string,
    workflowEditContext: string | undefined,
    onChunk: ChatCoreChunkHandler
  ): Promise<ToolLLMResult> {
    const active = this.activeSessions.get(sessionId)
    if (!active) {
      throw new Error(`Tool LLM session ${sessionId} not found`)
    }

    const wrappedOnChunk: ChatCoreChunkHandler = (chunk: LLMStreamChunk) => {
      if (
        (chunk.toolCall?.name === WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW ||
          chunk.toolCall?.name === WORKFLOW_MANAGEMENT_TOOL_UPDATE_WORKFLOW) &&
        chunk.toolCall.result
      ) {
        try {
          const result = executeSubmitWorkflow(
            typeof chunk.toolCall.arguments === 'string'
              ? JSON.parse(chunk.toolCall.arguments).workflow_json
              : ((chunk.toolCall.arguments as Record<string, unknown>).workflow_json as string)
          )
          if (result.success && result.workflowDef) {
            active.version++
            active.latestDef = result.workflowDef
            active.latestYaml = result.yamlContent
            active.status = 'preview'
          }
        } catch {
          // Tool call parsing handled by chatCore
        }
      }
      onChunk(chunk)
    }

    try {
      const result = await this.chatService!.execute(
        this.adapter!,
        {
          scope,
          sessionId,
          content,
          workflowEditContext: workflowEditContext ?? undefined,
          skipMemory: true,
          skipCheckpoint: true,
          skipSummary: true,
          skipPerRoundExtract: true,
          skipNarrativeBatchExtract: true,
          skipSlashCommands: true,
          skipChatStatus: true,
          mcpEnabled: true,
          includeScopeContext: false,
          actor: { type: 'system', source: 'tool-llm' }
        },
        wrappedOnChunk
      )

      // 从 assistant 消息中解析 submit 工具调用结果
      for (const part of result.parts) {
        if (
          part.type === 'tool' &&
          (part.name === WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW ||
            part.name === WORKFLOW_MANAGEMENT_TOOL_UPDATE_WORKFLOW) &&
          part.result
        ) {
          const submitResult = executeSubmitWorkflow(
            this.extractWorkflowJson(part.arguments, part.result)
          )
          if (submitResult.success && submitResult.workflowDef) {
            active.version++
            active.latestDef = submitResult.workflowDef
            active.latestYaml = submitResult.yamlContent
            active.status = 'preview'
          } else if (submitResult.error) {
            active.status = 'error'
            return {
              sessionId,
              version: active.version,
              status: 'error',
              validationError: submitResult.error
            }
          }
        }
      }

      return {
        sessionId,
        workflowDef: active.latestDef,
        yamlContent: active.latestYaml,
        version: active.version,
        status: active.status
      }
    } catch (err) {
      active.status = 'error'
      log.error('Tool LLM execution failed:', err)
      throw err
    }
  }

  private extractWorkflowJson(args: unknown, _result: unknown): string {
    if (typeof args === 'string') {
      try {
        const parsed = JSON.parse(args)
        return typeof parsed.workflow_json === 'string' ? parsed.workflow_json : args
      } catch {
        return args
      }
    }
    if (args && typeof args === 'object' && 'workflow_json' in args) {
      return (args as Record<string, unknown>).workflow_json as string
    }
    return JSON.stringify(args)
  }
}

export const toolLLMManager = new ToolLLMManager()
