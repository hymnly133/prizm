/**
 * Prizm Client Manager - 统一管理 HTTP + WebSocket 连接
 * 可复用的 Prizm 对接逻辑，供 Electron、Tauri、Web 等平台使用
 */

import type {
	PrizmConfig,
	NotificationPayload,
	EventPushPayload,
} from "./types";
import { ONLINE_SCOPE } from "./types";
import { PrizmClient } from "./http/client";
import { PrizmWebSocketClient } from "./websocket/connection";
import { buildServerUrl, formatEventToNotification } from "./utils";

/** 数据同步事件：便签/任务/剪贴板变更时触发，用于客户端实时刷新列表 */
export const DATA_SYNC_EVENTS = [
	"note:created",
	"note:updated",
	"note:deleted",
	"task:created",
	"task:updated",
	"task:deleted",
	"clipboard:itemAdded",
	"clipboard:itemDeleted",
	"document:created",
	"document:updated",
	"document:deleted",
] as const;

export interface PrizmClientManagerOptions {
	config: PrizmConfig;
	/** HTTP 请求默认 scope，用于 notes/tasks/clipboard 等。默认 "online" */
	defaultScope?: string;
	/** 向服务端订阅的事件类型，"all" 表示订阅全部已知事件；未指定时默认取 notifyEvents ∪ dataSyncEvents */
	subscribeEvents?: string[] | "all";
	/** 需要弹出通知的事件类型，默认取 config.notify_events。仅用于 onNotify 过滤，不决定订阅范围 */
	notifyEvents?: string[];
	/** 数据同步事件：收到会触发 onDataSync，用于实时刷新便签/任务列表。默认包含 note/task/clipboard 变更 */
	dataSyncEvents?: string[];
	/** 收到应通知的事件时回调（平台无关，由调用方实现弹窗） */
	onNotify?: (payload: NotificationPayload) => void | Promise<void>;
	/** 收到数据同步事件时回调，用于刷新便签/任务/剪贴板列表 */
	onDataSync?: (eventType: string) => void;
	/** 连接成功回调 */
	onConnected?: (msg: { clientId: string; serverTime: number }) => void;
	/** 连接断开回调 */
	onDisconnected?: () => void;
	/** 连接错误回调 */
	onError?: (error: Error) => void;
}

export class PrizmClientManager {
	private config: PrizmConfig;
	private defaultScope: string;
	private subscribeEventsOption: string[] | "all";
	private notifyEvents: string[];
	private dataSyncEvents: string[];
	private onNotify?: (payload: NotificationPayload) => void | Promise<void>;
	private onDataSync?: (eventType: string) => void;
	private onConnected?: (msg: { clientId: string; serverTime: number }) => void;
	private onDisconnected?: () => void;
	private onError?: (error: Error) => void;

	private httpClient: PrizmClient | null = null;
	private wsClient: PrizmWebSocketClient | null = null;

	constructor(options: PrizmClientManagerOptions) {
		this.config = options.config;
		this.defaultScope = options.defaultScope ?? ONLINE_SCOPE;
		this.subscribeEventsOption =
			options.subscribeEvents ??
			(() => {
				const notify = options.notifyEvents ??
					options.config.notify_events ?? ["notification"];
				const dataSync = options.dataSyncEvents ?? [...DATA_SYNC_EVENTS];
				return [...new Set([...notify, ...dataSync])];
			})();
		this.notifyEvents = options.notifyEvents ??
			options.config.notify_events ?? ["notification"];
		this.dataSyncEvents = options.dataSyncEvents ?? [...DATA_SYNC_EVENTS];
		this.onNotify = options.onNotify;
		this.onDataSync = options.onDataSync;
		this.onConnected = options.onConnected;
		this.onDisconnected = options.onDisconnected;
		this.onError = options.onError;
	}

	/**
	 * 获取服务器 URL
	 */
	getServerUrl(): string {
		return buildServerUrl(this.config.server.host, this.config.server.port);
	}

	/**
	 * 初始化 HTTP 客户端
	 */
	getHttpClient(): PrizmClient {
		if (!this.httpClient) {
			const baseUrl = this.getServerUrl();
			this.httpClient = new PrizmClient({
				baseUrl,
				apiKey: this.config.api_key,
				defaultScope: this.defaultScope,
			});
		}
		return this.httpClient;
	}

	/**
	 * 获取 WebSocket 客户端（连接后可用）
	 */
	getWsClient(): PrizmWebSocketClient | null {
		return this.wsClient;
	}

	/**
	 * 连接 WebSocket
	 */
	async connect(): Promise<void> {
		// 清理旧连接
		if (this.wsClient) {
			this.wsClient.disconnect();
			this.wsClient = null;
		}

		const wsClient = new PrizmWebSocketClient({
			host: this.config.server.host,
			port: parseInt(this.config.server.port, 10),
			apiKey: this.config.api_key,
			subscribeEvents: this.subscribeEventsOption,
		});

		// 通用事件：数据同步触发刷新，通知事件触发弹窗
		wsClient.on("event", (ev: EventPushPayload) => {
			if (this.dataSyncEvents.includes(ev.eventType)) {
				this.onDataSync?.(ev.eventType);
			}
			if (this.notifyEvents.includes(ev.eventType)) {
				const payload = formatEventToNotification(ev);
				this.onNotify?.(payload);
			}
		});

		wsClient.on("connected", (msg) => {
			this.onConnected?.(msg);
		});
		wsClient.on("disconnected", () => {
			this.onDisconnected?.();
		});
		wsClient.on("error", (err) => {
			this.onError?.(err);
		});

		this.wsClient = wsClient;
		await wsClient.connect();
	}

	/**
	 * 断开 WebSocket
	 */
	disconnect(): void {
		if (this.wsClient) {
			this.wsClient.disconnect();
			this.wsClient = null;
		}
	}

	/**
	 * 是否已连接
	 */
	isConnected(): boolean {
		return this.wsClient?.isConnected() ?? false;
	}

	/**
	 * 更新配置（用于热更新）
	 */
	updateConfig(config: Partial<PrizmConfig>): void {
		this.config = { ...this.config, ...config };
		if (config.notify_events) {
			this.notifyEvents = config.notify_events;
		}
		// HTTP 客户端下次 getHttpClient 时会用新 baseUrl，但已创建的实例不会更新
		// 若需热更新，可重置 httpClient
		if (config.server || config.api_key) {
			this.httpClient = null;
		}
	}

	/**
	 * 重新连接（使用当前 config）
	 */
	async reconnect(): Promise<void> {
		this.disconnect();
		await this.connect();
	}
}
