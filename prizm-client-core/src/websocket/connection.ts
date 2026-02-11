/**
 * Prizm WebSocket 客户端连接（可复用核心 SDK）
 */

import { ALL_EVENTS } from "../types";
import type {
	ServerMessage,
	ClientMessage,
	WebSocketConfig,
	WebSocketEventType,
	WebSocketEventHandler,
	NotificationPayload,
	EventPushMessage,
	WebSocketClientEventMap,
	RegisterEventMessage,
	UnregisterEventMessage,
} from "../types";

export class PrizmWebSocketClient {
	private ws: WebSocket | null = null;
	private config: WebSocketConfig;
	private reconnectTimer: number | null = null;
	private eventHandlers = new Map<
		WebSocketEventType,
		Set<WebSocketEventHandler<WebSocketEventType>>
	>();
	private manualDisconnect = false;

	constructor(config: WebSocketConfig) {
		this.config = config;
	}

	/**
	 * 连接到 WebSocket 服务器
	 */
	async connect(): Promise<void> {
		const wsUrl = `ws://${this.config.host}:${
			this.config.port
		}/ws?apiKey=${encodeURIComponent(this.config.apiKey)}`;
		console.log(`[PrizmClient] Connecting to ${wsUrl}`);

		return new Promise((resolve, reject) => {
			this.manualDisconnect = false;

			try {
				this.ws = new WebSocket(wsUrl);
			} catch (error) {
				console.error("[PrizmClient] Failed to create WebSocket:", error);
				reject(error);
				return;
			}

			this.ws.onopen = () => {
				console.log(
					"[PrizmClient] WebSocket handshake complete, waiting for server auth..."
				);
				const events =
					this.config.subscribeEvents === "all"
						? [...ALL_EVENTS]
						: this.config.subscribeEvents ?? ["notification"];
				for (const eventType of events) {
					this.registerEvent(eventType);
				}
				resolve();
			};

			this.ws.onmessage = (event: MessageEvent) => {
				this.handleMessage(event.data as string);
			};

			this.ws.onclose = (event: CloseEvent) => {
				console.log(
					`[PrizmClient] WebSocket closed: ${event.code} - ${event.reason}`
				);

				if (!this.manualDisconnect) {
					this.emit("disconnected", undefined as unknown as void);
					this.scheduleReconnect();
				}

				this.ws = null;
			};

			this.ws.onerror = (error: Event) => {
				console.error("[PrizmClient] WebSocket error:", error);
				this.emit("error", error as unknown as Error);
				reject(error as unknown as Error);
			};
		});
	}

	/**
	 * 处理服务器消息
	 */
	private handleMessage(data: string): void {
		try {
			const message = JSON.parse(data) as ServerMessage;

			switch (message.type) {
				case "connected": {
					const connectedMsg = message as {
						type: "connected";
						clientId: string;
						serverTime: number;
					};
					console.log(
						"[PrizmClient] Server acknowledged connection:",
						connectedMsg.clientId
					);
					this.emit("connected", connectedMsg);
					break;
				}

				case "registered":
					console.log(
						`[PrizmClient] Registered for event: ${
							(message as any).eventType as string
						}`
					);
					break;

				case "unregistered":
					console.log(
						`[PrizmClient] Unregistered from event: ${
							(message as any).eventType as string
						}`
					);
					break;

				case "event":
					this.handleEventPush(
						message as EventPushMessage<NotificationPayload>
					);
					break;

				case "error":
					console.error(
						`[PrizmClient] Server error [${(message as any).code}]: ${
							(message as any).message
						}`
					);
					break;

				case "pong":
					// 心跳响应
					break;
			}
		} catch (error) {
			console.error("[PrizmClient] Failed to parse message:", error);
		}
	}

	/**
	 * 处理事件推送
	 */
	private handleEventPush(
		message: EventPushMessage<NotificationPayload>
	): void {
		const { eventType, payload } = message;
		// 通用事件：供客户端根据 notify_events 决定是否弹窗
		this.emit("event", { eventType, payload });
		// 兼容：notification 事件单独发出
		if (eventType === "notification") {
			const p = payload as NotificationPayload;
			this.emit("notification", p);
		}
	}

	/**
	 * 注册事件
	 */
	registerEvent(eventType: string): void {
		const message: RegisterEventMessage = {
			type: "register",
			eventType,
		};
		this.send(message);
	}

	/**
	 * 取消注册事件
	 */
	unregisterEvent(eventType: string): void {
		const message: UnregisterEventMessage = {
			type: "unregister",
			eventType,
		};
		this.send(message);
	}

	/**
	 * 批量订阅事件（运行时动态订阅）
	 */
	subscribeEvents(events: string[]): void {
		for (const eventType of events) {
			this.registerEvent(eventType);
		}
	}

	/**
	 * 批量退订事件（运行时动态退订）
	 */
	unsubscribeEvents(events: string[]): void {
		for (const eventType of events) {
			this.unregisterEvent(eventType);
		}
	}

	/**
	 * 发送 Ping
	 */
	ping(): void {
		this.send({ type: "ping" });
	}

	/**
	 * 发送消息
	 */
	private send(data: ClientMessage): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.warn(
				"[PrizmClient] WebSocket not connected, cannot send message"
			);
			return;
		}

		try {
			this.ws.send(JSON.stringify(data));
		} catch (error) {
			console.error("[PrizmClient] Failed to send message:", error);
		}
	}

	/**
	 * 注册事件处理器
	 */
	on<T extends WebSocketEventType>(
		eventType: T,
		handler: WebSocketEventHandler<T>
	): void {
		if (!this.eventHandlers.has(eventType)) {
			this.eventHandlers.set(eventType, new Set());
		}
		this.eventHandlers.get(eventType)!.add(handler as any);
	}

	/**
	 * 移除事件处理器
	 */
	off<T extends WebSocketEventType>(
		eventType: T,
		handler: WebSocketEventHandler<T>
	): void {
		const handlers = this.eventHandlers.get(eventType);
		if (handlers) {
			handlers.delete(handler as any);
		}
	}

	/**
	 * 触发事件
	 */
	private emit<T extends WebSocketEventType>(
		eventType: T,
		data: WebSocketClientEventMap[T]
	): void {
		const handlers = this.eventHandlers.get(eventType);
		if (handlers) {
			for (const handler of handlers) {
				try {
					(handler as WebSocketEventHandler<T>)(data);
				} catch (error) {
					console.error(`[PrizmClient] Error in ${eventType} handler:`, error);
				}
			}
		}
	}

	/**
	 * 计划重连
	 */
	private scheduleReconnect(): void {
		if (this.reconnectTimer) {
			return;
		}

		console.log("[PrizmClient] Scheduling reconnect in 5 seconds...");
		this.reconnectTimer = setTimeout(() => {
			console.log("[PrizmClient] Reconnecting...");
			this.connect().catch(console.error);
			this.reconnectTimer = null;
		}, 5000) as unknown as number;
	}

	/**
	 * 断开连接
	 */
	disconnect(): void {
		this.manualDisconnect = true;

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}

		console.log("[PrizmClient] Disconnected");
	}

	/**
	 * 检查连接状态
	 */
	isConnected(): boolean {
		return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
	}
}
