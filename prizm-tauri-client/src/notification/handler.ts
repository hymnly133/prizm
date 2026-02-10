/**
 * Prizm 通知处理器
 * 使用 Tauri notification plugin 显示系统通知
 */

import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import type { NotificationPayload } from '../types'

export class NotificationHandler {
  private static initialized = false
  private static initPromise: Promise<void> | null = null

  /**
   * 初始化通知权限
   */
  static async initialize(): Promise<void> {
    if (this.initialized) return

    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = this._initialize()
    await this.initPromise
    this.initPromise = null
  }

  private static async _initialize(): Promise<void> {
    try {
      let permissionGranted = await isPermissionGranted()

      if (!permissionGranted) {
        console.log('[NotificationHandler] Requesting notification permission...')
        const permission = await requestPermission()
        permissionGranted = permission === 'granted'

        if (!permissionGranted) {
          console.warn('[NotificationHandler] Notification permission denied')
        }
      }

      this.initialized = true
      console.log('[NotificationHandler] Notification handler initialized')
    } catch (error) {
      console.error('[NotificationHandler] Failed to initialize:', error)
    }
  }

  /**
   * 显示通知
   */
  static async show(payload: NotificationPayload): Promise<void> {
    await this.initialize()

    try {
      await sendNotification({
        title: payload.title,
        body: payload.body ?? '',
        icon: 'assets/icon.png',
        sound: 'default'
      })

      console.log(`[NotificationHandler] Displayed: ${payload.title}`)
    } catch (error) {
      console.error('[NotificationHandler] Failed to show notification:', error)
    }
  }

  /**
   * 检查是否已初始化
   */
  static isReady(): boolean {
    return this.initialized
  }
}
