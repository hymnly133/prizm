"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGlobalShortcuts = registerGlobalShortcuts;
exports.registerQuickPanelDoubleTap = registerQuickPanelDoubleTap;
exports.stopQuickPanelHook = stopQuickPanelHook;
const electron_1 = require("electron");
const main_1 = __importDefault(require("electron-log/main"));
const config_1 = require("./config");
const windowManager_1 = require("./windowManager");
/**
 * 注册全局快捷键
 */
function registerGlobalShortcuts() {
    const accelerator = process.platform === 'darwin' ? 'Command+Shift+P' : 'Control+Shift+P';
    const ok = electron_1.globalShortcut.register(accelerator, () => {
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
    if (!ok) {
        main_1.default.warn('[Electron] Failed to register global shortcut:', accelerator);
    }
}
/** 快捷面板：双击 Ctrl 触发 */
const DOUBLE_TAP_MS = 350;
let lastCtrlUpAt = 0;
let ctrlDownWithoutOtherKeys = true;
let uiohookStarted = false;
async function getSelectedTextAsync() {
    const prev = electron_1.clipboard.readText();
    electron_1.clipboard.writeText('');
    try {
        const { uIOhook, UiohookKey } = require('uiohook-napi');
        uIOhook.keyTap(UiohookKey.C, [UiohookKey.LeftCtrl]);
    }
    catch (e) {
        main_1.default.warn('[Electron] uiohook keyTap failed:', e);
    }
    await new Promise((r) => setTimeout(r, 150));
    const text = electron_1.clipboard.readText().trim();
    electron_1.clipboard.writeText(prev);
    return text;
}
function showQuickPanel() {
    const win = (0, windowManager_1.createQuickPanelWindow)();
    if (!win || win.isDestroyed())
        return;
    const cursor = electron_1.screen.getCursorScreenPoint();
    const display = electron_1.screen.getDisplayNearestPoint(cursor);
    const bounds = display.bounds;
    const [w, h] = win.getSize();
    let x = cursor.x - Math.round(w / 2);
    let y = cursor.y + 16;
    x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - w));
    y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - h));
    win.setPosition(x, y);
    getSelectedTextAsync()
        .then((selectedText) => {
        if (config_1.sharedState.quickPanelWindow && !config_1.sharedState.quickPanelWindow.isDestroyed()) {
            config_1.sharedState.quickPanelWindow.webContents.send('show-quick-panel', {
                selectedText: selectedText || ''
            });
            config_1.sharedState.quickPanelWindow.show();
            config_1.sharedState.quickPanelWindow.focus();
        }
    })
        .catch((err) => {
        main_1.default.warn('[Electron] getSelectedText failed:', err);
        if (config_1.sharedState.quickPanelWindow && !config_1.sharedState.quickPanelWindow.isDestroyed()) {
            config_1.sharedState.quickPanelWindow.webContents.send('show-quick-panel', { selectedText: '' });
            config_1.sharedState.quickPanelWindow.show();
            config_1.sharedState.quickPanelWindow.focus();
        }
    });
}
function registerQuickPanelDoubleTap() {
    try {
        const { uIOhook, UiohookKey } = require('uiohook-napi');
        uIOhook.on('keydown', (e) => {
            const ctrl = UiohookKey.LeftCtrl ?? 29;
            const rightCtrl = UiohookKey.RightCtrl ?? 361;
            if (e.keycode !== ctrl && e.keycode !== rightCtrl) {
                ctrlDownWithoutOtherKeys = false;
            }
        });
        uIOhook.on('keyup', (e) => {
            const ctrl = UiohookKey.LeftCtrl ?? 29;
            const rightCtrl = UiohookKey.RightCtrl ?? 361;
            if (e.keycode === ctrl || e.keycode === rightCtrl) {
                const now = Date.now();
                if (ctrlDownWithoutOtherKeys && now - lastCtrlUpAt < DOUBLE_TAP_MS) {
                    lastCtrlUpAt = 0;
                    showQuickPanel();
                }
                else {
                    lastCtrlUpAt = now;
                }
                ctrlDownWithoutOtherKeys = true;
            }
        });
        uIOhook.start();
        uiohookStarted = true;
        main_1.default.info('[Electron] Quick panel double-tap Ctrl registered');
    }
    catch (e) {
        main_1.default.warn('[Electron] uiohook-napi not available, quick panel disabled:', e);
    }
}
function stopQuickPanelHook() {
    if (!uiohookStarted)
        return;
    try {
        const { uIOhook } = require('uiohook-napi');
        uIOhook.stop();
        uiohookStarted = false;
    }
    catch {
        // ignore
    }
}
//# sourceMappingURL=shortcuts.js.map