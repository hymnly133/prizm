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
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const main_1 = __importDefault(require("electron-log/main"));
const config_1 = require("./config");
const config_2 = require("./config");
const clipboardSync_1 = require("./clipboardSync");
const windowManager_1 = require("./windowManager");
const DEBUG_NOTIFY = true;
function logNotify(...args) {
    if (DEBUG_NOTIFY)
        main_1.default.info('[Notify]', ...args);
}
/**
 * 从 serverUrl 中提取 host 和 port
 */
function extractHostPort(url) {
    let clean = url;
    const prefixes = ['http://', 'https://', 'ws://', 'wss://'];
    for (const p of prefixes) {
        if (clean.startsWith(p)) {
            clean = clean.slice(p.length);
            break;
        }
    }
    const idx = clean.lastIndexOf(':');
    if (idx === -1) {
        return { host: clean, port: '4127' };
    }
    return {
        host: clean.slice(0, idx),
        port: clean.slice(idx + 1)
    };
}
/**
 * 注册客户端：健康检查 + /auth/register
 */
async function registerClientOnServer(serverUrl, name, requestedScopes) {
    const healthUrl = `${serverUrl.replace(/\/+$/, '')}/health`;
    const resp = await fetch(healthUrl);
    if (!resp.ok) {
        throw new Error(`Health check failed: ${resp.status}`);
    }
    const health = (await resp.json());
    if (health.status !== 'ok') {
        throw new Error('Server health check failed');
    }
    const registerUrl = `${serverUrl.replace(/\/+$/, '')}/auth/register`;
    const body = {
        name,
        requestedScopes: requestedScopes && requestedScopes.length > 0 ? requestedScopes : undefined
    };
    const registerResp = await fetch(registerUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Prizm-Panel': 'true'
        },
        body: JSON.stringify(body)
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
    const healthUrl = `${serverUrl.replace(/\/+$/, '')}/health`;
    const resp = await fetch(healthUrl);
    if (!resp.ok) {
        return false;
    }
    const health = (await resp.json());
    return health.status === 'ok';
}
/** 文本文件扩展名白名单 */
const TEXT_EXTS = new Set([
    '.txt',
    '.md',
    '.markdown',
    '.json',
    '.csv',
    '.xml',
    '.html',
    '.htm',
    '.yaml',
    '.yml',
    '.log',
    '.js',
    '.ts',
    '.py',
    '.java',
    '.go',
    '.rs',
    '.c',
    '.cpp',
    '.h',
    '.hpp',
    '.css',
    '.scss',
    '.less',
    '.vue',
    '.jsx',
    '.tsx',
    '.toml',
    '.ini',
    '.cfg',
    '.conf',
    '.sh',
    '.bat',
    '.ps1',
    '.rb',
    '.php',
    '.swift',
    '.kt',
    '.sql',
    '.r',
    '.lua',
    '.pl',
    '.env',
    '.gitignore',
    '.editorconfig',
    '.prettierrc',
    '.eslintrc'
]);
const MAX_TEXT_SIZE = 1024 * 1024; // 1 MB
function readFilesFromPaths(paths) {
    const results = [];
    for (const filePath of paths) {
        try {
            const stat = fs.statSync(filePath);
            if (!stat.isFile())
                continue;
            const ext = path.extname(filePath).toLowerCase();
            const name = path.basename(filePath);
            const isTextExt = TEXT_EXTS.has(ext) || ext === '';
            if (isTextExt || stat.size < 256 * 1024) {
                let content = fs.readFileSync(filePath, 'utf-8');
                let truncated = false;
                if (content.length > MAX_TEXT_SIZE) {
                    content = content.slice(0, MAX_TEXT_SIZE);
                    truncated = true;
                }
                results.push({ path: filePath, name, size: stat.size, content, ext, truncated });
            }
            else {
                results.push({
                    path: filePath,
                    name,
                    size: stat.size,
                    content: null,
                    ext,
                    unsupported: true
                });
            }
        }
        catch (err) {
            main_1.default.warn('[read_files] skip file:', filePath, err);
        }
    }
    return results;
}
/**
 * 注册 IPC 处理器
 */
function registerIpcHandlers() {
    electron_1.ipcMain.handle('load_config', async () => {
        try {
            return await (0, config_2.loadConfigFromDisk)();
        }
        catch (err) {
            main_1.default.error('[Electron] load_config failed:', err);
            throw err;
        }
    });
    electron_1.ipcMain.handle('save_config', async (_event, config) => {
        try {
            if (!config ||
                typeof config !== 'object' ||
                !config.server ||
                !config.client ||
                typeof config.api_key === 'undefined' ||
                !config.tray) {
                throw new Error('Invalid config payload');
            }
            await (0, config_2.saveConfigToDisk)(config);
            return true;
        }
        catch (err) {
            main_1.default.error('[Electron] save_config failed:', err);
            throw err;
        }
    });
    electron_1.ipcMain.handle('register_client', async (_event, { serverUrl, name, requestedScopes }) => {
        try {
            const register = await registerClientOnServer(serverUrl, name, requestedScopes);
            const config = await (0, config_2.loadConfigFromDisk)();
            const { host, port } = extractHostPort(serverUrl);
            config.server.host = host;
            config.server.port = port;
            config.server.is_dev = 'true';
            config.client.name = register.clientId || name;
            config.api_key = register.apiKey || '';
            await (0, config_2.saveConfigToDisk)(config);
            return register.apiKey;
        }
        catch (err) {
            main_1.default.error('[Electron] register_client failed:', err);
            throw err;
        }
    });
    electron_1.ipcMain.handle('test_connection', async (_event, { serverUrl }) => {
        try {
            return await testConnectionOnServer(serverUrl);
        }
        catch (err) {
            main_1.default.error('[Electron] test_connection failed:', err);
            return false;
        }
    });
    electron_1.ipcMain.handle('get_app_version', () => {
        return electron_1.app.getVersion();
    });
    electron_1.ipcMain.handle('open_dashboard', async (_event, { serverUrl }) => {
        try {
            const base = serverUrl.replace(/\/+$/, '');
            const dashboardUrl = `${base}/dashboard/`;
            await electron_1.shell.openExternal(dashboardUrl);
            return true;
        }
        catch (err) {
            main_1.default.error('[Electron] open_dashboard failed:', err);
            throw err;
        }
    });
    electron_1.ipcMain.handle('clipboard_read', () => {
        return electron_1.clipboard.readText();
    });
    electron_1.ipcMain.handle('clipboard_write', (_event, { text }) => {
        if (typeof text === 'string') {
            electron_1.clipboard.writeText(text);
            return true;
        }
        return false;
    });
    electron_1.ipcMain.handle('clipboard_start_sync', async (_event, { serverUrl, apiKey, scope }) => {
        (0, clipboardSync_1.startClipboardSync)(serverUrl, apiKey || '', scope || 'default');
        return true;
    });
    electron_1.ipcMain.handle('clipboard_stop_sync', () => {
        (0, clipboardSync_1.stopClipboardSync)();
        return true;
    });
    electron_1.ipcMain.handle('show_notification', (_event, payload) => {
        logNotify('IPC show_notification 收到', payload);
        (0, windowManager_1.showNotificationInWindow)(payload);
        return true;
    });
    electron_1.ipcMain.handle('log_from_renderer', (_event, payload) => {
        const { message, type } = payload;
        if (type === 'error')
            main_1.default.error(message);
        else if (type === 'warning')
            main_1.default.warn(message);
        else
            main_1.default.info(message);
        return true;
    });
    electron_1.ipcMain.handle('write_log', (_event, payload) => {
        const { level, message } = payload;
        if (level === 'error')
            main_1.default.error(message);
        else if (level === 'warn')
            main_1.default.warn(message);
        else if (level === 'debug')
            main_1.default.debug(message);
        else
            main_1.default.info(message);
        return true;
    });
    electron_1.ipcMain.handle('select_folder', async () => {
        const opts = {
            properties: ['openDirectory'],
            title: '选择工作区文件夹'
        };
        const result = config_1.sharedState.mainWindow
            ? await electron_1.dialog.showOpenDialog(config_1.sharedState.mainWindow, opts)
            : await electron_1.dialog.showOpenDialog(opts);
        if (result.canceled || !result.filePaths.length)
            return null;
        return result.filePaths[0];
    });
    electron_1.ipcMain.handle('read_files', async (_event, { paths }) => {
        return readFilesFromPaths(paths);
    });
    electron_1.ipcMain.handle('select_and_read_files', async () => {
        const opts = {
            properties: ['openFile', 'multiSelections'],
            title: '选择要导入的文件',
            filters: [
                {
                    name: '文本文件',
                    extensions: [
                        'txt',
                        'md',
                        'json',
                        'csv',
                        'xml',
                        'html',
                        'yaml',
                        'yml',
                        'log',
                        'js',
                        'ts',
                        'py',
                        'java',
                        'go',
                        'rs',
                        'c',
                        'cpp',
                        'css',
                        'vue',
                        'jsx',
                        'tsx'
                    ]
                },
                { name: '所有文件', extensions: ['*'] }
            ]
        };
        const result = config_1.sharedState.mainWindow
            ? await electron_1.dialog.showOpenDialog(config_1.sharedState.mainWindow, opts)
            : await electron_1.dialog.showOpenDialog(opts);
        if (result.canceled || !result.filePaths.length)
            return null;
        return readFilesFromPaths(result.filePaths);
    });
    electron_1.ipcMain.handle('get_platform', () => {
        return process.platform;
    });
    electron_1.ipcMain.handle('set_titlebar_overlay', (_event, options) => {
        if (config_1.sharedState.mainWindow &&
            !config_1.sharedState.mainWindow.isDestroyed() &&
            process.platform === 'win32') {
            config_1.sharedState.mainWindow.setTitleBarOverlay(options);
        }
        return true;
    });
    electron_1.ipcMain.handle('set_native_theme', async (_event, { mode }) => {
        const source = mode === 'auto' ? 'system' : mode;
        electron_1.nativeTheme.themeSource = source;
        main_1.default.info('[Electron] nativeTheme.themeSource changed to:', source);
        await (0, config_2.saveThemeMode)(mode);
        // 同步更新 Windows 标题栏控件颜色
        if (process.platform === 'win32' &&
            config_1.sharedState.mainWindow &&
            !config_1.sharedState.mainWindow.isDestroyed()) {
            const isDark = electron_1.nativeTheme.shouldUseDarkColors;
            config_1.sharedState.mainWindow.setTitleBarOverlay({
                color: '#00000000',
                symbolColor: isDark ? '#CCCCCC' : '#333333'
            });
        }
        return true;
    });
    electron_1.ipcMain.on('quick-panel-action', (_event, payload) => {
        if (config_1.sharedState.quickPanelWindow && !config_1.sharedState.quickPanelWindow.isDestroyed()) {
            config_1.sharedState.quickPanelWindow.hide();
        }
        if (config_1.sharedState.mainWindow && !config_1.sharedState.mainWindow.isDestroyed()) {
            config_1.sharedState.mainWindow.show();
            config_1.sharedState.mainWindow.focus();
            config_1.sharedState.mainWindow.webContents.send('execute-quick-action', payload);
        }
    });
    electron_1.ipcMain.on('quick-panel-hide', () => {
        if (config_1.sharedState.quickPanelWindow && !config_1.sharedState.quickPanelWindow.isDestroyed()) {
            config_1.sharedState.quickPanelWindow.hide();
        }
    });
}
//# sourceMappingURL=ipcHandlers.js.map