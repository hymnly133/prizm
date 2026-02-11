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
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
/** 全局状态 */
let mainWindow = null;
let notificationWindow = null;
let tray = null;
let isQuitting = false;
let trayEnabled = true;
let minimizeToTray = true;
/**
 * 获取配置文件路径：与 Tauri 大致对齐，存放在用户配置目录下的 prizm-client/config.json
 */
function getConfigPath() {
    const configDir = path.join(electron_1.app.getPath("appData"), "prizm-client");
    const configPath = path.join(configDir, "config.json");
    return { configDir, configPath };
}
/**
 * 加载配置（如果不存在则返回默认配置）
 */
async function loadConfigFromDisk() {
    const { configDir, configPath } = getConfigPath();
    await fs.promises.mkdir(configDir, { recursive: true });
    try {
        const content = await fs.promises.readFile(configPath, "utf-8");
        return JSON.parse(content);
    }
    catch {
        return {
            server: {
                host: "127.0.0.1",
                port: "4127",
                is_dev: "true",
            },
            client: {
                name: "Prizm Electron Client",
                auto_register: "true",
                requested_scopes: ["default", "online"],
            },
            api_key: "",
            tray: {
                enabled: "true",
                minimize_to_tray: "true",
                show_notification: "true",
            },
            notify_events: ["notification"],
        };
    }
}
/**
 * 保存配置到磁盘
 */
async function saveConfigToDisk(config) {
    const { configDir, configPath } = getConfigPath();
    await fs.promises.mkdir(configDir, { recursive: true });
    const content = JSON.stringify(config, null, 2);
    await fs.promises.writeFile(configPath, content, "utf-8");
}
/**
 * 预加载托盘相关配置
 */
async function loadTraySettings() {
    try {
        const config = await loadConfigFromDisk();
        const trayConfig = config.tray || {};
        trayEnabled = trayConfig.enabled !== "false";
        minimizeToTray = trayConfig.minimize_to_tray !== "false";
    }
    catch (err) {
        console.warn("[Electron] Failed to load tray settings, using defaults:", err);
        trayEnabled = true;
        minimizeToTray = true;
    }
}
/**
 * 从 serverUrl 中提取 host 和 port
 */
function extractHostPort(url) {
    let clean = url;
    const prefixes = ["http://", "https://", "ws://", "wss://"];
    for (const p of prefixes) {
        if (clean.startsWith(p)) {
            clean = clean.slice(p.length);
            break;
        }
    }
    const idx = clean.lastIndexOf(":");
    if (idx === -1) {
        return { host: clean, port: "4127" };
    }
    return {
        host: clean.slice(0, idx),
        port: clean.slice(idx + 1),
    };
}
/**
 * 注册客户端：健康检查 + /auth/register
 */
async function registerClientOnServer(serverUrl, name, requestedScopes) {
    const healthUrl = `${serverUrl.replace(/\/+$/, "")}/health`;
    const resp = await fetch(healthUrl);
    if (!resp.ok) {
        throw new Error(`Health check failed: ${resp.status}`);
    }
    const health = (await resp.json());
    if (health.status !== "ok") {
        throw new Error("Server health check failed");
    }
    const registerUrl = `${serverUrl.replace(/\/+$/, "")}/auth/register`;
    const body = {
        name,
        requested_scopes: requestedScopes && requestedScopes.length > 0
            ? requestedScopes
            : undefined,
    };
    const registerResp = await fetch(registerUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Prizm-Panel": "true",
        },
        body: JSON.stringify(body),
    });
    if (!registerResp.ok) {
        const text = await registerResp.text();
        throw new Error(`Register failed: ${registerResp.status} ${text}`);
    }
    return (await registerResp.json());
}
/**
 * 测试服务器连接
 */
async function testConnectionOnServer(serverUrl) {
    const healthUrl = `${serverUrl.replace(/\/+$/, "")}/health`;
    const resp = await fetch(healthUrl);
    if (!resp.ok) {
        return false;
    }
    const health = (await resp.json());
    return health.status === "ok";
}
/**
 * 创建主窗口
 */
function createMainWindow() {
    const isDev = !electron_1.app.isPackaged;
    if (mainWindow) {
        return mainWindow;
    }
    mainWindow = new electron_1.BrowserWindow({
        width: 480,
        height: 640,
        minWidth: 400,
        minHeight: 500,
        resizable: true,
        titleBarStyle: "default",
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    if (isDev) {
        mainWindow.loadURL("http://localhost:5183");
        mainWindow.webContents.openDevTools({ mode: "detach" });
    }
    else {
        mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    }
    mainWindow.on("close", (event) => {
        if (isQuitting) {
            return;
        }
        if (trayEnabled && minimizeToTray) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
    // 点击 Markdown 预览中的链接时，在外部浏览器打开，避免应用内导航导致程序失效
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: "deny" };
    });
    mainWindow.webContents.on("will-navigate", (event, url) => {
        const isAppUrl = url.startsWith("http://localhost:5183") ||
            url.startsWith("file://") ||
            url === "about:blank";
        if (!isAppUrl) {
            event.preventDefault();
            electron_1.shell.openExternal(url);
        }
    });
    return mainWindow;
}
/**
 * 创建无边框通知窗口（桌面独立弹出）
 */
const DEBUG_NOTIFY = true;
function logNotify(...args) {
    if (DEBUG_NOTIFY)
        console.log("[Notify]", ...args);
}
function createNotificationWindow() {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        logNotify("createNotificationWindow: 复用已有窗口");
        return notificationWindow;
    }
    logNotify("createNotificationWindow: 创建新窗口");
    const isDev = !electron_1.app.isPackaged;
    const primaryDisplay = electron_1.screen.getPrimaryDisplay();
    const { width: workWidth, height: workHeight } = primaryDisplay.workAreaSize;
    const workArea = primaryDisplay.workArea;
    const winWidth = 400;
    const margin = 12;
    notificationWindow = new electron_1.BrowserWindow({
        width: winWidth,
        height: workHeight,
        x: workArea.x + workWidth - winWidth - margin,
        y: workArea.y,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "notification-preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    const loadPromise = isDev
        ? notificationWindow.loadURL("http://localhost:5183/notification.html")
        : notificationWindow.loadFile(path.join(__dirname, "..", "dist", "notification.html"));
    // 不在此处 flush：load 完成时 Vue 可能尚未挂载，改为在 notification-ready 时 flush
    // loadPromise.then(() => { flushNotificationQueue(notificationWindow!); });
    electron_1.ipcMain.once("notification-ready", () => {
        logNotify("notification-ready 收到，flush 队列, queueLen=", notificationQueue.length);
        if (notificationWindow && !notificationWindow.isDestroyed()) {
            flushNotificationQueue(notificationWindow);
            notificationWindow.show(); // 常驻显示：就绪后立即显示
        }
    });
    if (isDev) {
        notificationWindow.webContents.on("did-finish-load", () => {
            logNotify("notification 窗口 load 完成, isLoading=", notificationWindow.webContents.isLoading());
        });
        notificationWindow.webContents.openDevTools({ mode: "detach" });
    }
    notificationWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
    });
    // 常驻显示、不接收鼠标事件（点击穿透）
    notificationWindow.setIgnoreMouseEvents(true, { forward: false });
    // 通知窗口中的 Markdown 链接也应在外部浏览器打开
    notificationWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: "deny" };
    });
    notificationWindow.webContents.on("will-navigate", (event, url) => {
        const isAppUrl = url.startsWith("http://localhost:5183") ||
            url.startsWith("file://") ||
            url === "about:blank";
        if (!isAppUrl) {
            event.preventDefault();
            electron_1.shell.openExternal(url);
        }
    });
    notificationWindow.on("closed", () => {
        notificationWindow = null;
    });
    // 常驻显示：不再在面板为空时隐藏窗口
    electron_1.ipcMain.on("notification-panel-empty", () => {
        // 保持窗口可见，不隐藏
    });
    return notificationWindow;
}
/** 待发送通知队列（窗口未就绪时缓存） */
const notificationQueue = [];
/**
 * 在通知窗口显示通知
 */
function showNotificationInWindow(payload) {
    logNotify("showNotificationInWindow 被调用", payload);
    const win = createNotificationWindow();
    win.show();
    const send = () => {
        logNotify("直接 send 到 renderer", payload);
        win.webContents.send("notification", payload);
    };
    if (win.webContents.isLoading()) {
        notificationQueue.push(payload);
        logNotify("窗口加载中，入队, queueLen=", notificationQueue.length);
        return;
    }
    send();
}
/** 通知窗口加载完成后发送队列中的通知 */
function flushNotificationQueue(win) {
    logNotify("flushNotificationQueue, count=", notificationQueue.length);
    for (const payload of notificationQueue) {
        logNotify("flush send", payload);
        win.webContents.send("notification", payload);
    }
    notificationQueue.length = 0;
}
/**
 * 创建系统托盘
 */
function createTray() {
    if (!trayEnabled || tray) {
        return;
    }
    const icon = electron_1.nativeImage.createEmpty();
    tray = new electron_1.Tray(icon);
    tray.setToolTip("Prizm Electron Client");
    const contextMenu = electron_1.Menu.buildFromTemplate([
        {
            label: "打开 Prizm",
            click: () => {
                const win = createMainWindow();
                if (win) {
                    win.show();
                    win.focus();
                }
            },
        },
        { type: "separator" },
        {
            label: "退出",
            click: () => {
                isQuitting = true;
                electron_1.app.quit();
            },
        },
    ]);
    tray.setContextMenu(contextMenu);
    tray.on("click", () => {
        const win = createMainWindow();
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
/**
 * 注册全局快捷键
 */
function registerGlobalShortcuts() {
    const accelerator = process.platform === "darwin" ? "Command+Shift+P" : "Control+Shift+P";
    const ok = electron_1.globalShortcut.register(accelerator, () => {
        const win = createMainWindow();
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
    if (!ok) {
        console.warn("[Electron] Failed to register global shortcut:", accelerator);
    }
}
/** 剪贴板同步状态 */
let clipboardSyncInterval = null;
let lastClipboardText = "";
/**
 * 启动剪贴板同步：轮询系统剪贴板，变化时 POST 到服务器
 */
function startClipboardSync(serverUrl, apiKey, scope) {
    if (clipboardSyncInterval) {
        return;
    }
    lastClipboardText = electron_1.clipboard.readText();
    clipboardSyncInterval = setInterval(() => {
        const text = electron_1.clipboard.readText();
        if (!text || text === lastClipboardText) {
            return;
        }
        lastClipboardText = text;
        const base = serverUrl.replace(/\/+$/, "");
        const url = `${base}/clipboard`;
        fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({
                type: "text",
                content: text,
                createdAt: Date.now(),
                scope: scope || "default",
            }),
        })
            .then((resp) => {
            if (resp.ok && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send("clipboard-item-added");
            }
        })
            .catch((err) => {
            console.warn("[Electron] Clipboard sync failed:", err.message);
        });
    }, 1500);
}
/**
 * 停止剪贴板同步
 */
function stopClipboardSync() {
    if (clipboardSyncInterval) {
        clearInterval(clipboardSyncInterval);
        clipboardSyncInterval = null;
    }
}
/**
 * 注册 IPC 处理器
 */
function registerIpcHandlers() {
    electron_1.ipcMain.handle("load_config", async () => {
        try {
            return await loadConfigFromDisk();
        }
        catch (err) {
            console.error("[Electron] load_config failed:", err);
            throw err;
        }
    });
    electron_1.ipcMain.handle("save_config", async (_event, config) => {
        try {
            if (!config ||
                typeof config !== "object" ||
                !config.server ||
                !config.client ||
                typeof config.api_key === "undefined" ||
                !config.tray) {
                throw new Error("Invalid config payload");
            }
            await saveConfigToDisk(config);
            return true;
        }
        catch (err) {
            console.error("[Electron] save_config failed:", err);
            throw err;
        }
    });
    electron_1.ipcMain.handle("register_client", async (_event, { serverUrl, name, requestedScopes, }) => {
        try {
            const register = await registerClientOnServer(serverUrl, name, requestedScopes);
            const config = await loadConfigFromDisk();
            const { host, port } = extractHostPort(serverUrl);
            config.server.host = host;
            config.server.port = port;
            config.server.is_dev = "true";
            config.client.name = register.clientId || name;
            config.api_key = register.apiKey || "";
            await saveConfigToDisk(config);
            return register.apiKey;
        }
        catch (err) {
            console.error("[Electron] register_client failed:", err);
            throw err;
        }
    });
    electron_1.ipcMain.handle("test_connection", async (_event, { serverUrl }) => {
        try {
            return await testConnectionOnServer(serverUrl);
        }
        catch (err) {
            console.error("[Electron] test_connection failed:", err);
            return false;
        }
    });
    electron_1.ipcMain.handle("get_app_version", () => {
        return electron_1.app.getVersion();
    });
    electron_1.ipcMain.handle("open_dashboard", async (_event, { serverUrl }) => {
        try {
            const base = serverUrl.replace(/\/+$/, "");
            const dashboardUrl = `${base}/dashboard/`;
            await electron_1.shell.openExternal(dashboardUrl);
            return true;
        }
        catch (err) {
            console.error("[Electron] open_dashboard failed:", err);
            throw err;
        }
    });
    electron_1.ipcMain.handle("clipboard_read", () => {
        return electron_1.clipboard.readText();
    });
    electron_1.ipcMain.handle("clipboard_write", (_event, { text }) => {
        if (typeof text === "string") {
            electron_1.clipboard.writeText(text);
            return true;
        }
        return false;
    });
    electron_1.ipcMain.handle("clipboard_start_sync", async (_event, { serverUrl, apiKey, scope, }) => {
        startClipboardSync(serverUrl, apiKey || "", scope || "default");
        return true;
    });
    electron_1.ipcMain.handle("clipboard_stop_sync", () => {
        stopClipboardSync();
        return true;
    });
    electron_1.ipcMain.handle("show_notification", (_event, payload) => {
        logNotify("IPC show_notification 收到", payload);
        showNotificationInWindow(payload);
        return true;
    });
}
electron_1.app
    .whenReady()
    .then(async () => {
    await loadTraySettings();
    registerIpcHandlers();
    createMainWindow();
    if (trayEnabled) {
        createTray();
    }
    registerGlobalShortcuts();
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
        else if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
})
    .catch((err) => {
    console.error("[Electron] app.whenReady error:", err);
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});
electron_1.app.on("before-quit", () => {
    isQuitting = true;
    stopClipboardSync();
});
electron_1.app.on("will-quit", () => {
    electron_1.globalShortcut.unregisterAll();
});
//# sourceMappingURL=main.js.map