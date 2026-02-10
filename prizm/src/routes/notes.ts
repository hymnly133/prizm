/**
 * Sticky Notes 路由
 */

import type { Router, Request, Response } from 'express'
import type { IStickyNotesAdapter } from '../adapters/interfaces'
import { DEFAULT_SCOPE } from '../core/ScopeStore'

function getScope(req: Request): string {
  return req.prizmScope ?? DEFAULT_SCOPE
}

export function createNotesRoutes(router: Router, adapter?: IStickyNotesAdapter): void {
  if (!adapter) {
    console.warn('[Prizm] Notes adapter not provided, routes will return 503')
  }

  // GET /notes - 获取所有便签
  router.get('/notes', async (req: Request, res: Response) => {
    try {
      if (!adapter?.getAllNotes) {
        return res.status(503).json({ error: 'Notes adapter not available' })
      }

      const scope = getScope(req)
      const notes = await adapter.getAllNotes(scope)
      res.json({ notes })
    } catch (error) {
      console.error('[Prizm Notes] get all notes error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // ========== 分组路由（必须在 /notes/:id 之前定义）==========

  // GET /notes/groups - 获取所有分组
  router.get('/notes/groups', async (req: Request, res: Response) => {
    try {
      if (!adapter?.getAllGroups) {
        return res.status(503).json({ error: 'Notes adapter not available' })
      }

      const scope = getScope(req)
      const groups = await adapter.getAllGroups(scope)
      res.json({ groups })
    } catch (error) {
      console.error('[Prizm Notes] get all groups error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // POST /notes/groups - 创建分组
  router.post('/notes/groups', async (req: Request, res: Response) => {
    try {
      if (!adapter?.createGroup) {
        return res.status(503).json({ error: 'Notes adapter not available' })
      }

      const { name } = req.body
      if (!name) {
        return res.status(400).json({ error: 'name is required' })
      }

      const scope = getScope(req)
      const group = await adapter.createGroup(scope, name)
      res.status(201).json({ group })
    } catch (error) {
      console.error('[Prizm Notes] create group error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // PATCH /notes/groups/:id - 更新分组
  router.patch('/notes/groups/:id', async (req: Request, res: Response) => {
    try {
      if (!adapter?.updateGroup) {
        return res.status(503).json({ error: 'Notes adapter not available' })
      }

      const { id } = req.params
      const { name } = req.body

      if (!name) {
        return res.status(400).json({ error: 'name is required' })
      }

      const scope = getScope(req)
      const group = await adapter.updateGroup(scope, id, name)
      res.json({ group })
    } catch (error) {
      console.error('[Prizm Notes] update group error:', error)
      const errorMsg = String(error)
      if (errorMsg.includes('not found')) {
        return res.status(404).json({ error: errorMsg })
      }
      res.status(500).json({ error: errorMsg })
    }
  })

  // DELETE /notes/groups/:id - 删除分组
  router.delete('/notes/groups/:id', async (req: Request, res: Response) => {
    try {
      if (!adapter?.deleteGroup) {
        return res.status(503).json({ error: 'Notes adapter not available' })
      }

      const { id } = req.params
      const scope = getScope(req)
      await adapter.deleteGroup(scope, id)
      res.status(204).send()
    } catch (error) {
      console.error('[Prizm Notes] delete group error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // ========== 便签路由 ==========

  // GET /notes/:id - 获取单条便签
  router.get('/notes/:id', async (req: Request, res: Response) => {
    try {
      if (!adapter?.getNoteById) {
        return res.status(503).json({ error: 'Notes adapter not available' })
      }

      const { id } = req.params
      const scope = getScope(req)
      const note = await adapter.getNoteById(scope, id)

      if (!note) {
        return res.status(404).json({ error: 'Note not found' })
      }

      res.json({ note })
    } catch (error) {
      console.error('[Prizm Notes] get note by id error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // POST /notes - 创建便签
  router.post('/notes', async (req: Request, res: Response) => {
    try {
      if (!adapter?.createNote) {
        return res.status(503).json({ error: 'Notes adapter not available' })
      }

      const payload = req.body
      const scope = getScope(req)
      const note = await adapter.createNote(scope, payload)
      res.status(201).json({ note })
    } catch (error) {
      console.error('[Prizm Notes] create note error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // PATCH /notes/:id - 更新便签
  router.patch('/notes/:id', async (req: Request, res: Response) => {
    try {
      if (!adapter?.updateNote) {
        return res.status(503).json({ error: 'Notes adapter not available' })
      }

      const { id } = req.params
      const payload = req.body
      const scope = getScope(req)
      const note = await adapter.updateNote(scope, id, payload)
      res.json({ note })
    } catch (error) {
      console.error('[Prizm Notes] update note error:', error)
      const errorMsg = String(error)
      if (errorMsg.includes('not found')) {
        return res.status(404).json({ error: errorMsg })
      }
      res.status(500).json({ error: errorMsg })
    }
  })

  // DELETE /notes/:id - 删除便签
  router.delete('/notes/:id', async (req: Request, res: Response) => {
    try {
      if (!adapter?.deleteNote) {
        return res.status(503).json({ error: 'Notes adapter not available' })
      }

      const { id } = req.params
      const scope = getScope(req)
      await adapter.deleteNote(scope, id)
      res.status(204).send()
    } catch (error) {
      console.error('[Prizm Notes] delete note error:', error)
      res.status(500).json({ error: String(error) })
    }
  })
}
