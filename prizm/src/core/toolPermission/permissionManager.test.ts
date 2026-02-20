/**
 * PermissionManager 单元测试
 *
 * 覆盖：权限模式切换/规则匹配/会话隔离/checkPermission/hook注册
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setSessionPermissionMode,
  getSessionPermissionMode,
  clearSessionPermission,
  addSessionRules,
  checkPermission,
  registerPermissionHook
} from './permissionManager'
import { hookRegistry } from '../agentHooks/hookRegistry'

beforeEach(() => {
  clearSessionPermission('sess-a')
  clearSessionPermission('sess-b')
  hookRegistry.clear()
})

describe('PermissionManager', () => {
  // ─── 权限模式 ───

  describe('session permission mode', () => {
    it('should default to "default" mode', () => {
      expect(getSessionPermissionMode('unknown-session')).toBe('default')
    })

    it('should set and get permission mode', () => {
      setSessionPermissionMode('sess-a', 'plan')
      expect(getSessionPermissionMode('sess-a')).toBe('plan')
    })

    it('should isolate modes between sessions', () => {
      setSessionPermissionMode('sess-a', 'plan')
      setSessionPermissionMode('sess-b', 'acceptEdits')

      expect(getSessionPermissionMode('sess-a')).toBe('plan')
      expect(getSessionPermissionMode('sess-b')).toBe('acceptEdits')
    })

    it('should clear session permission', () => {
      setSessionPermissionMode('sess-a', 'bypassPermissions')
      clearSessionPermission('sess-a')
      expect(getSessionPermissionMode('sess-a')).toBe('default')
    })
  })

  // ─── checkPermission ───

  describe('checkPermission', () => {
    it('should allow all tools in bypassPermissions mode', () => {
      setSessionPermissionMode('sess-a', 'bypassPermissions')

      const result = checkPermission('sess-a', 'prizm_write_file', { path: '/x' }, [])
      expect(result.allowed).toBe(true)
    })

    it('should deny write tools in plan mode', () => {
      setSessionPermissionMode('sess-a', 'plan')

      const result = checkPermission('sess-a', 'prizm_write_file', { path: '/x' }, [])
      expect(result.allowed).toBe(false)
      expect(result.denyMessage).toContain('Plan mode')
    })

    it('should deny update_document in plan mode', () => {
      setSessionPermissionMode('sess-a', 'plan')

      const result = checkPermission('sess-a', 'prizm_update_document', { id: 'd1' }, [])
      expect(result.allowed).toBe(false)
    })

    it('should deny terminal tools in plan mode', () => {
      setSessionPermissionMode('sess-a', 'plan')

      const result = checkPermission('sess-a', 'prizm_terminal_exec', {}, [])
      expect(result.allowed).toBe(false)
    })

    it('should allow read tools in plan mode', () => {
      setSessionPermissionMode('sess-a', 'plan')

      const result = checkPermission('sess-a', 'prizm_read_file', { path: '/x' }, [])
      expect(result.allowed).toBe(true)
    })

    it('should allow all tools in acceptEdits mode', () => {
      setSessionPermissionMode('sess-a', 'acceptEdits')

      const result = checkPermission('sess-a', 'prizm_write_file', { path: '/x' }, [])
      expect(result.allowed).toBe(true)
    })

    it('should deny tools in dontAsk mode', () => {
      setSessionPermissionMode('sess-a', 'dontAsk')

      const result = checkPermission('sess-a', 'prizm_write_file', { path: '/x' }, [])
      expect(result.allowed).toBe(false)
      expect(result.denyMessage).toContain('dontAsk')
    })

    it('should require interact for write tools in default mode with uncovered paths', () => {
      const result = checkPermission(
        'sess-a',
        'prizm_write_file',
        { path: '/outside/file.txt' },
        []
      )
      expect(result.allowed).toBe(false)
      expect(result.interactPaths).toContain('/outside/file.txt')
    })

    it('should allow write tools in default mode when paths are granted', () => {
      const result = checkPermission(
        'sess-a',
        'prizm_write_file',
        { path: '/granted/file.txt' },
        ['/granted/file.txt']
      )
      expect(result.allowed).toBe(true)
    })

    it('should allow non-restricted tools in default mode', () => {
      const result = checkPermission('sess-a', 'prizm_list_files', {}, [])
      expect(result.allowed).toBe(true)
    })

    it('should extract multiple paths from tool args', () => {
      const result = checkPermission(
        'sess-a',
        'prizm_move_file',
        { from: '/a.txt', to: '/b.txt' },
        []
      )
      expect(result.allowed).toBe(false)
      expect(result.interactPaths).toEqual(
        expect.arrayContaining(['/a.txt', '/b.txt'])
      )
    })
  })

  // ─── 自定义规则 ───

  describe('custom session rules', () => {
    it('should apply custom deny rules', () => {
      addSessionRules('sess-a', [
        {
          id: 'custom:deny-search',
          toolPattern: 'prizm_search',
          behavior: 'deny',
          denyMessage: 'search disabled',
          priority: 5
        }
      ])

      const result = checkPermission('sess-a', 'prizm_search', {}, [])
      expect(result.allowed).toBe(false)
      expect(result.denyMessage).toBe('search disabled')
    })

    it('should not affect other sessions', () => {
      addSessionRules('sess-a', [
        {
          id: 'custom:deny',
          toolPattern: 'prizm_search',
          behavior: 'deny',
          priority: 5
        }
      ])

      const result = checkPermission('sess-b', 'prizm_search', {}, [])
      expect(result.allowed).toBe(true)
    })

    it('should clear custom rules on clearSessionPermission', () => {
      addSessionRules('sess-a', [
        {
          id: 'custom:deny',
          toolPattern: 'prizm_search',
          behavior: 'deny',
          priority: 5
        }
      ])
      clearSessionPermission('sess-a')

      const result = checkPermission('sess-a', 'prizm_search', {}, [])
      expect(result.allowed).toBe(true)
    })
  })

  // ─── Hook 注册 ───

  describe('registerPermissionHook', () => {
    it('should register a PreToolUse hook', () => {
      registerPermissionHook()
      const hooks = hookRegistry.getMatchingHooks('PreToolUse', 'any')
      expect(hooks.some((h) => h.id === 'builtin:permission-manager')).toBe(true)
    })

    it('should use low priority (10) to run early', () => {
      registerPermissionHook()
      const hooks = hookRegistry.getMatchingHooks('PreToolUse', 'any')
      const permHook = hooks.find((h) => h.id === 'builtin:permission-manager')
      expect(permHook?.priority).toBe(10)
    })

    it('should deny via hook in plan mode', async () => {
      setSessionPermissionMode('sess-a', 'plan')
      registerPermissionHook()

      const hooks = hookRegistry.getMatchingHooks('PreToolUse', 'prizm_write_file')
      const permHook = hooks.find((h) => h.id === 'builtin:permission-manager')!
      const result = await permHook.callback({
        scope: 'default',
        sessionId: 'sess-a',
        toolName: 'prizm_write_file',
        toolCallId: 'tc-1',
        arguments: { path: '/test' },
        grantedPaths: []
      })
      expect(result).toBeDefined()
      expect((result as any).decision).toBe('deny')
    })
  })
})
