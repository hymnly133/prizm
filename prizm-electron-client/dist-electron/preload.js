"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
/**
 * 向渲染进程暴露一个与 Tauri invoke 语义接近的 API
 */
electron_1.contextBridge.exposeInMainWorld('prizm', {
    loadConfig() {
        return electron_1.ipcRenderer.invoke('load_config');
    },
    saveConfig(config) {
        return electron_1.ipcRenderer.invoke('save_config', config);
    },
    testConnection(serverUrl) {
        return electron_1.ipcRenderer.invoke('test_connection', { serverUrl });
    },
    registerClient(serverUrl, name, scopes) {
        return electron_1.ipcRenderer.invoke('register_client', {
            serverUrl,
            name,
            requestedScopes: scopes
        });
    },
    getAppVersion() {
        return electron_1.ipcRenderer.invoke('get_app_version');
    },
    openDashboard(serverUrl) {
        return electron_1.ipcRenderer.invoke('open_dashboard', { serverUrl });
    },
    readClipboard() {
        return electron_1.ipcRenderer.invoke('clipboard_read');
    },
    writeClipboard(text) {
        return electron_1.ipcRenderer.invoke('clipboard_write', { text });
    },
    startClipboardSync(config) {
        return electron_1.ipcRenderer.invoke('clipboard_start_sync', config);
    },
    stopClipboardSync() {
        return electron_1.ipcRenderer.invoke('clipboard_stop_sync');
    },
    onClipboardItemAdded(callback) {
        const handler = () => callback();
        electron_1.ipcRenderer.on('clipboard-item-added', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('clipboard-item-added', handler);
        };
    },
    showNotification(payload) {
        return electron_1.ipcRenderer.invoke('show_notification', payload);
    },
    onLogFromMain(callback) {
        const handler = (_, entry) => callback(entry);
        electron_1.ipcRenderer.on('log-to-renderer', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('log-to-renderer', handler);
        };
    },
    logFromRenderer(message, type) {
        return electron_1.ipcRenderer.invoke('log_from_renderer', { message, type });
    },
    selectFolder() {
        return electron_1.ipcRenderer.invoke('select_folder');
    },
    readFiles(paths) {
        return electron_1.ipcRenderer.invoke('read_files', { paths });
    },
    selectAndReadFiles() {
        return electron_1.ipcRenderer.invoke('select_and_read_files');
    },
    /** Electron 40 中 File.path 已弃用，用 webUtils.getPathForFile 替代 */
    getPathForFile(file) {
        try {
            return electron_1.webUtils.getPathForFile(file) || '';
        }
        catch {
            return '';
        }
    },
    onExecuteQuickAction(callback) {
        const handler = (_, payload) => callback(payload);
        electron_1.ipcRenderer.on('execute-quick-action', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('execute-quick-action', handler);
        };
    },
    getPlatform() {
        return electron_1.ipcRenderer.invoke('get_platform');
    },
    setTitleBarOverlay(options) {
        return electron_1.ipcRenderer.invoke('set_titlebar_overlay', options);
    }
});
//# sourceMappingURL=preload.js.map