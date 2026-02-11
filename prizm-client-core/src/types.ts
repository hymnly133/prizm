/**
 * Prizm Client Core - 类型定义
 * 从原 Tauri 客户端抽取，供 Electron / 其他前端复用
 */

/** 语义 scope：用户实时上下文，用于常驻显示的 TODO 和便签 */
export const ONLINE_SCOPE = "online";

// ============ 配置结构 ============

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

/** 服务端支持的事件类型（与 server EVENT_TYPES 对应） */
export const EVENT_TYPES = [
	"notification",
	"smtc:change",
	"note:created",
	"note:updated",
	"note:deleted",
	"group:created",
	"group:updated",
	"group:deleted",
	"task:created",
	"task:updated",
	"task:deleted",
	"pomodoro:started",
	"pomodoro:stopped",
	"clipboard:itemAdded",
	"clipboard:itemDeleted",
	"document:created",
	"document:updated",
	"document:deleted",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** 服务端全部事件类型（用于 subscribeEvents: "all"） */
export const ALL_EVENTS: readonly string[] = [...EVENT_TYPES];

export interface PrizmConfig {
	server: ServerConfig;
	client: ClientConfig;
	api_key: string;
	tray: TrayConfig;
	/** 需要弹出通知的事件类型 */
	notify_events?: EventType[];
}

// ============ WebSocket 配置 ============

export interface WebSocketConfig {
	host: string;
	port: number;
	apiKey: string;
	/** 订阅的事件类型，"all" 表示订阅全部已知事件，默认 ["notification"] */
	subscribeEvents?: string[] | "all";
}

// ============ WebSocket 消息类型 ============

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

// ============ 事件载荷类型 ============

export interface NotificationPayload {
	title: string;
	body?: string;
}

// ============ WebSocket 客户端事件 ============

export type WebSocketEventType =
	| "connected"
	| "disconnected"
	| "error"
	| "notification"
	| "event";

export interface EventPushPayload {
	eventType: string;
	payload: unknown;
}

export interface WebSocketClientEventMap {
	connected: ConnectedMessage;
	disconnected: void;
	error: Error;
	notification: NotificationPayload;
	event: EventPushPayload;
}

export type WebSocketEventHandler<T extends WebSocketEventType> = (
	data: WebSocketClientEventMap[T]
) => void;

// ============ 领域数据类型（与服务器结构对齐的客户端视图） ============

export interface StickyNoteFileRef {
	path: string;
}

export interface StickyNote {
	id: string;
	content: string;
	imageUrls?: string[];
	createdAt: number;
	updatedAt: number;
	groupId?: string;
	fileRefs?: StickyNoteFileRef[];
}

export interface StickyNoteGroup {
	id: string;
	name: string;
}

export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "low" | "medium" | "high";

export interface Task {
	id: string;
	title: string;
	description?: string;
	status: TaskStatus;
	priority: TaskPriority;
	dueAt?: number;
	noteId?: string;
	createdAt: number;
	updatedAt: number;
}

export interface PomodoroSession {
	id: string;
	taskId?: string;
	startedAt: number;
	endedAt: number;
	durationMinutes: number;
	tag?: string;
}

export type ClipboardItemType = "text" | "image" | "file" | "other";

export interface ClipboardItem {
	id: string;
	type: ClipboardItemType;
	content: string;
	sourceApp?: string;
	createdAt: number;
}

// ============ 文档类型（正式信息文档） ============

export interface Document {
	id: string;
	title: string;
	content?: string;
	createdAt: number;
	updatedAt: number;
}
