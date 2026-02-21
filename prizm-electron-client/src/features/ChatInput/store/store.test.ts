/**
 * ChatInput store 单元测试
 * 覆盖：applyOverlayChipInsert / setApplyOverlayChipInsert、addInputRef、inputRefs、getMarkdownContent
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStore } from './index'

describe('ChatInput store', () => {
  let api: ReturnType<typeof createStore>

  beforeEach(() => {
    api = createStore()
  })

  describe('applyOverlayChipInsert', () => {
    it('starts as null', () => {
      expect(api.getState().applyOverlayChipInsert).toBeNull()
    })

    it('setApplyOverlayChipInsert sets the callback', () => {
      const fn = vi.fn()
      api.getState().setApplyOverlayChipInsert(fn)
      expect(api.getState().applyOverlayChipInsert).toBe(fn)
    })

    it('setApplyOverlayChipInsert(null) clears the callback', () => {
      api.getState().setApplyOverlayChipInsert(vi.fn())
      api.getState().setApplyOverlayChipInsert(null)
      expect(api.getState().applyOverlayChipInsert).toBeNull()
    })

    it('callback is invoked with correct args when provided', () => {
      const fn = vi.fn()
      api.getState().setApplyOverlayChipInsert(fn)
      api.getState().applyOverlayChipInsert?.(2, 8, 'doc', 'abc', 'My Doc', '@(doc:abc)')
      expect(fn).toHaveBeenCalledWith(2, 8, 'doc', 'abc', 'My Doc', '@(doc:abc)')
    })
  })

  describe('inputRefs / addInputRef / clearInputRefs', () => {
    it('starts with empty inputRefs', () => {
      expect(api.getState().inputRefs).toEqual([])
    })

    it('addInputRef adds a ref', () => {
      api.getState().addInputRef({
        type: 'doc',
        key: 'id1',
        label: 'Doc 1',
        markdown: '@(doc:id1)'
      })
      expect(api.getState().inputRefs).toHaveLength(1)
      expect(api.getState().inputRefs[0].key).toBe('id1')
    })

    it('addInputRef does not duplicate same type+key', () => {
      api.getState().addInputRef({ type: 'doc', key: 'id1', label: 'L', markdown: '@(doc:id1)' })
      api.getState().addInputRef({ type: 'doc', key: 'id1', label: 'L', markdown: '@(doc:id1)' })
      expect(api.getState().inputRefs).toHaveLength(1)
    })

    it('removeInputRef removes by key', () => {
      api.getState().addInputRef({ type: 'doc', key: 'id1', label: 'L', markdown: '@(doc:id1)' })
      api.getState().removeInputRef('id1')
      expect(api.getState().inputRefs).toHaveLength(0)
    })

    it('clearInputRefs clears all', () => {
      api.getState().addInputRef({ type: 'doc', key: 'a', label: 'A', markdown: '@(doc:a)' })
      api.getState().clearInputRefs()
      expect(api.getState().inputRefs).toEqual([])
    })
  })

  describe('getMarkdownContent / setMarkdownContent', () => {
    it('getMarkdownContent returns current markdownContent', () => {
      api.getState().setMarkdownContent('hello')
      expect(api.getState().getMarkdownContent()).toBe('hello')
    })
  })

  describe('inputRefs state', () => {
    it('inputRefs state reflects added refs', () => {
      api.getState().addInputRef({
        type: 'todo',
        key: 't1',
        label: 'Task',
        markdown: '@(todo:t1)'
      })
      const refs = api.getState().inputRefs
      expect(refs).toHaveLength(1)
      expect(refs[0].type).toBe('todo')
      expect(refs[0].key).toBe('t1')
    })
  })
})
