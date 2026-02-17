import { Tray, Menu, nativeImage, app } from 'electron'
import { sharedState } from './config'
import { createMainWindow } from './windowManager'

/**
 * 创建系统托盘
 */
export function createTray(): void {
  if (!sharedState.trayEnabled || sharedState.tray) {
    return
  }

  const icon = nativeImage.createEmpty()
  sharedState.tray = new Tray(icon)
  sharedState.tray.setToolTip('Prizm Electron Client')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开 Prizm',
      click: () => {
        const win = createMainWindow()
        if (win) {
          win.show()
          win.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        sharedState.isQuitting = true
        app.quit()
      }
    }
  ])

  sharedState.tray.setContextMenu(contextMenu)
  sharedState.tray.on('click', () => {
    const win = createMainWindow()
    if (!win) return
    if (win.isVisible()) {
      win.hide()
    } else {
      win.show()
      win.focus()
    }
  })
}
