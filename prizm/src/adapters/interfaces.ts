/**
 * Prizm Server 适配器接口
 * 这些接口定义了 Prizm 服务器与底层服务的交互契约
 */

import type {
  StickyNote,
  StickyNoteGroup,
  CreateNotePayload,
  UpdateNotePayload
} from '../types'

// ============ Sticky Notes 适配器 ============

export interface IStickyNotesAdapter {
  /**
   * 获取所有便签
   * @param scope 数据 scope
   */
  getAllNotes?(scope: string): Promise<StickyNote[]>

  /**
   * 根据 ID 获取便签
   * @param scope 数据 scope
   */
  getNoteById?(scope: string, id: string): Promise<StickyNote | null>

  /**
   * 创建便签
   * @param scope 数据 scope
   */
  createNote?(scope: string, payload: CreateNotePayload): Promise<StickyNote>

  /**
   * 更新便签
   * @param scope 数据 scope
   */
  updateNote?(scope: string, id: string, payload: UpdateNotePayload): Promise<StickyNote>

  /**
   * 删除便签
   * @param scope 数据 scope
   */
  deleteNote?(scope: string, id: string): Promise<void>

  /**
   * 获取所有分组
   * @param scope 数据 scope
   */
  getAllGroups?(scope: string): Promise<StickyNoteGroup[]>

  /**
   * 创建分组
   * @param scope 数据 scope
   */
  createGroup?(scope: string, name: string): Promise<StickyNoteGroup>

  /**
   * 更新分组
   * @param scope 数据 scope
   */
  updateGroup?(scope: string, id: string, name: string): Promise<StickyNoteGroup>

  /**
   * 删除分组
   * @param scope 数据 scope
   */
  deleteGroup?(scope: string, id: string): Promise<void>
}

// ============ Notification 适配器 ============

export interface INotificationAdapter {
  /**
   * 发送通知信号
   * @param title 通知标题
   * @param body 通知内容
   */
  notify(title: string, body?: string): void
}

// ============ 适配器集合 ============

export interface PrizmAdapters {
  notes?: IStickyNotesAdapter
  notification?: INotificationAdapter
}
