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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * 保存当前剪贴板内容（文本 + HTML 格式）
 */
function saveClipboard() {
    const text = electron_1.clipboard.readText();
    const html = electron_1.clipboard.readHTML();
    const formats = electron_1.clipboard.availableFormats();
    return { text, html, formats };
}
/**
 * 恢复之前保存的剪贴板内容
 */
function restoreClipboard(saved) {
    if (saved.formats.includes('text/html') && saved.html) {
        electron_1.clipboard.write({ text: saved.text, html: saved.html });
    }
    else if (saved.text) {
        electron_1.clipboard.writeText(saved.text);
    }
}
function toggleQuickPanel() {
    const win = config_1.sharedState.quickPanelWindow;
    if (win && !win.isDestroyed() && win.isVisible()) {
        win.hide();
        return;
    }
    showQuickPanel();
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
    // 读取当前剪贴板内容（同步）
    const existingClipboard = electron_1.clipboard.readText().trim();
    // 在目标应用仍有焦点时，立即保存剪贴板并模拟 Ctrl+C
    const saved = saveClipboard();
    electron_1.clipboard.writeText('');
    try {
        const { uIOhook, UiohookKey } = require('uiohook-napi');
        uIOhook.keyTap(UiohookKey.C, [UiohookKey.Ctrl]);
    }
    catch (e) {
        main_1.default.warn('[QuickPanel] uiohook keyTap failed:', e);
    }
    // 立即弹出面板（此时用已有剪贴板内容）
    win.webContents.send('show-quick-panel', { clipboardText: existingClipboard });
    win.show();
    win.focus();
    // 等待 Ctrl+C 结果写入剪贴板，增量更新面板
    sleep(250).then(() => {
        const selectedText = electron_1.clipboard.readText().trim();
        restoreClipboard(saved);
        if (selectedText && !win.isDestroyed()) {
            win.webContents.send('update-quick-panel-selection', { selectedText });
        }
    });
}
function registerQuickPanelDoubleTap() {
    try {
        const { uIOhook, UiohookKey } = require('uiohook-napi');
        const ctrl = UiohookKey.Ctrl;
        const rightCtrl = UiohookKey.CtrlRight;
        uIOhook.on('keydown', (e) => {
            if (e.keycode !== ctrl && e.keycode !== rightCtrl) {
                ctrlDownWithoutOtherKeys = false;
            }
        });
        uIOhook.on('keyup', (e) => {
            if (e.keycode === ctrl || e.keycode === rightCtrl) {
                const now = Date.now();
                if (ctrlDownWithoutOtherKeys && now - lastCtrlUpAt < DOUBLE_TAP_MS) {
                    lastCtrlUpAt = 0;
                    toggleQuickPanel();
                }
                else {
                    lastCtrlUpAt = now;
                }
                ctrlDownWithoutOtherKeys = true;
            }
        });
        uIOhook.start();
        uiohookStarted = true;
        main_1.default.info('[Electron] Quick panel double-tap Ctrl registered (Ctrl=%d, CtrlRight=%d)', ctrl, rightCtrl);
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