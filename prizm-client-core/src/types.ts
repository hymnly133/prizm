/**
 * Prizm Client Core - 客户端专用类型
 * 领域类型、Auth 类型从 @prizm/shared 导入
 */

import type { MessageUsage } from "@prizm/shared";

// 从 shared 重导出，供依赖 client-core 的包使用
export type {
	StickyNote,
	StickyNoteGroup,
	StickyNoteFileRef,
	CreateNotePayload,
	UpdateNotePayload,
	Task,
	TaskStatus,
	TaskPriority,
	PomodoroSession,
	ClipboardItem,
	ClipboardItemType,
	Document,
	AgentSession,
	AgentMessage,
	MessageUsage,
	NotificationPayload,
	ClientInfo,
	ScopeDescription,
} from "@prizm/shared";

export { ONLINE_SCOPE, EVENT_TYPES, ALL_EVENTS } from "@prizm/shared";
export type { EventType } from "@prizm/shared";

// ============ 客户端配置（仅 client-core） ============

export interface ServerConfig {
	host: string;
	port: string;
}

export interface ClientConfig {
	name: string;
	auto_register: string;
	requested_scopes: string[];
}

export interface TrayConfig {
	enabled: string;
	minimize_to_tray: string;
	show_notification: string;
}

export interface PrizmConfig {
	server: ServerConfig;
	client: ClientConfig;
	api_key: string;
	tray: TrayConfig;
	/** 需要弹出通知的事件类型 */
	notify_events?: import("@prizm/shared").EventType[];
}

// ============ WebSocket 配置与消息（仅 client-core） ============

export interface WebSocketConfig {
	host: string;
	port: number;
	apiKey: string;
	/** 订阅的事件类型，"all" 表示订阅全部已知事件，默认 ["notification"] */
	subscribeEvents?: string[] | "all";
}

export interface ConnectedMessage {
	type: "connected";
	clientId: string;
	serverTime: number;
}

export interface AuthenticatedMessage {
	type: "authenticated";
	clientId: string;
	allowedScopes: string[];
}

export interface RegisteredMessage {
	type: "registered";
	eventType: string;
}

export interface UnregisteredMessage {
	type: "unregistered";
	eventType: string;
}

export interface EventPushMessage<T = unknown> {
	type: "event";
	eventType: string;
	payload: T;
	scope?: string;
	timestamp: number;
}

export interface ErrorMessage {
	type: "error";
	code: string;
	message: string;
}

export type ServerMessage =
	| ConnectedMessage
	| AuthenticatedMessage
	| RegisteredMessage
	| UnregisteredMessage
	| EventPushMessage
	| ErrorMessage
	| { type: "pong" };

export interface RegisterEventMessage {
	type: "register";
	eventType: string;
	scope?: string;
}

export interface UnregisterEventMessage {
	type: "unregister";
	eventType: string;
}

export interface AuthMessage {
	type: "auth";
	apiKey: string;
}

export interface PingMessage {
	type: "ping";
}

export type ClientMessage =
	| AuthMessage
	| RegisterEventMessage
	| UnregisterEventMessage
	| PingMessage;

export interface EventPushPayload {
	eventType: string;
	payload: unknown;
}

export type WebSocketEventType =
	| "connected"
	| "disconnected"
	| "error"
	| "notification"
	| "event";

export interface WebSocketClientEventMap {
	connected: ConnectedMessage;
	disconnected: void;
	error: Error;
	notification: import("@prizm/shared").NotificationPayload;
	event: EventPushPayload;
}

export type WebSocketEventHandler<T extends WebSocketEventType> = (
	data: WebSocketClientEventMap[T]
) => void;

// ============ Agent 流式对话（仅 client-core） ============

/** SSE 流式 chunk：text 为文本片段，done 为结束（含 model、usage），error 为流式错误 */
export interface StreamChatChunk {
	type: string;
	value?: string;
	model?: string;
	usage?: MessageUsage;
	/** 是否因用户停止而提前结束 */
	stopped?: boolean;
}

export interface StreamChatOptions {
	model?: string;
	onChunk?: (chunk: StreamChatChunk) => void;
	/** 流式错误回调 */
	onError?: (message: string) => void;
	/** AbortSignal，用于前端主动取消流式请求 */
	signal?: AbortSignal;
}
