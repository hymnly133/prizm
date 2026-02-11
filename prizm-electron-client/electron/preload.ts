import { contextBridge, ipcRenderer } from "electron";

/**
 * 向渲染进程暴露一个与 Tauri invoke 语义接近的 API
 */
contextBridge.exposeInMainWorld("prizm", {
	loadConfig() {
		return ipcRenderer.invoke("load_config");
	},

	saveConfig(config: unknown) {
		return ipcRenderer.invoke("save_config", config);
	},

	testConnection(serverUrl: string) {
		return ipcRenderer.invoke("test_connection", { serverUrl });
	},

	registerClient(serverUrl: string, name: string, scopes: string[]) {
		return ipcRenderer.invoke("register_client", {
			serverUrl,
			name,
			requestedScopes: scopes,
		});
	},

	getAppVersion() {
		return ipcRenderer.invoke("get_app_version");
	},

	openDashboard(serverUrl: string) {
		return ipcRenderer.invoke("open_dashboard", { serverUrl });
	},

	readClipboard() {
		return ipcRenderer.invoke("clipboard_read");
	},

	writeClipboard(text: string) {
		return ipcRenderer.invoke("clipboard_write", { text });
	},

	startClipboardSync(config: {
		serverUrl: string;
		apiKey: string;
		scope?: string;
	}) {
		return ipcRenderer.invoke("clipboard_start_sync", config);
	},

	stopClipboardSync() {
		return ipcRenderer.invoke("clipboard_stop_sync");
	},

	onClipboardItemAdded(callback: () => void) {
		const handler = () => callback();
		ipcRenderer.on("clipboard-item-added", handler);
		return () => {
			ipcRenderer.removeListener("clipboard-item-added", handler);
		};
	},

	showNotification(payload: { title: string; body?: string }) {
		return ipcRenderer.invoke("show_notification", payload);
	},
});
