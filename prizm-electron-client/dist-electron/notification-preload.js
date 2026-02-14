"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const renderer_1 = __importDefault(require("electron-log/renderer"));
/**
 * 通知窗口预加载脚本
 * 暴露接收通知的 API
 */
electron_1.contextBridge.exposeInMainWorld('notificationApi', {
    onNotification(callback) {
        const handler = (_, payload) => {
            renderer_1.default.info('[Notify preload] 收到 IPC notification', payload);
            callback(payload);
        };
        renderer_1.default.info('[Notify preload] 注册 onNotification 监听');
        electron_1.ipcRenderer.on('notification', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('notification', handler);
        };
    },
    /** 通知面板已空，可隐藏窗口以释放鼠标穿透 */
    notifyPanelEmpty: () => {
        renderer_1.default.info('[Notify preload] notifyPanelEmpty');
        electron_1.ipcRenderer.send('notification-panel-empty');
    },
    /** 通知面板已就绪，可接收通知（Vue 挂载完成后调用） */
    notifyReady: () => {
        renderer_1.default.info('[Notify preload] notifyReady 发送');
        electron_1.ipcRenderer.send('notification-ready');
    }
});
//# sourceMappingURL=notification-preload.js.map