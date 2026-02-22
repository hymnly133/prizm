"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const util = __importStar(require("util"));
const main_1 = __importDefault(require("electron-log/main"));
const config_1 = require("./config");
const config_2 = require("./config");
const ipcHandlers_1 = require("./ipcHandlers");
const windowManager_1 = require("./windowManager");
const trayManager_1 = require("./trayManager");
const shortcuts_1 = require("./shortcuts");
const clipboardSync_1 = require("./clipboardSync");
// 启用 Electron 自身的远程调试能力，使其可以作为 Internal Browser Node 参与 Agent 执行
electron_1.app.commandLine.appendSwitch('remote-debugging-port', '9222');
main_1.default.initialize();
process.on('uncaughtException', (err) => {
    main_1.default.error('[UncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
    main_1.default.error('[UnhandledRejection]', reason);
});
/** 日志路径：开发时在项目根目录，运行时在 exe 所在目录 */
main_1.default.transports.file.resolvePathFn = () => {
    const isDev = !electron_1.app.isPackaged;
    if (isDev) {
        return path.join(electron_1.app.getAppPath(), 'logs', 'main.log');
    }
    return path.join(path.dirname(electron_1.app.getPath('exe')), 'logs', 'main.log');
};
main_1.default.transports.renderer = (message) => {
    if (config_1.sharedState.mainWindow && !config_1.sharedState.mainWindow.isDestroyed()) {
        const text = util.format.apply(util, message.data);
        config_1.sharedState.mainWindow.webContents.send('log-to-renderer', {
            level: message.level,
            message: text,
            timestamp: message.date.toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }),
            source: 'main'
        });
    }
};
electron_1.app
    .whenReady()
    .then(async () => {
    electron_1.Menu.setApplicationMenu(null);
    await (0, config_2.loadTraySettings)();
    // 在创建窗口前设置 nativeTheme.themeSource，确保：
    // 1. BrowserWindow.backgroundColor 使用正确主题色
    // 2. CSS prefers-color-scheme 媒体查询匹配用户选择
    // 3. 消除窗口预加载时的主题闪烁
    const themeMode = await (0, config_2.loadThemeMode)();
    electron_1.nativeTheme.themeSource = themeMode === 'auto' ? 'system' : themeMode;
    main_1.default.info('[Electron] nativeTheme.themeSource set to:', electron_1.nativeTheme.themeSource);
    (0, ipcHandlers_1.registerIpcHandlers)();
    (0, windowManager_1.createMainWindow)();
    (0, windowManager_1.createQuickPanelWindow)();
    if (config_1.sharedState.trayEnabled) {
        (0, trayManager_1.createTray)();
    }
    (0, shortcuts_1.registerGlobalShortcuts)();
    (0, shortcuts_1.registerQuickPanelDoubleTap)();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            (0, windowManager_1.createMainWindow)();
        }
        else if (config_1.sharedState.mainWindow) {
            config_1.sharedState.mainWindow.show();
            config_1.sharedState.mainWindow.focus();
        }
    });
})
    .catch((err) => {
    main_1.default.error('[Electron] app.whenReady error:', err);
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', () => {
    main_1.default.info('[Electron] before-quit');
    config_1.sharedState.isQuitting = true;
    (0, clipboardSync_1.stopClipboardSync)();
});
electron_1.app.on('will-quit', () => {
    main_1.default.info('[Electron] will-quit');
    electron_1.globalShortcut.unregisterAll();
    (0, shortcuts_1.stopQuickPanelHook)();
});
//# sourceMappingURL=main.js.map