/**
 * 内置工具：终端 execute/spawn/send_keys 执行逻辑
 */

import path from 'path'
import {
  getTerminalManager,
  stripAnsi,
  type ExecWorkspaceType
} from '../../terminal/TerminalSessionManager'
import { createWorkspaceContext, resolveWorkspaceType } from '../workspaceResolver'
import type { BuiltinToolContext, BuiltinToolResult } from './types'

function toExecWorkspaceType(wsType: string): ExecWorkspaceType {
  if (wsType === 'granted') return 'main'
  if (wsType === 'run') return 'session'
  return wsType as ExecWorkspaceType
}

export async function executeTerminalExecute(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const command = typeof ctx.args.command === 'string' ? ctx.args.command : ''
  if (!command.trim()) return { text: '请提供要执行的命令。', isError: true }
  const cwdArg = typeof ctx.args.cwd === 'string' ? ctx.args.cwd : undefined
  const wsArg = typeof ctx.args.workspace === 'string' ? ctx.args.workspace : undefined
  const timeoutSec = typeof ctx.args.timeout === 'number' ? Math.min(ctx.args.timeout, 300) : 30
  const termMgr = getTerminalManager()
  const wsCtx = createWorkspaceContext(ctx.scopeRoot, ctx.sessionId)
  const { root: wsRoot, wsType } = resolveWorkspaceType(wsCtx, wsArg)
  const resolvedCwd = cwdArg ? path.resolve(wsRoot, cwdArg) : wsRoot
  if (!ctx.sessionId) return { text: '终端工具需要在会话中使用。', isError: true }
  const result = await termMgr.executeCommand({
    agentSessionId: ctx.sessionId,
    scope: ctx.scope,
    command,
    cwd: resolvedCwd,
    timeoutMs: timeoutSec * 1000,
    sessionType: 'exec',
    title: `exec: ${command.slice(0, 40)}`,
    workspaceType: toExecWorkspaceType(wsType)
  })
  const MAX_OUTPUT = 8192
  let output = result.output
  if (output.length > MAX_OUTPUT) {
    const head = output.slice(0, MAX_OUTPUT / 2)
    const tail = output.slice(-MAX_OUTPUT / 2)
    output = head + '\n\n... (输出已截断) ...\n\n' + tail
  }
  const status = result.timedOut
    ? `[超时 ${timeoutSec}s，进程已终止]`
    : `[退出码: ${result.exitCode}]`
  return { text: `${status}\n${output}` }
}

export async function executeTerminalSpawn(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  if (!ctx.sessionId) return { text: '终端工具需要在会话中使用。', isError: true }
  const cwdArg = typeof ctx.args.cwd === 'string' ? ctx.args.cwd : undefined
  const wsArg = typeof ctx.args.workspace === 'string' ? ctx.args.workspace : undefined
  const title = typeof ctx.args.title === 'string' ? ctx.args.title : undefined
  const termMgr = getTerminalManager()
  const wsCtx = createWorkspaceContext(ctx.scopeRoot, ctx.sessionId)
  const { root: wsRoot } = resolveWorkspaceType(wsCtx, wsArg)
  const resolvedCwd = cwdArg ? path.resolve(wsRoot, cwdArg) : wsRoot
  const terminal = termMgr.createTerminal({
    agentSessionId: ctx.sessionId,
    scope: ctx.scope,
    cwd: resolvedCwd,
    title,
    sessionType: 'interactive'
  })
  return {
    text: `已创建终端「${terminal.title}」(ID: ${terminal.id})，用户可在终端面板中查看和交互。`
  }
}

export async function executeTerminalSendKeys(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const terminalId = typeof ctx.args.terminalId === 'string' ? ctx.args.terminalId : ''
  const input = typeof ctx.args.input === 'string' ? ctx.args.input : ''
  const pressEnter = ctx.args.pressEnter !== false
  const waitMs = typeof ctx.args.waitMs === 'number' ? Math.min(ctx.args.waitMs, 10000) : 2000
  if (!terminalId) return { text: '请提供 terminalId。', isError: true }
  const termMgr = getTerminalManager()
  const terminal = termMgr.getTerminal(terminalId)
  if (!terminal) return { text: `终端不存在: ${terminalId}`, isError: true }
  if (terminal.status !== 'running')
    return { text: `终端已退出 (code: ${terminal.exitCode})`, isError: true }
  const prevOutput = termMgr.getRecentOutput(terminalId)
  const prevLen = prevOutput.length
  const dataToSend = pressEnter ? input + '\r' : input
  termMgr.writeToTerminal(terminalId, dataToSend)
  await new Promise((resolve) => setTimeout(resolve, waitMs))
  const currentOutput = termMgr.getRecentOutput(terminalId)
  let newOutput = currentOutput.length > prevLen ? currentOutput.slice(prevLen) : '(无新输出)'
  newOutput = stripAnsi(newOutput)
  if (newOutput.length > 8192) {
    newOutput = newOutput.slice(-8192)
  }
  return { text: newOutput }
}
