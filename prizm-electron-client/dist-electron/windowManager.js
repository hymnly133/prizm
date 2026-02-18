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
exports.createMainWindow = createMainWindow;
exports.showNotificationInWindow = showNotificationInWindow;
exports.createNotificationWindow = createNotificationWindow;
exports.createQuickPanelWindow = createQuickPanelWindow;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const main_1 = __importDefault(require("electron-log/main"));
const config_1 = require("./config");
const DEBUG_NOTIFY = true;
function logNotify(...args) {
    if (DEBUG_NOTIFY)
        main_1.default.info('[Notify]', ...args);
}
/**
 * 创建主窗口
 */
function createMainWindow() {
    const isDev = !electron_1.app.isPackaged;
    if (config_1.sharedState.mainWindow) {
        return config_1.sharedState.mainWindow;
    }
    const isDark = electron_1.nativeTheme.shouldUseDarkColors;
    const bgColor = isDark ? '#000000' : '#ffffff';
    config_1.sharedState.mainWindow = new electron_1.BrowserWindow({
        width: 980,
        height: 640,
        minWidth: 400,
        minHeight: 500,
        resizable: true,
        show: false,
        backgroundColor: bgColor,
        titleBarStyle: 'hidden',
        ...(process.platform === 'win32' && {
            titleBarOverlay: {
                color: '#00000000',
                symbolColor: isDark ? '#CCCCCC' : '#333333',
                height: 36
            }
        }),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    const mainWindow = config_1.sharedState.mainWindow;
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
    });
    if (isDev) {
        mainWindow.loadURL('http://localhost:5183');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }
    mainWindow.on('close', (event) => {
        if (config_1.sharedState.isQuitting) {
            return;
        }
        if (config_1.sharedState.trayEnabled && config_1.sharedState.minimizeToTray) {
            event.preventDefault();
            config_1.sharedState.mainWindow.hide();
        }
    });
    mainWindow.on('closed', () => {
        config_1.sharedState.mainWindow = null;
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
        const isAppUrl = url.startsWith('http://localhost:5183') || url.startsWith('file://') || url === 'about:blank';
        if (!isAppUrl) {
            event.preventDefault();
            electron_1.shell.openExternal(url);
        }
    });
    return mainWindow;
}
/**
 * 在通知窗口显示通知
 */
function showNotificationInWindow(payload) {
    logNotify('showNotificationInWindow 被调用', payload);
    const win = createNotificationWindow();
    win.show();
    win.moveTop();
    const send = () => {
        logNotify('直接 send 到 renderer', payload);
        win.webContents.send('notification', payload);
    };
    if (win.webContents.isLoading()) {
        config_1.sharedState.notificationQueue.push(payload);
        logNotify('窗口加载中，入队, queueLen=', config_1.sharedState.notificationQueue.length);
        return;
    }
    send();
}
/** 通知窗口加载完成后发送队列中的通知 */
function flushNotificationQueue(win) {
    logNotify('flushNotificationQueue, count=', config_1.sharedState.notificationQueue.length);
    for (const payload of config_1.sharedState.notificationQueue) {
        logNotify('flush send', payload);
        win.webContents.send('notification', payload);
    }
    config_1.sharedState.notificationQueue.length = 0;
}
/**
 * 创建无边框通知窗口（桌面独立弹出）
 */
function createNotificationWindow() {
    if (config_1.sharedState.notificationWindow && !config_1.sharedState.notificationWindow.isDestroyed()) {
        logNotify('createNotificationWindow: 复用已有窗口');
        return config_1.sharedState.notificationWindow;
    }
    logNotify('createNotificationWindow: 创建新窗口');
    const isDev = !electron_1.app.isPackaged;
    const primaryDisplay = electron_1.screen.getPrimaryDisplay();
    const { width: workWidth, height: workHeight } = primaryDisplay.workAreaSize;
    const workArea = primaryDisplay.workArea;
    const winWidth = 400;
    const margin = 12;
    config_1.sharedState.notificationWindow = new electron_1.BrowserWindow({
        width: winWidth,
        height: workHeight,
        x: workArea.x + workWidth - winWidth - margin,
        y: workArea.y,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        show: false,
        ...(process.platform === 'linux' && { type: 'notification' }),
        webPreferences: {
            preload: path.join(__dirname, 'notification-preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    const notificationWindow = config_1.sharedState.notificationWindow;
    if (isDev) {
        notificationWindow.loadURL('http://localhost:5183/notification.html');
    }
    else {
        notificationWindow.loadFile(path.join(__dirname, '..', 'dist', 'notification.html'));
    }
    electron_1.ipcMain.once('notification-ready', () => {
        logNotify('notification-ready 收到，flush 队列, queueLen=', config_1.sharedState.notificationQueue.length);
        if (config_1.sharedState.notificationWindow && !config_1.sharedState.notificationWindow.isDestroyed()) {
            flushNotificationQueue(config_1.sharedState.notificationWindow);
            config_1.sharedState.notificationWindow.show();
            config_1.sharedState.notificationWindow.moveTop();
        }
    });
    if (isDev) {
        notificationWindow.webContents.on('did-finish-load', () => {
            logNotify('notification 窗口 load 完成, isLoading=', notificationWindow.webContents.isLoading());
        });
        notificationWindow.webContents.openDevTools({ mode: 'detach' });
    }
    notificationWindow.setAlwaysOnTop(true, 'pop-up-menu');
    notificationWindow.setIgnoreMouseEvents(true, { forward: false });
    notificationWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    notificationWindow.webContents.on('will-navigate', (event, url) => {
        const isAppUrl = url.startsWith('http://localhost:5183') || url.startsWith('file://') || url === 'about:blank';
        if (!isAppUrl) {
            event.preventDefault();
            electron_1.shell.openExternal(url);
        }
    });
    notificationWindow.on('closed', () => {
        config_1.sharedState.notificationWindow = null;
    });
    electron_1.ipcMain.on('notification-panel-empty', () => {
        // 保持窗口可见，不隐藏
    });
    return notificationWindow;
}
/**
 * 创建快捷面板窗口
 */
function createQuickPanelWindow() {
    if (config_1.sharedState.quickPanelWindow && !config_1.sharedState.quickPanelWindow.isDestroyed()) {
        return config_1.sharedState.quickPanelWindow;
    }
    const isDev = !electron_1.app.isPackaged;
    config_1.sharedState.quickPanelWindow = new electron_1.BrowserWindow({
        width: 280,
        height: 256,
        frame: false,
        thickFrame: false,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: true,
        show: false,
        backgroundColor: '#16161c',
        roundedCorners: true,
        webPreferences: {
            preload: path.join(__dirname, 'quickpanel-preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    const quickPanelWindow = config_1.sharedState.quickPanelWindow;
    if (isDev) {
        quickPanelWindow.loadURL('http://localhost:5183/quickpanel.html');
    }
    else {
        quickPanelWindow.loadFile(path.join(__dirname, '..', 'dist', 'quickpanel.html'));
    }
    quickPanelWindow.setAlwaysOnTop(true, 'pop-up-menu');
    quickPanelWindow.on('blur', () => {
        quickPanelWindow?.hide();
    });
    quickPanelWindow.on('closed', () => {
        config_1.sharedState.quickPanelWindow = null;
    });
    quickPanelWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    return quickPanelWindow;
}
//# sourceMappingURL=windowManager.js.map