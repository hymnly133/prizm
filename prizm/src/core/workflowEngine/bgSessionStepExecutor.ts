/**
 * BgSessionStepExecutor — IStepExecutor 的 BG Session 实现
 *
 * 将 BackgroundSessionManager.triggerSync() 包装为 IStepExecutor 接口。
 * 当 BG Session 的触发 API 变更时，仅需修改此文件。
 */

import type { BgSessionMeta, SessionIOConfig, WorkflowStepSessionConfig } from '@prizm/shared'
import type { BackgroundSessionManager } from '../backgroundSession/manager'
import type { BgTriggerPayload } from '../backgroundSession/types'
import type { IStepExecutor, StepExecutionInput, StepExecutionOutput } from './types'

export class BgSessionStepExecutor implements IStepExecutor {
  constructor(private bgManager: BackgroundSessionManager) {}

  async execute(scope: string, input: StepExecutionInput, signal?: AbortSignal): Promise<StepExecutionOutput> {
    const sc = input.sessionConfig
    const payload = this.buildPayload(input, sc)
    const meta = this.buildMeta(input, sc)

    const result = await this.bgManager.triggerSync(scope, payload, meta, { signal })

    return {
      sessionId: result.sessionId,
      status: result.status,
      output: result.output,
      structuredData: result.structuredData,
      artifacts: result.artifacts,
      durationMs: result.durationMs
    }
  }

  private buildPayload(input: StepExecutionInput, sc?: WorkflowStepSessionConfig): BgTriggerPayload {
    let systemInstructions = input.systemInstructions ?? ''

    if (sc?.skills?.length) {
      const skillLines = sc.skills.map((s) => `[Skill: ${s}]`).join('\n')
      systemInstructions += `\n\n--- 激活的技能 ---\n${skillLines}`
    }
    if (sc?.systemPrompt) {
      systemInstructions += `\n\n--- 自定义系统指令 ---\n${sc.systemPrompt}`
    }

    return {
      prompt: input.prompt,
      context: input.context,
      systemInstructions: systemInstructions || undefined,
      expectedOutputFormat: sc?.expectedOutputFormat ?? input.expectedOutputFormat,
      outputSchema: sc?.outputSchema,
      maxSchemaRetries: sc?.maxSchemaRetries,
      inputParams: input.inputParams
    }
  }

  private buildMeta(input: StepExecutionInput, sc?: WorkflowStepSessionConfig): Partial<BgSessionMeta> {
    const meta: Partial<BgSessionMeta> = {
      triggerType: 'event_hook',
      label: input.label ?? 'workflow-step',
      model: sc?.thinking ? undefined : input.model,
      timeoutMs: input.timeoutMs,
      autoCleanup: true,
      workspaceDir: input.workspaceDir,
      source: input.source,
      sourceId: input.sourceId
    }

    if (sc) {
      const hasAgentDef = sc.allowedTools || sc.maxTurns || sc.permissionMode || sc.systemPrompt || sc.model
      if (hasAgentDef) {
        meta.inlineAgentDef = {
          ...(sc.systemPrompt ? { systemPrompt: sc.systemPrompt } : {}),
          ...(sc.allowedTools ? { allowedTools: sc.allowedTools } : {}),
          ...(sc.model ? { model: sc.model } : {}),
          ...(sc.maxTurns != null ? { maxTurns: sc.maxTurns } : {}),
          ...(sc.permissionMode ? { permissionMode: sc.permissionMode } : {})
        }
      }

      if (sc.model) meta.model = sc.model
      if (sc.memoryPolicy) meta.memoryPolicy = sc.memoryPolicy
      if (sc.memoryInjectPolicy) meta.memoryInjectPolicy = sc.memoryInjectPolicy
      if (sc.toolGroups) meta.toolGroups = sc.toolGroups
    }

    // 构建 ioConfig — 将 inputParams 和 outputParams 传递到 BG Session
    const ioConfig: SessionIOConfig = {}
    if (input.inputParams) ioConfig.inputParams = input.inputParams
    if (input.outputParams) ioConfig.outputParams = input.outputParams
    if (ioConfig.inputParams || ioConfig.outputParams) {
      meta.ioConfig = ioConfig
    }

    return meta
  }
}
