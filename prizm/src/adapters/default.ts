/**
 * Prizm Server 默认适配器实现
 * 用于独立运行或测试场景
 */

import type {
  IStickyNotesAdapter,
  INotificationAdapter,
  PrizmAdapters
} from './interfaces'
import type {
  StickyNote,
  StickyNoteGroup,
  CreateNotePayload,
  UpdateNotePayload
} from '../types'
import { scopeStore } from '../core/ScopeStore'

// ============ 默认 Sticky Notes 适配器 ============

export class DefaultStickyNotesAdapter implements IStickyNotesAdapter {
  async getAllNotes(scope: string): Promise<StickyNote[]> {
    const data = scopeStore.getScopeData(scope)
    return [...data.notes]
  }

  async getNoteById(scope: string, id: string): Promise<StickyNote | null> {
    const data = scopeStore.getScopeData(scope)
    return data.notes.find((n) => n.id === id) ?? null
  }

  async createNote(scope: string, payload: CreateNotePayload): Promise<StickyNote> {
    const data = scopeStore.getScopeData(scope)
    const note: StickyNote = {
      id: Math.random().toString(36).substring(2, 15),
      content: payload.content ?? '',
      imageUrls: payload.imageUrls,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      groupId: payload.groupId,
      fileRefs: payload.fileRefs
    }
    data.notes.push(note)
    scopeStore.saveScope(scope)
    console.log('[Prizm Notes] Note created:', note.id, 'scope:', scope)
    return note
  }

  async updateNote(scope: string, id: string, payload: UpdateNotePayload): Promise<StickyNote> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.notes.findIndex((n) => n.id === id)
    if (idx < 0) throw new Error(`Note not found: ${id}`)

    const existing = data.notes[idx]
    const updated: StickyNote = {
      ...existing,
      ...(payload.content !== undefined && { content: payload.content }),
      ...(payload.imageUrls !== undefined && { imageUrls: payload.imageUrls }),
      ...(payload.groupId !== undefined && { groupId: payload.groupId }),
      ...(payload.fileRefs !== undefined && { fileRefs: payload.fileRefs }),
      updatedAt: Date.now()
    }
    data.notes[idx] = updated
    scopeStore.saveScope(scope)
    console.log('[Prizm Notes] Note updated:', id, 'scope:', scope)
    return updated
  }

  async deleteNote(scope: string, id: string): Promise<void> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.notes.findIndex((n) => n.id === id)
    if (idx >= 0) {
      data.notes.splice(idx, 1)
      scopeStore.saveScope(scope)
      console.log('[Prizm Notes] Note deleted:', id, 'scope:', scope)
    }
  }

  async getAllGroups(scope: string): Promise<StickyNoteGroup[]> {
    const data = scopeStore.getScopeData(scope)
    return [...data.groups]
  }

  async createGroup(scope: string, name: string): Promise<StickyNoteGroup> {
    const data = scopeStore.getScopeData(scope)
    const group: StickyNoteGroup = {
      id: Math.random().toString(36).substring(2, 15),
      name
    }
    data.groups.push(group)
    scopeStore.saveScope(scope)
    console.log('[Prizm Notes] Group created:', group.id, 'scope:', scope)
    return group
  }

  async updateGroup(scope: string, id: string, name: string): Promise<StickyNoteGroup> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.groups.findIndex((g) => g.id === id)
    if (idx < 0) throw new Error(`Group not found: ${id}`)

    data.groups[idx] = { ...data.groups[idx], name }
    scopeStore.saveScope(scope)
    console.log('[Prizm Notes] Group updated:', id, 'scope:', scope)
    return data.groups[idx]
  }

  async deleteGroup(scope: string, id: string): Promise<void> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.groups.findIndex((g) => g.id === id)
    if (idx >= 0) {
      data.groups.splice(idx, 1)
      scopeStore.saveScope(scope)
      console.log('[Prizm Notes] Group deleted:', id, 'scope:', scope)
    }
  }
}

// ============ 默认 Notification 适配器 ============

export class DefaultNotificationAdapter implements INotificationAdapter {
  notify(title: string, body?: string): void {
    console.log('[Prizm Notify]', title, body ?? '')
  }
}

// ============ 创建默认适配器集合 ============

export function createDefaultAdapters(): PrizmAdapters {
  return {
    notes: new DefaultStickyNotesAdapter(),
    notification: new DefaultNotificationAdapter()
  }
}
