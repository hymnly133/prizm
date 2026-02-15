"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('quickPanelApi', {
    onShow(callback) {
        const handler = (_, data) => callback(data);
        electron_1.ipcRenderer.on('show-quick-panel', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('show-quick-panel', handler);
        };
    },
    executeAction(action, selectedText) {
        electron_1.ipcRenderer.send('quick-panel-action', { action, selectedText });
    },
    hidePanel() {
        electron_1.ipcRenderer.send('quick-panel-hide');
    }
});
//# sourceMappingURL=quickpanel-preload.js.map