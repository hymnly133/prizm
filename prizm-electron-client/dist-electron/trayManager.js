"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTray = createTray;
const electron_1 = require("electron");
const config_1 = require("./config");
const windowManager_1 = require("./windowManager");
/**
 * 创建系统托盘
 */
function createTray() {
    if (!config_1.sharedState.trayEnabled || config_1.sharedState.tray) {
        return;
    }
    const icon = electron_1.nativeImage.createEmpty();
    config_1.sharedState.tray = new electron_1.Tray(icon);
    config_1.sharedState.tray.setToolTip('Prizm Electron Client');
    const contextMenu = electron_1.Menu.buildFromTemplate([
        {
            label: '打开 Prizm',
            click: () => {
                const win = (0, windowManager_1.createMainWindow)();
                if (win) {
                    win.show();
                    win.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: '退出',
            click: () => {
                config_1.sharedState.isQuitting = true;
                electron_1.app.quit();
            }
        }
    ]);
    config_1.sharedState.tray.setContextMenu(contextMenu);
    config_1.sharedState.tray.on('click', () => {
        const win = (0, windowManager_1.createMainWindow)();
        if (!win)
            return;
        if (win.isVisible()) {
            win.hide();
        }
        else {
            win.show();
            win.focus();
        }
    });
}
//# sourceMappingURL=trayManager.js.map