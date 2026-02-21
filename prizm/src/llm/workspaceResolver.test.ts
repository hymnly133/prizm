/**
 * workspaceResolver.test.ts — 工作区路径解析
 *
 * 覆盖：
 * - createWorkspaceContext 各参数组合
 * - resolvePath 绝对路径匹配（run > workflow > session > main > granted）
 * - resolvePath 相对路径 + wsArg 组合（run / workflow / session / 默认）
 * - resolvePath 越界路径 → null
 * - resolvePath 默认 run 优先
 * - resolveFolder 绝对 / 相对 / 空字符串
 * - resolveWorkspaceType 各 wsArg 场景
 * - wsTypeLabel 返回正确标签
 * - OUT_OF_BOUNDS_MSG 存在
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'

vi.mock('../core/mdStore', () => ({
  ensureSessionWorkspace: vi.fn(),
  validateRelativePath: vi.fn((p: string) => {
    return !p.includes('..') && !path.isAbsolute(p)
  })
}))

import {
  createWorkspaceContext,
  resolvePath,
  resolveFolder,
  resolveWorkspaceType,
  wsTypeLabel,
  OUT_OF_BOUNDS_MSG,
  OUT_OF_BOUNDS_ERROR_CODE
} from './workspaceResolver'
import type { WorkspaceContext } from './workspaceResolver'
import * as mdStore from '../core/mdStore'

const SCOPE_ROOT = path.resolve('/project/myapp')
const SESSION_WS = path.resolve('/project/myapp/.prizm/agent-sessions/sess-1/workspace')
const RUN_WS = path.resolve('/project/myapp/.prizm/workflows/daily-report/run-workspaces/run-1')
const WORKFLOW_WS = path.resolve('/project/myapp/.prizm/workflows/daily-report/workspace')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createWorkspaceContext', () => {
  it('最小参数：仅 scopeRoot', () => {
    const ctx = createWorkspaceContext(SCOPE_ROOT)
    expect(ctx.scopeRoot).toBe(SCOPE_ROOT)
    expect(ctx.sessionWorkspaceRoot).toBeNull()
    expect(ctx.runWorkspaceRoot).toBeNull()
    expect(ctx.workflowWorkspaceRoot).toBeNull()
    expect(ctx.sessionId).toBeNull()
  })

  it('带 sessionId', () => {
    const ctx = createWorkspaceContext(SCOPE_ROOT, 'sess-1')
    expect(ctx.sessionId).toBe('sess-1')
    expect(ctx.sessionWorkspaceRoot).toBeTruthy()
  })

  it('带 runWorkspaceDir', () => {
    const ctx = createWorkspaceContext(SCOPE_ROOT, 'sess-1', RUN_WS)
    expect(ctx.runWorkspaceRoot).toBe(RUN_WS)
  })

  it('无 sessionId 但有 runWorkspaceDir', () => {
    const ctx = createWorkspaceContext(SCOPE_ROOT, undefined, RUN_WS)
    expect(ctx.sessionId).toBeNull()
    expect(ctx.sessionWorkspaceRoot).toBeNull()
    expect(ctx.runWorkspaceRoot).toBe(RUN_WS)
  })

  it('带 workflowWorkspaceDir', () => {
    const ctx = createWorkspaceContext(SCOPE_ROOT, 'sess-1', RUN_WS, WORKFLOW_WS)
    expect(ctx.workflowWorkspaceRoot).toBe(WORKFLOW_WS)
    expect(ctx.runWorkspaceRoot).toBe(RUN_WS)
  })
})

describe('resolvePath — 绝对路径', () => {
  function makeCtx(): WorkspaceContext {
    return {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: SESSION_WS,
      runWorkspaceRoot: RUN_WS,
      workflowWorkspaceRoot: WORKFLOW_WS,
      sessionId: 'sess-1'
    }
  }

  it('运行工作区内绝对路径 → run', () => {
    const ctx = makeCtx()
    const filePath = path.join(RUN_WS, 'data', 'output.csv')
    const result = resolvePath(ctx, filePath)

    expect(result).not.toBeNull()
    expect(result!.wsType).toBe('run')
    expect(result!.fileRoot).toBe(RUN_WS)
    expect(result!.relativePath).toBe(path.join('data', 'output.csv'))
  })

  it('运行工作区根路径本身 → run', () => {
    const ctx = makeCtx()
    const result = resolvePath(ctx, RUN_WS)

    expect(result).not.toBeNull()
    expect(result!.wsType).toBe('run')
    expect(result!.relativePath).toBe('')
  })

  it('工作流工作区内绝对路径 → workflow', () => {
    const ctx = makeCtx()
    const filePath = path.join(WORKFLOW_WS, 'notes', 'requirements.md')
    const result = resolvePath(ctx, filePath)

    expect(result).not.toBeNull()
    expect(result!.wsType).toBe('workflow')
    expect(result!.fileRoot).toBe(WORKFLOW_WS)
    expect(result!.relativePath).toBe(path.join('notes', 'requirements.md'))
  })

  it('session 工作区内绝对路径 → session', () => {
    const ctx = makeCtx()
    const filePath = path.join(SESSION_WS, 'temp.txt')
    const result = resolvePath(ctx, filePath)

    expect(result).not.toBeNull()
    expect(result!.wsType).toBe('session')
    expect(result!.relativePath).toBe('temp.txt')
    expect(mdStore.ensureSessionWorkspace).toHaveBeenCalled()
  })

  it('主工作区内绝对路径 → main', () => {
    const ctx = makeCtx()
    const filePath = path.join(SCOPE_ROOT, 'src', 'index.ts')
    const result = resolvePath(ctx, filePath)

    expect(result).not.toBeNull()
    expect(result!.wsType).toBe('main')
    expect(result!.relativePath).toBe(path.join('src', 'index.ts'))
  })

  it('run 优先于 main（run 在 main 内部时）', () => {
    const ctx = makeCtx()
    const filePath = path.join(RUN_WS, 'report.md')
    const result = resolvePath(ctx, filePath)

    expect(result!.wsType).toBe('run')
  })

  it('授权路径内 → granted', () => {
    const ctx = makeCtx()
    const granted = [path.resolve('/external/data')]
    const filePath = path.join(path.resolve('/external/data'), 'file.txt')
    const result = resolvePath(ctx, filePath, undefined, granted)

    expect(result).not.toBeNull()
    expect(result!.wsType).toBe('granted')
  })

  it('所有工作区外的绝对路径 → null', () => {
    const ctx = makeCtx()
    const result = resolvePath(ctx, path.resolve('/completely/outside'))
    expect(result).toBeNull()
  })

  it('无运行工作区时不匹配 run', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: SESSION_WS,
      runWorkspaceRoot: null,
      workflowWorkspaceRoot: null,
      sessionId: 'sess-1'
    }
    const filePath = path.join(SCOPE_ROOT, '.prizm', 'workflows', 'daily-report', 'data.csv')
    const result = resolvePath(ctx, filePath)

    expect(result).not.toBeNull()
    expect(result!.wsType).toBe('main')
  })
})

describe('resolvePath — 相对路径', () => {
  it('wsArg=workflow → 工作流工作区', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: SESSION_WS,
      runWorkspaceRoot: RUN_WS,
      workflowWorkspaceRoot: WORKFLOW_WS,
      sessionId: 'sess-1'
    }
    const result = resolvePath(ctx, 'notes/req.md', 'workflow')

    expect(result).not.toBeNull()
    expect(result!.wsType).toBe('workflow')
    expect(result!.fileRoot).toBe(WORKFLOW_WS)
    expect(result!.relativePath).toBe('notes/req.md')
  })

  it('wsArg=workflow 但无 workflowWorkspaceRoot → 回退 run 或 main', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: null,
      runWorkspaceRoot: null,
      workflowWorkspaceRoot: null,
      sessionId: null
    }
    const result = resolvePath(ctx, 'data.csv', 'workflow')
    expect(result!.wsType).toBe('main')
  })

  it('wsArg=run → 运行工作区', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: SESSION_WS,
      runWorkspaceRoot: RUN_WS,
      workflowWorkspaceRoot: WORKFLOW_WS,
      sessionId: 'sess-1'
    }
    const result = resolvePath(ctx, 'data/output.csv', 'run')

    expect(result).not.toBeNull()
    expect(result!.wsType).toBe('run')
    expect(result!.fileRoot).toBe(RUN_WS)
    expect(result!.relativePath).toBe('data/output.csv')
  })

  it('wsArg=session → session 工作区', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: SESSION_WS,
      runWorkspaceRoot: RUN_WS,
      workflowWorkspaceRoot: WORKFLOW_WS,
      sessionId: 'sess-1'
    }
    const result = resolvePath(ctx, 'temp.txt', 'session')

    expect(result).not.toBeNull()
    expect(result!.wsType).toBe('session')
    expect(mdStore.ensureSessionWorkspace).toHaveBeenCalled()
  })

  it('无 wsArg + 有运行工作区 → 默认 run', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: SESSION_WS,
      runWorkspaceRoot: RUN_WS,
      workflowWorkspaceRoot: WORKFLOW_WS,
      sessionId: 'sess-1'
    }
    const result = resolvePath(ctx, 'report.md')

    expect(result!.wsType).toBe('run')
  })

  it('无 wsArg + 无运行工作区 → 默认 main', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: SESSION_WS,
      runWorkspaceRoot: null,
      workflowWorkspaceRoot: null,
      sessionId: 'sess-1'
    }
    const result = resolvePath(ctx, 'src/file.ts')

    expect(result!.wsType).toBe('main')
    expect(result!.fileRoot).toBe(SCOPE_ROOT)
  })

  it('wsArg=run 但无 runWorkspaceRoot → 回退 main', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: null,
      runWorkspaceRoot: null,
      workflowWorkspaceRoot: null,
      sessionId: null
    }
    const result = resolvePath(ctx, 'data.csv', 'run')

    expect(result!.wsType).toBe('main')
  })
})

describe('resolveFolder', () => {
  it('空字符串 + 有运行工作区 → 默认 run', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: SESSION_WS,
      runWorkspaceRoot: RUN_WS,
      workflowWorkspaceRoot: WORKFLOW_WS,
      sessionId: 'sess-1'
    }
    const result = resolveFolder(ctx, '', undefined)

    expect(result).not.toBeNull()
    expect(result!.wsType).toBe('run')
    expect(result!.folder).toBe('')
  })

  it('空字符串 + wsArg=session → session', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: SESSION_WS,
      runWorkspaceRoot: RUN_WS,
      workflowWorkspaceRoot: WORKFLOW_WS,
      sessionId: 'sess-1'
    }
    const result = resolveFolder(ctx, '', 'session')

    expect(result!.wsType).toBe('session')
    expect(mdStore.ensureSessionWorkspace).toHaveBeenCalled()
  })

  it('空字符串 + wsArg=workflow → workflow', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: SESSION_WS,
      runWorkspaceRoot: RUN_WS,
      workflowWorkspaceRoot: WORKFLOW_WS,
      sessionId: 'sess-1'
    }
    const result = resolveFolder(ctx, '', 'workflow')

    expect(result).not.toBeNull()
    expect(result!.wsType).toBe('workflow')
    expect(result!.folder).toBe('')
  })

  it('相对路径 → 保持原值', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: null,
      runWorkspaceRoot: null,
      workflowWorkspaceRoot: null,
      sessionId: null
    }
    const result = resolveFolder(ctx, 'sub/dir')

    expect(result).not.toBeNull()
    expect(result!.folder).toBe('sub/dir')
    expect(result!.wsType).toBe('main')
  })

  it('路径遍历 (..) → null', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: null,
      runWorkspaceRoot: null,
      workflowWorkspaceRoot: null,
      sessionId: null
    }
    const result = resolveFolder(ctx, '../escape')
    expect(result).toBeNull()
  })

  it('绝对路径在工作区内 → 解析成功', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: null,
      runWorkspaceRoot: null,
      workflowWorkspaceRoot: null,
      sessionId: null
    }
    const absPath = path.join(SCOPE_ROOT, 'sub', 'dir')
    const result = resolveFolder(ctx, absPath)

    expect(result).not.toBeNull()
    expect(result!.wsType).toBe('main')
  })

  it('绝对路径越界 → null', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: null,
      runWorkspaceRoot: null,
      workflowWorkspaceRoot: null,
      sessionId: null
    }
    const result = resolveFolder(ctx, path.resolve('/outside/path'))
    expect(result).toBeNull()
  })

  it('null 输入 → 默认行为', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: null,
      runWorkspaceRoot: null,
      workflowWorkspaceRoot: null,
      sessionId: null
    }
    const result = resolveFolder(ctx, null)
    expect(result).not.toBeNull()
    expect(result!.folder).toBe('')
  })
})

describe('resolveWorkspaceType', () => {
  it('wsArg=workflow + 有 workflowWorkspaceRoot → workflow', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: null,
      runWorkspaceRoot: RUN_WS,
      workflowWorkspaceRoot: WORKFLOW_WS,
      sessionId: null
    }
    const result = resolveWorkspaceType(ctx, 'workflow')
    expect(result.wsType).toBe('workflow')
    expect(result.root).toBe(WORKFLOW_WS)
  })

  it('wsArg=workflow + 无 workflowWorkspaceRoot → main', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: null,
      runWorkspaceRoot: null,
      workflowWorkspaceRoot: null,
      sessionId: null
    }
    const result = resolveWorkspaceType(ctx, 'workflow')
    expect(result.wsType).toBe('main')
  })

  it('wsArg=run + 有 runWorkspaceRoot → run', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: null,
      runWorkspaceRoot: RUN_WS,
      workflowWorkspaceRoot: WORKFLOW_WS,
      sessionId: null
    }
    const result = resolveWorkspaceType(ctx, 'run')
    expect(result.wsType).toBe('run')
    expect(result.root).toBe(RUN_WS)
  })

  it('wsArg=session + 有 session → session', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: SESSION_WS,
      runWorkspaceRoot: null,
      workflowWorkspaceRoot: null,
      sessionId: 'sess-1'
    }
    const result = resolveWorkspaceType(ctx, 'session')
    expect(result.wsType).toBe('session')
    expect(result.root).toBe(SESSION_WS)
  })

  it('无 wsArg + 有 runWorkspaceRoot → run（默认优先）', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: SESSION_WS,
      runWorkspaceRoot: RUN_WS,
      workflowWorkspaceRoot: WORKFLOW_WS,
      sessionId: 'sess-1'
    }
    const result = resolveWorkspaceType(ctx, undefined)
    expect(result.wsType).toBe('run')
  })

  it('无 wsArg + 无 run → main', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: SESSION_WS,
      runWorkspaceRoot: null,
      workflowWorkspaceRoot: null,
      sessionId: 'sess-1'
    }
    const result = resolveWorkspaceType(ctx, undefined)
    expect(result.wsType).toBe('main')
    expect(result.root).toBe(SCOPE_ROOT)
  })

  it('wsArg=run + 无 runWorkspaceRoot → main', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: null,
      runWorkspaceRoot: null,
      workflowWorkspaceRoot: null,
      sessionId: null
    }
    const result = resolveWorkspaceType(ctx, 'run')
    expect(result.wsType).toBe('main')
  })

  it('wsArg=session + 无 sessionId → main', () => {
    const ctx: WorkspaceContext = {
      scopeRoot: SCOPE_ROOT,
      sessionWorkspaceRoot: null,
      runWorkspaceRoot: null,
      workflowWorkspaceRoot: null,
      sessionId: null
    }
    const result = resolveWorkspaceType(ctx, 'session')
    expect(result.wsType).toBe('main')
  })
})

describe('wsTypeLabel', () => {
  it('run → 运行工作区', () => {
    expect(wsTypeLabel('run')).toContain('运行工作区')
  })

  it('workflow → 工作流工作区', () => {
    expect(wsTypeLabel('workflow')).toContain('工作流工作区')
  })

  it('session → 临时工作区', () => {
    expect(wsTypeLabel('session')).toContain('临时工作区')
  })

  it('granted → 授权路径', () => {
    expect(wsTypeLabel('granted')).toContain('授权路径')
  })

  it('main → 空字符串', () => {
    expect(wsTypeLabel('main')).toBe('')
  })
})

describe('常量导出', () => {
  it('OUT_OF_BOUNDS_MSG 应包含路径提示', () => {
    expect(OUT_OF_BOUNDS_MSG).toBeTruthy()
    expect(OUT_OF_BOUNDS_MSG.length).toBeGreaterThan(10)
  })

  it('OUT_OF_BOUNDS_ERROR_CODE 应导出', () => {
    expect(OUT_OF_BOUNDS_ERROR_CODE).toBe('OUT_OF_BOUNDS')
  })
})
