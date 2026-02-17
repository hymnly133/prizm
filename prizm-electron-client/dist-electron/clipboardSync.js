"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startClipboardSync = startClipboardSync;
exports.stopClipboardSync = stopClipboardSync;
const electron_1 = require("electron");
const main_1 = __importDefault(require("electron-log/main"));
const config_1 = require("./config");
let clipboardSyncInterval = null;
let lastClipboardText = '';
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
        const base = serverUrl.replace(/\/+$/, '');
        const url = `${base}/clipboard`;
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify({
                type: 'text',
                content: text,
                createdAt: Date.now(),
                scope: scope || 'default'
            })
        })
            .then((resp) => {
            if (resp.ok && config_1.sharedState.mainWindow && !config_1.sharedState.mainWindow.isDestroyed()) {
                config_1.sharedState.mainWindow.webContents.send('clipboard-item-added');
            }
        })
            .catch((err) => {
            main_1.default.warn('[Electron] Clipboard sync failed:', err.message);
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
//# sourceMappingURL=clipboardSync.js.map