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
exports.sharedState = void 0;
exports.loadConfigFromDisk = loadConfigFromDisk;
exports.saveConfigToDisk = saveConfigToDisk;
exports.loadThemeMode = loadThemeMode;
exports.saveThemeMode = saveThemeMode;
exports.loadTraySettings = loadTraySettings;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const main_1 = __importDefault(require("electron-log/main"));
/** Shared state used by windowManager, trayManager, ipcHandlers, etc. */
exports.sharedState = {
    mainWindow: null,
    notificationWindow: null,
    quickPanelWindow: null,
    tray: null,
    isQuitting: false,
    trayEnabled: true,
    minimizeToTray: true,
    notificationQueue: []
};
/**
 * 获取配置文件路径：与 Tauri 大致对齐，存放在用户配置目录下的 prizm-client/config.json
 */
function getConfigPath() {
    const configDir = path.join(electron_1.app.getPath('appData'), 'prizm-client');
    const configPath = path.join(configDir, 'config.json');
    return { configDir, configPath };
}
/**
 * 加载配置（如果不存在则返回默认配置）
 */
async function loadConfigFromDisk() {
    const { configDir, configPath } = getConfigPath();
    await fs.promises.mkdir(configDir, { recursive: true });
    try {
        const content = await fs.promises.readFile(configPath, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return {
            server: {
                host: '127.0.0.1',
                port: '4127',
                is_dev: 'true'
            },
            client: {
                name: 'Prizm Electron Client',
                auto_register: 'true',
                requested_scopes: ['default', 'online']
            },
            api_key: '',
            tray: {
                enabled: 'true',
                minimize_to_tray: 'true',
                show_notification: 'true'
            },
            notify_events: ['notification', 'todo_list:created', 'todo_list:updated', 'todo_list:deleted']
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
    await fs.promises.writeFile(configPath, content, 'utf-8');
}
/**
 * 加载持久化的主题模式（供主进程在创建窗口前使用）
 */
async function loadThemeMode() {
    try {
        const config = await loadConfigFromDisk();
        const mode = config.themeMode;
        if (mode === 'light' || mode === 'dark' || mode === 'auto')
            return mode;
    }
    catch { }
    return 'auto';
}
/**
 * 保存主题模式到配置文件
 */
async function saveThemeMode(mode) {
    try {
        const config = await loadConfigFromDisk();
        config.themeMode = mode;
        await saveConfigToDisk(config);
    }
    catch (err) {
        main_1.default.warn('[Electron] Failed to save theme mode:', err);
    }
}
/**
 * 预加载托盘相关配置
 */
async function loadTraySettings() {
    try {
        const config = await loadConfigFromDisk();
        const trayConfig = config.tray || {};
        exports.sharedState.trayEnabled = trayConfig.enabled !== 'false';
        exports.sharedState.minimizeToTray = trayConfig.minimize_to_tray !== 'false';
    }
    catch (err) {
        main_1.default.warn('[Electron] Failed to load tray settings, using defaults:', err);
        exports.sharedState.trayEnabled = true;
        exports.sharedState.minimizeToTray = true;
    }
}
//# sourceMappingURL=config.js.map