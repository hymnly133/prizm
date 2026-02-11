/**
 * Prizm 连接管理
 */
import { ref, shallowRef } from "vue";
import {
	PrizmClientManager,
	buildServerUrl,
	ONLINE_SCOPE,
} from "@prizm/client-core";
import type {
	PrizmConfig,
	NotificationPayload,
	StickyNote,
	Task,
	ClipboardItem,
	PomodoroSession,
} from "@prizm/client-core";

export const status = ref<
	"connected" | "disconnected" | "error" | "connecting"
>("disconnected");
export const config = ref<PrizmConfig | null>(null);
/** 使用 HMR data 持久化 ref，避免热重载时丢失对旧 manager 的引用导致重复连接 */
export const manager = (() => {
	if (typeof import.meta !== "undefined" && import.meta.hot?.data?.managerRef) {
		return import.meta.hot.data.managerRef as ReturnType<
			typeof shallowRef<PrizmClientManager | null>
		>;
	}
	const ref = shallowRef<PrizmClientManager | null>(null);
	if (typeof import.meta !== "undefined" && import.meta.hot) {
		import.meta.hot.data.managerRef = ref;
	}
	return ref;
})();
export const activePomodoroId = ref<string | null>(null);
/** 数据同步事件，供各 Tab 监听刷新 */
export const lastSyncEvent = ref<string | null>(null);

export function showNotification(title: string, body?: string): void {
	// 由 Logs composable 处理
}

export async function loadConfig(): Promise<PrizmConfig | null> {
	try {
		const c = await window.prizm.loadConfig();
		config.value = c;
		return c;
	} catch {
		return null;
	}
}

export async function saveConfig(cfg: PrizmConfig): Promise<boolean> {
	try {
		return await window.prizm.saveConfig(cfg);
	} catch {
		return false;
	}
}

export async function testConnection(serverUrl: string): Promise<boolean> {
	try {
		return await window.prizm.testConnection(serverUrl);
	} catch {
		return false;
	}
}

export async function registerClient(
	serverUrl: string,
	clientName: string,
	scopes: string[]
): Promise<string | null> {
	try {
		status.value = "connecting";
		const apiKey = await window.prizm.registerClient(
			serverUrl,
			clientName,
			scopes
		);
		if (apiKey) return apiKey;
		throw new Error("注册失败");
	} catch {
		status.value = "error";
		return null;
	}
}

export async function initializePrizm(
	cfg: PrizmConfig,
	opt: {
		onLog: (
			msg: string,
			type: "info" | "success" | "error" | "warning"
		) => void;
		onNotify: (payload: NotificationPayload) => void;
	}
): Promise<void> {
	try {
		if (manager.value) {
			manager.value.disconnect();
		}

		const m = new PrizmClientManager({
			config: cfg,
			subscribeEvents: "all",
			notifyEvents: cfg.notify_events ?? ["notification"],
			onNotify: (payload: NotificationPayload) => {
				opt.onNotify(payload);
				void window.prizm.showNotification({
					title: payload.title ?? "通知",
					body: payload.body,
				});
			},
			onDataSync: (eventType: string) => {
				lastSyncEvent.value = eventType;
			},
			onConnected: (msg: { clientId: string }) => {
				status.value = "connected";
				opt.onLog(`WebSocket 已连接 - Client ID: ${msg.clientId}`, "success");
				if (config.value) {
					void window.prizm.startClipboardSync({
						serverUrl: buildServerUrl(
							config.value.server.host,
							config.value.server.port
						),
						apiKey: config.value.api_key,
						scope: ONLINE_SCOPE,
					});
				}
			},
			onDisconnected: () => {
				status.value = "disconnected";
				opt.onLog("WebSocket 已断开连接", "warning");
				void window.prizm.stopClipboardSync();
			},
			onError: (error: Error) => {
				status.value = "error";
				opt.onLog(`错误: ${error.message}`, "error");
			},
		});

		manager.value = m;
		await m.connect();
	} catch (error) {
		status.value = "error";
		opt.onLog(`初始化失败: ${String(error)}`, "error");
		throw error;
	}
}

// 类型导出供组件使用
export type { PrizmConfig, StickyNote, Task, ClipboardItem, PomodoroSession };
