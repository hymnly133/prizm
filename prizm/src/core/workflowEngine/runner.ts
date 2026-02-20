/**
 * WorkflowRunner — 核心执行引擎
 *
 * 参考 Lobster runPipelineInternal，实现：
 * - 依次执行 steps（支持从 resume 点继续）
 * - agent step → IStepExecutor
 * - approve step → 暂停 + resumeToken
 * - transform step → 本地 JSON 变换
 * - $stepId.output 变量引用 + 条件求值
 * - 每步完成后执行 linkedActions
 * - 状态持久化到 resumeStore
 */

import fs from 'fs'
import nodePath from 'path'
import { createLogger } from '../../logger'
import { genUniqueId } from '../../id'
import { emit } from '../eventBus/eventBus'
import { scopeStore } from '../ScopeStore'
import {
  ensureWorkflowWorkspace,
  ensureRunWorkspace,
  getWorkflowPersistentWorkspace
} from '../PathProviderCore'
import * as store from './resumeStore'
import * as defStore from './workflowDefStore'
import { executeLinkedActions } from './linkedActionExecutor'
import { writeRunMeta } from './runMetaWriter'
import type { WorkflowDef, WorkflowStepDef, WorkflowStepResult } from '@prizm/shared'
import type { IStepExecutor, WorkflowRunResult, RunWorkflowOptions } from './types'

const log = createLogger('WorkflowRunner')

export class WorkflowRunner {
  private activeAbortControllers = new Map<string, AbortController>()

  constructor(private executor: IStepExecutor) {}

  /**
   * 启动工作流并立即返回 runId（fire-and-forget）。
   * 工作流在后台异步执行，通过 EventBus + WS 推送进度。
   */
  startWorkflow(scope: string, def: WorkflowDef, options?: RunWorkflowOptions): string {
    const scopeRoot = scopeStore.getScopeRootPath(scope)
    const workspaceDir = ensureWorkflowWorkspace(scopeRoot, def.name)

    const shouldClean = options?.cleanBefore ?? def.config?.cleanBefore
    if (shouldClean) {
      this.cleanWorkspaceFreeArea(workspaceDir)
    }

    const run = store.createRun(def.name, scope, {
      args: options?.args,
      triggerType: options?.triggerType,
      linkedScheduleId: options?.linkedScheduleId,
      linkedTodoId: options?.linkedTodoId
    })

    const wsMode = def.config?.workspaceMode ?? 'dual'
    const { persistentDir, runDir } = this.resolveWorkspaceDirs(
      scopeRoot,
      def.name,
      run.id,
      wsMode,
      workspaceDir
    )

    store.updateRunStatus(run.id, 'running')
    void emit('workflow:started', {
      scope,
      runId: run.id,
      workflowName: def.name
    } as never)

    this.executeFromStep(
      scope,
      run.id,
      def,
      0,
      {},
      options?.args,
      workspaceDir,
      persistentDir,
      runDir
    ).catch((err) => {
      log.error(`Background workflow "${def.name}" (run ${run.id}) failed:`, err)
    })

    return run.id
  }

  /**
   * 执行一个完整的工作流（同步等待完成）。
   * 返回 WorkflowRunResult：如遇 approve step 则 status='paused'。
   * 注意：对于长时间运行的工作流优先使用 startWorkflow。
   */
  async runWorkflow(
    scope: string,
    def: WorkflowDef,
    options?: RunWorkflowOptions
  ): Promise<WorkflowRunResult> {
    const scopeRoot = scopeStore.getScopeRootPath(scope)
    const workspaceDir = ensureWorkflowWorkspace(scopeRoot, def.name)

    const shouldClean = options?.cleanBefore ?? def.config?.cleanBefore
    if (shouldClean) {
      this.cleanWorkspaceFreeArea(workspaceDir)
    }

    const run = store.createRun(def.name, scope, {
      args: options?.args,
      triggerType: options?.triggerType,
      linkedScheduleId: options?.linkedScheduleId,
      linkedTodoId: options?.linkedTodoId
    })

    const wsMode = def.config?.workspaceMode ?? 'dual'
    const { persistentDir, runDir } = this.resolveWorkspaceDirs(
      scopeRoot,
      def.name,
      run.id,
      wsMode,
      workspaceDir
    )

    store.updateRunStatus(run.id, 'running')
    void emit('workflow:started', {
      scope,
      runId: run.id,
      workflowName: def.name
    } as never)

    return this.executeFromStep(
      scope,
      run.id,
      def,
      0,
      {},
      options?.args,
      workspaceDir,
      persistentDir,
      runDir
    )
  }

  /**
   * 恢复因 approve step 暂停的工作流。
   */
  async resumeWorkflow(resumeToken: string, approved: boolean): Promise<WorkflowRunResult> {
    const run = store.getRunByResumeToken(resumeToken)
    if (!run) {
      return { runId: '', status: 'failed', error: 'Invalid resume token' }
    }

    if (run.status !== 'paused') {
      return {
        runId: run.id,
        status: 'failed',
        error: `Cannot resume workflow in status: ${run.status}`
      }
    }

    const defRecord = defStore.getDefByName(run.workflowName, run.scope)
    if (!defRecord) {
      return {
        runId: run.id,
        status: 'failed',
        error: `Workflow definition "${run.workflowName}" not found`
      }
    }

    const { parseWorkflowDef } = await import('./parser')
    const def = parseWorkflowDef(defRecord.yamlContent)

    const currentStep = def.steps[run.currentStepIndex]
    if (!currentStep || currentStep.type !== 'approve') {
      return { runId: run.id, status: 'failed', error: 'Current step is not an approve step' }
    }

    const stepResults = { ...run.stepResults }
    stepResults[currentStep.id] = {
      stepId: currentStep.id,
      status: 'completed',
      approved,
      finishedAt: Date.now(),
      durationMs: 0
    }

    store.updateRunStep(run.id, run.currentStepIndex, stepResults, undefined)
    store.updateRunStatus(run.id, 'running')

    void emit('workflow:step.completed', {
      scope: run.scope,
      runId: run.id,
      stepId: currentStep.id,
      stepStatus: 'completed',
      approved
    } as never)

    const scopeRoot = scopeStore.getScopeRootPath(run.scope)
    const workspaceDir = ensureWorkflowWorkspace(scopeRoot, def.name)
    const wsMode = def.config?.workspaceMode ?? 'dual'
    const { persistentDir, runDir } = this.resolveWorkspaceDirs(
      scopeRoot,
      def.name,
      run.id,
      wsMode,
      workspaceDir
    )

    return this.executeFromStep(
      run.scope,
      run.id,
      def,
      run.currentStepIndex + 1,
      stepResults,
      run.args,
      workspaceDir,
      persistentDir,
      runDir
    )
  }

  /**
   * 取消正在运行或暂停的工作流。
   */
  cancelWorkflow(runId: string): boolean {
    const run = store.getRunById(runId)
    if (!run) return false
    if (run.status !== 'running' && run.status !== 'paused' && run.status !== 'pending') {
      return false
    }
    store.updateRunStatus(runId, 'cancelled')

    const ac = this.activeAbortControllers.get(runId)
    if (ac) {
      ac.abort()
      this.activeAbortControllers.delete(runId)
    }

    void emit('workflow:failed', {
      scope: run.scope,
      runId,
      workflowName: run.workflowName,
      error: 'Cancelled by user'
    } as never)
    return true
  }

  // ─── 内部执行逻辑 ───

  private async executeFromStep(
    scope: string,
    runId: string,
    def: WorkflowDef,
    startIndex: number,
    stepResults: Record<string, WorkflowStepResult>,
    args?: Record<string, unknown>,
    workspaceDir?: string,
    persistentWorkspaceDir?: string,
    runWorkspaceDir?: string
  ): Promise<WorkflowRunResult> {
    const results = { ...stepResults }
    const scopeRoot = scopeStore.getScopeRootPath(scope)
    const errorStrategy = def.config?.errorStrategy ?? 'fail_fast'
    const totalDeadline = def.config?.maxTotalTimeoutMs
      ? Date.now() + def.config.maxTotalTimeoutMs
      : undefined

    const abortController = new AbortController()
    this.activeAbortControllers.set(runId, abortController)

    try {
      for (let i = startIndex; i < def.steps.length; i++) {
        const step = def.steps[i]

        const currentRun = store.getRunById(runId)
        if (currentRun?.status === 'cancelled' || abortController.signal.aborted) {
          return this.finalize(scope, runId, def, results, args, scopeRoot, 'cancelled')
        }

        if (totalDeadline && Date.now() > totalDeadline) {
          const err = `Workflow total timeout exceeded (${def.config!.maxTotalTimeoutMs}ms)`
          store.updateRunStatus(runId, 'failed', err)
          this.flushRunMeta(scopeRoot, def.name, runId, scope, results, args, 'failed')
          void emit('workflow:failed', {
            scope,
            runId,
            workflowName: def.name,
            error: err
          } as never)
          this.emitNotification(scope, def, 'fail', err)
          return { runId, status: 'failed', error: err }
        }

        if (step.condition && !this.evaluateCondition(step.condition, results)) {
          results[step.id] = {
            stepId: step.id,
            type: step.type,
            status: 'skipped',
            startedAt: Date.now(),
            finishedAt: Date.now(),
            durationMs: 0
          }
          store.updateRunStep(runId, i, results)
          this.flushRunMeta(scopeRoot, def.name, runId, scope, results, args, 'running')
          void emit('workflow:step.completed', {
            scope,
            runId,
            stepId: step.id,
            stepStatus: 'skipped'
          } as never)
          continue
        }

        results[step.id] = {
          stepId: step.id,
          type: step.type,
          status: 'running',
          startedAt: Date.now()
        }
        store.updateRunStep(runId, i, results)

        try {
          const result = await this.executeStepWithRetry(
            scope,
            step,
            i,
            def,
            results,
            args,
            workspaceDir,
            runId,
            abortController.signal,
            persistentWorkspaceDir,
            runWorkspaceDir
          )

          if (abortController.signal.aborted) {
            return this.finalize(scope, runId, def, results, args, scopeRoot, 'cancelled')
          }

          if (result.status === 'paused') {
            const resumeToken = genUniqueId()
            results[step.id] = {
              stepId: step.id,
              type: step.type,
              status: 'paused',
              startedAt: results[step.id].startedAt
            }
            store.updateRunStep(runId, i, results, resumeToken)
            store.updateRunStatus(runId, 'paused')
            this.flushRunMeta(scopeRoot, def.name, runId, scope, results, args, 'paused')

            void emit('workflow:paused', {
              scope,
              runId,
              workflowName: def.name,
              stepId: step.id,
              approvePrompt: step.approvePrompt || '请审批此步骤'
            } as never)

            return {
              runId,
              status: 'paused',
              resumeToken,
              approvePrompt: step.approvePrompt || '请审批此步骤'
            }
          }

          const bgData = result.sessionId
            ? this.extractBgSessionData(scope, result.sessionId)
            : undefined

          const stepFailed = !!result.error
          results[step.id] = {
            stepId: step.id,
            type: step.type,
            status: stepFailed ? 'failed' : 'completed',
            output: result.output,
            structuredData: bgData?.structuredData,
            artifacts: bgData?.artifacts,
            sessionId: result.sessionId,
            approved: result.approved,
            startedAt: results[step.id].startedAt,
            finishedAt: Date.now(),
            durationMs: Date.now() - (results[step.id].startedAt ?? Date.now()),
            error: result.error
          }
          store.updateRunStep(runId, i, results)
          this.flushRunMeta(
            scopeRoot,
            def.name,
            runId,
            scope,
            results,
            args,
            stepFailed ? 'failed' : 'running'
          )

          void emit('workflow:step.completed', {
            scope,
            runId,
            stepId: step.id,
            stepStatus: stepFailed ? 'failed' : 'completed',
            outputPreview: (result.output ?? '').slice(0, 200)
          } as never)

          if (stepFailed) {
            if (errorStrategy === 'continue') {
              log.warn(
                `Step "${step.id}" failed but errorStrategy=continue, skipping: ${result.error}`
              )
            } else {
              store.updateRunStatus(runId, 'failed', result.error)
              this.flushRunMeta(scopeRoot, def.name, runId, scope, results, args, 'failed')
              void emit('workflow:failed', {
                scope,
                runId,
                workflowName: def.name,
                error: result.error
              } as never)
              this.emitNotification(scope, def, 'fail', result.error)
              return { runId, status: 'failed', error: result.error }
            }
          }

          if (step.linkedActions?.length) {
            await executeLinkedActions(scope, step.linkedActions, results, args)
          }
        } catch (err) {
          if (abortController.signal.aborted) {
            return this.finalize(scope, runId, def, results, args, scopeRoot, 'cancelled')
          }

          const errMsg = err instanceof Error ? err.message : String(err)
          results[step.id] = {
            stepId: step.id,
            type: step.type,
            status: 'failed',
            error: errMsg,
            startedAt: results[step.id].startedAt,
            finishedAt: Date.now(),
            durationMs: Date.now() - (results[step.id].startedAt ?? Date.now())
          }
          store.updateRunStep(runId, i, results)

          if (errorStrategy === 'continue') {
            log.warn(`Step "${step.id}" threw but errorStrategy=continue, skipping: ${errMsg}`)
            this.flushRunMeta(scopeRoot, def.name, runId, scope, results, args, 'running')
            continue
          }

          store.updateRunStatus(runId, 'failed', errMsg)
          this.flushRunMeta(scopeRoot, def.name, runId, scope, results, args, 'failed')
          void emit('workflow:failed', {
            scope,
            runId,
            workflowName: def.name,
            error: errMsg
          } as never)
          this.emitNotification(scope, def, 'fail', errMsg)
          log.error(`Workflow step "${step.id}" failed:`, err)
          return { runId, status: 'failed', error: errMsg }
        }
      }

      return this.finalize(scope, runId, def, results, args, scopeRoot, 'completed')
    } finally {
      this.activeAbortControllers.delete(runId)
    }
  }

  private finalize(
    scope: string,
    runId: string,
    def: WorkflowDef,
    results: Record<string, WorkflowStepResult>,
    args: Record<string, unknown> | undefined,
    scopeRoot: string,
    status: 'completed' | 'cancelled'
  ): WorkflowRunResult {
    const lastStep = def.steps[def.steps.length - 1]
    const finalOutput = lastStep ? results[lastStep.id]?.output : undefined

    store.updateRunStatus(runId, status)
    this.flushRunMeta(scopeRoot, def.name, runId, scope, results, args, status)

    if (status === 'completed') {
      void emit('workflow:completed', {
        scope,
        runId,
        workflowName: def.name,
        finalOutput: (finalOutput ?? '').slice(0, 500)
      } as never)
      this.emitNotification(scope, def, 'complete')
    }

    return { runId, status, finalOutput }
  }

  /** 带重试的步骤执行 */
  private async executeStepWithRetry(
    scope: string,
    step: WorkflowStepDef,
    stepIndex: number,
    def: WorkflowDef,
    results: Record<string, WorkflowStepResult>,
    args?: Record<string, unknown>,
    workspaceDir?: string,
    runId?: string,
    signal?: AbortSignal,
    persistentWorkspaceDir?: string,
    runWorkspaceDir?: string
  ): Promise<StepExecResult> {
    const rc = step.retryConfig
    const maxRetries = rc?.maxRetries ?? 0
    const retryOn = rc?.retryOn ?? ['failed', 'timeout']
    const delayMs = rc?.retryDelayMs ?? 0

    let lastResult = await this.executeStep(
      scope,
      step,
      stepIndex,
      def,
      results,
      args,
      workspaceDir,
      runId,
      signal,
      persistentWorkspaceDir,
      runWorkspaceDir
    )

    for (let attempt = 0; attempt < maxRetries && lastResult.status === 'error'; attempt++) {
      if (signal?.aborted) break

      const isRetryable = retryOn.some(
        (cond: string) =>
          (cond === 'failed' && lastResult.error && !lastResult.error.includes('timeout')) ||
          (cond === 'timeout' && lastResult.error?.includes('timeout'))
      )
      if (!isRetryable) break

      log.info(`Retrying step "${step.id}" (attempt ${attempt + 1}/${maxRetries})`)
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
      lastResult = await this.executeStep(
        scope,
        step,
        stepIndex,
        def,
        results,
        args,
        workspaceDir,
        runId,
        signal,
        persistentWorkspaceDir,
        runWorkspaceDir
      )
    }

    return lastResult
  }

  /**
   * 发送工作流完成/失败通知。
   * 通过已有的 workflow:completed / workflow:failed 事件广播到客户端。
   * 客户端根据 config.notifyOnComplete / notifyOnFail 决定是否展示系统通知。
   */
  private emitNotification(
    scope: string,
    def: WorkflowDef,
    type: 'complete' | 'fail',
    error?: string
  ): void {
    const shouldNotify =
      type === 'complete' ? def.config?.notifyOnComplete : def.config?.notifyOnFail
    if (!shouldNotify) return
    log.info(`Workflow "${def.name}" ${type} notification: ${type === 'fail' ? error : 'success'}`)
  }

  private async executeStep(
    scope: string,
    step: WorkflowStepDef,
    stepIndex: number,
    def: WorkflowDef,
    results: Record<string, WorkflowStepResult>,
    args?: Record<string, unknown>,
    workspaceDir?: string,
    runId?: string,
    signal?: AbortSignal,
    persistentWorkspaceDir?: string,
    runWorkspaceDir?: string
  ): Promise<StepExecResult> {
    switch (step.type) {
      case 'agent':
        return this.executeAgentStep(
          scope,
          step,
          stepIndex,
          def,
          results,
          args,
          workspaceDir,
          runId,
          signal,
          persistentWorkspaceDir,
          runWorkspaceDir
        )
      case 'approve':
        return { status: 'paused' }
      case 'transform':
        return this.executeTransformStep(step, results, args)
      default:
        return { status: 'error', error: `Unknown step type: ${step.type}` }
    }
  }

  private async executeAgentStep(
    scope: string,
    step: WorkflowStepDef,
    stepIndex: number,
    def: WorkflowDef,
    results: Record<string, WorkflowStepResult>,
    args?: Record<string, unknown>,
    workspaceDir?: string,
    runId?: string,
    signal?: AbortSignal,
    persistentWorkspaceDir?: string,
    runWorkspaceDir?: string
  ): Promise<StepExecResult> {
    // 解析输入：显式 input > 隐式 $prev.output（非首步自动管道传递）
    const { inputContext, inputLabel } = this.resolveStepInput(step, stepIndex, results, args)

    const prompt = step.prompt ?? ''
    const fullPrompt = inputContext ? `${prompt}\n\n--- ${inputLabel} ---\n${inputContext}` : prompt

    const effectiveRunDir = runWorkspaceDir ?? workspaceDir
    const isLastStep = stepIndex === def.steps.length - 1
    const systemLines = [
      `你正在执行工作流 "${def.name}" 的步骤 ${stepIndex + 1}/${def.steps.length}（步骤 ID: ${
        step.id
      }）。`,
      step.description ? `步骤描述: ${step.description}` : '',
      def.description ? `工作流描述: ${def.description}` : '',
      persistentWorkspaceDir
        ? `[持久工作空间] ${persistentWorkspaceDir} — 存放跨运行共享数据（经验、参考资料等长期数据）`
        : '',
      effectiveRunDir
        ? `[本次运行工作空间] ${effectiveRunDir} — 本次 run 独占，步骤间共享临时数据`
        : '',
      persistentWorkspaceDir || effectiveRunDir
        ? '使用 prizm_file 工具可读写以上工作空间中的文件。'
        : '',
      isLastStep
        ? '请完成任务后调用 prizm_set_result 提交最终结果。'
        : '请完成任务后调用 prizm_set_result 提交结果，你的输出将自动传递给下一步骤作为输入。'
    ]
      .filter(Boolean)
      .join('\n')

    const sc = step.sessionConfig
    const isFirstStep = stepIndex === 0

    // 第一步注入工作流 args 作为 inputParams
    const inputParams =
      isFirstStep && def.args && args
        ? {
            schema: Object.fromEntries(
              Object.entries(def.args).map(([k, v]) => [
                k,
                { type: 'string', description: v.description }
              ])
            ),
            values: args
          }
        : undefined

    // 最后一步注入工作流 outputs 作为 outputParams
    const outputParams =
      isLastStep && def.outputs
        ? {
            schema: def.outputs,
            required: Object.keys(def.outputs)
          }
        : undefined

    const output = await this.executor.execute(
      scope,
      {
        prompt: fullPrompt,
        systemInstructions: systemLines,
        expectedOutputFormat: sc?.expectedOutputFormat ?? 'JSON 或纯文本',
        model: sc?.model ?? step.model,
        timeoutMs: step.timeoutMs,
        label: `workflow:${step.id}`,
        workspaceDir: effectiveRunDir ?? workspaceDir,
        persistentWorkspaceDir,
        runWorkspaceDir: effectiveRunDir,
        source: 'workflow',
        sourceId: runId,
        sessionConfig: sc,
        inputParams,
        outputParams
      },
      signal
    )

    if (
      output.status === 'failed' ||
      output.status === 'timeout' ||
      output.status === 'cancelled'
    ) {
      return {
        status: 'error',
        error: `Agent step ${output.status}: ${output.output}`,
        sessionId: output.sessionId
      }
    }

    return { status: 'ok', output: output.output, sessionId: output.sessionId }
  }

  private executeTransformStep(
    step: WorkflowStepDef,
    results: Record<string, WorkflowStepResult>,
    args?: Record<string, unknown>
  ): StepExecResult {
    try {
      const inputStr = step.input ? this.resolveReference(step.input, results, args) : '{}'

      let input: unknown
      try {
        input = JSON.parse(inputStr)
      } catch {
        input = inputStr
      }

      const expr = step.transform ?? ''
      const output = this.evaluateTransform(expr, input, results, args)
      return { status: 'ok', output: typeof output === 'string' ? output : JSON.stringify(output) }
    } catch (err) {
      return {
        status: 'error',
        error: `Transform failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  /**
   * 解析步骤输入：显式 input 引用 > 非首步自动继承上一步输出。
   * 返回解析后的输入内容及描述标签。
   */
  private resolveStepInput(
    step: WorkflowStepDef,
    stepIndex: number,
    results: Record<string, WorkflowStepResult>,
    args?: Record<string, unknown>
  ): { inputContext: string | undefined; inputLabel: string } {
    if (step.input) {
      const resolved = this.resolveReference(step.input, results, args)
      const label = this.buildInputLabel(step.input, results)
      return { inputContext: resolved || undefined, inputLabel: label }
    }

    // 非首步且无显式 input：自动注入上一步输出（隐式管道）
    if (stepIndex > 0) {
      const completedIds = Object.keys(results).filter((k) => results[k].status === 'completed')
      const prevId = completedIds[completedIds.length - 1]
      if (prevId && results[prevId].output) {
        return {
          inputContext: results[prevId].output,
          inputLabel: `上一步 "${prevId}" 的输出`
        }
      }
    }

    return { inputContext: undefined, inputLabel: '上一步输出' }
  }

  /**
   * 根据 input 引用表达式生成可读的输入来源标签。
   * 例如 "$create_doc.output" → '步骤 "create_doc" 的输出'
   */
  private buildInputLabel(inputRef: string, results: Record<string, WorkflowStepResult>): string {
    const match = inputRef.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)\.output$/)
    if (match) {
      const stepId = match[1]
      if (stepId === 'prev') {
        const completedIds = Object.keys(results).filter((k) => results[k].status === 'completed')
        const prevId = completedIds[completedIds.length - 1]
        return prevId ? `上一步 "${prevId}" 的输出` : '上一步输出'
      }
      return `步骤 "${stepId}" 的输出`
    }
    return '输入数据'
  }

  /**
   * 解析 $stepId.output / $stepId.data.xxx / $prev.output / $args.key 引用。
   */
  private resolveReference(
    ref: string,
    results: Record<string, WorkflowStepResult>,
    args?: Record<string, unknown>
  ): string {
    return ref.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)\.(\w+(?:\.\w+)*)/g, (_m, id, propPath) => {
      if (id === 'args' && args) {
        const keys = propPath.split('.')
        let current: unknown = args
        for (const key of keys) {
          if (
            current &&
            typeof current === 'object' &&
            key in (current as Record<string, unknown>)
          ) {
            current = (current as Record<string, unknown>)[key]
          } else {
            return ''
          }
        }
        return typeof current === 'string'
          ? current
          : current != null
          ? JSON.stringify(current)
          : ''
      }
      if (id === 'prev') {
        const keys = Object.keys(results)
        const lastCompleted = keys.filter((k) => results[k].status === 'completed').pop()
        if (lastCompleted) {
          return this.extractProp(results[lastCompleted], propPath)
        }
        return ''
      }
      const result = results[id]
      if (!result) return ''
      return this.extractProp(result, propPath)
    })
  }

  /** 从 StepResult 中提取属性，支持 output / approved / sessionId / data.xxx 深层引用 */
  private extractProp(result: WorkflowStepResult, propPath: string): string {
    if (propPath === 'output') return result.output ?? ''
    if (propPath === 'approved') return String(result.approved ?? '')
    if (propPath === 'sessionId') return result.sessionId ?? ''

    if (propPath.startsWith('data.') && result.structuredData) {
      try {
        const parsed = JSON.parse(result.structuredData)
        const keys = propPath.slice(5).split('.')
        let current: unknown = parsed
        for (const key of keys) {
          if (
            current &&
            typeof current === 'object' &&
            key in (current as Record<string, unknown>)
          ) {
            current = (current as Record<string, unknown>)[key]
          } else {
            return ''
          }
        }
        return typeof current === 'string' ? current : JSON.stringify(current)
      } catch {
        return ''
      }
    }

    return ''
  }

  /**
   * 条件表达式求值。
   * 支持：$stepId.approved, $stepId.output (truthy check)
   */
  private evaluateCondition(
    condition: string,
    results: Record<string, WorkflowStepResult>
  ): boolean {
    const resolved = condition.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)\.(\w+)/g, (_m, id, prop) => {
      const result = results[id]
      if (!result) return 'false'
      if (prop === 'approved') return String(result.approved ?? false)
      if (prop === 'output') return result.output ? 'true' : 'false'
      return 'false'
    })

    try {
      return resolved === 'true' || resolved === 'false' ? resolved === 'true' : !!resolved
    } catch {
      return false
    }
  }

  /**
   * 简单的 JSON 变换。
   * 支持 dot-path 提取，如 "output.summary" 从 input 中提取 summary 字段。
   */
  private evaluateTransform(
    expr: string,
    input: unknown,
    _results: Record<string, WorkflowStepResult>,
    _args?: Record<string, unknown>
  ): unknown {
    if (!expr) return input

    const parts = expr.split('.')
    let current: unknown = input
    for (const part of parts) {
      if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[part]
      } else {
        return null
      }
    }
    return current
  }

  /** 将当前运行状态写入 .meta/runs/{runId}.md */
  private flushRunMeta(
    scopeRoot: string,
    workflowName: string,
    runId: string,
    scope: string,
    stepResults: Record<string, WorkflowStepResult>,
    args?: Record<string, unknown>,
    status?: string
  ): void {
    const run = store.getRunById(runId)
    writeRunMeta(scopeRoot, {
      runId,
      workflowName,
      scope,
      status: status ?? run?.status ?? 'running',
      triggerType: run?.triggerType,
      args,
      startedAt: run?.createdAt,
      finishedAt: status === 'completed' || status === 'failed' ? Date.now() : undefined,
      stepResults
    })
  }

  /** 从 BG Session 中提取 bgStructuredData 和 bgArtifacts */
  private extractBgSessionData(
    scope: string,
    sessionId: string
  ): { structuredData?: string; artifacts?: string[] } | undefined {
    try {
      const data = scopeStore.getScopeData(scope)
      const session = data.agentSessions.find((s) => s.id === sessionId)
      if (!session) return undefined
      return {
        structuredData: session.bgStructuredData,
        artifacts: session.bgArtifacts
      }
    } catch {
      return undefined
    }
  }

  /** 根据 workspaceMode 解析双层工作空间路径，确保所有目录都已创建 */
  private resolveWorkspaceDirs(
    scopeRoot: string,
    workflowName: string,
    runId: string,
    mode: 'dual' | 'shared' | 'isolated',
    legacyWorkspaceDir: string
  ): { persistentDir: string; runDir: string } {
    if (mode === 'shared') {
      if (!fs.existsSync(legacyWorkspaceDir)) {
        fs.mkdirSync(legacyWorkspaceDir, { recursive: true })
      }
      return { persistentDir: legacyWorkspaceDir, runDir: legacyWorkspaceDir }
    }
    const { persistentDir, runDir } = ensureRunWorkspace(scopeRoot, workflowName, runId)
    if (mode === 'isolated') {
      return { persistentDir: runDir, runDir }
    }
    return { persistentDir, runDir }
  }

  /** 清空 workflow 工作区的自由区域（保留 .meta/） */
  private cleanWorkspaceFreeArea(workspaceDir: string): void {
    try {
      const entries = fs.readdirSync(workspaceDir)
      for (const entry of entries) {
        if (entry === '.meta') continue
        const fullPath = nodePath.join(workspaceDir, entry)
        const stat = fs.statSync(fullPath)
        fs.rmSync(fullPath, { recursive: stat.isDirectory(), force: true })
      }
    } catch (err) {
      log.warn('Failed to clean workflow workspace:', err)
    }
  }
}

interface StepExecResult {
  status: 'ok' | 'paused' | 'error'
  output?: string
  sessionId?: string
  approved?: boolean
  error?: string
}

// ─── 单例实例（server.ts 注入 executor 后使用） ───

let _runner: WorkflowRunner | null = null

export function initWorkflowRunner(executor: IStepExecutor): WorkflowRunner {
  _runner = new WorkflowRunner(executor)
  log.info('WorkflowRunner initialized')
  return _runner
}

export function getWorkflowRunner(): WorkflowRunner {
  if (!_runner) throw new Error('WorkflowRunner not initialized')
  return _runner
}
