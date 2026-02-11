/**
 * Prizm WebSocket 上下文
 * 管理单个 WebSocket 连接的状态和事件注册
 */

import WebSocket from "ws";
import { createLogger } from "../logger";

const log = createLogger("WebSocketContext");
import type {
	ServerToClientMessage,
	WebSocketMessage,
	EventType,
} from "./types";

export class WebSocketContext {
	readonly id: string;
	readonly clientId: string;
	readonly allowedScopes: string[];
	readonly socket: WebSocket;

	private registeredEvents = new Set<EventType>();
	private currentScope: string = "default";

	constructor(
		id: string,
		clientId: string,
		allowedScopes: string[],
		socket: WebSocket
	) {
		this.id = id;
		this.clientId = clientId;
		this.allowedScopes = allowedScopes;
		this.socket = socket;
	}

	/**
	 * 注册事件
	 */
	registerEvent(eventType: EventType): void {
		this.registeredEvents.add(eventType);
	}

	/**
	 * 取消注册事件
	 */
	unregisterEvent(eventType: EventType): void {
		this.registeredEvents.delete(eventType);
	}

	/**
	 * 检查是否已注册某个事件
	 */
	hasEvent(eventType: EventType): boolean {
		return this.registeredEvents.has(eventType);
	}

	/**
	 * 获取所有已注册的事件类型
	 */
	getRegisteredEvents(): EventType[] {
		return Array.from(this.registeredEvents);
	}

	/**
	 * 发送消息到客户端
	 */
	send(data: ServerToClientMessage): boolean {
		if (this.socket.readyState !== WebSocket.OPEN) {
			return false;
		}

		try {
			this.socket.send(JSON.stringify(data));
			return true;
		} catch (error) {
			log.error("Failed to send to client", this.clientId, ":", error);
			return false;
		}
	}

	/**
	 * 获取当前 scope
	 */
	getCurrentScope(): string {
		return this.currentScope;
	}

	/**
	 * 设置当前 scope
	 */
	setCurrentScope(scope: string): void {
		this.currentScope = scope;
	}

	/**
	 * 检查是否有权限访问指定 scope
	 */
	hasScopePermission(scope: string): boolean {
		return (
			this.allowedScopes.includes("*") || this.allowedScopes.includes(scope)
		);
	}

	/**
	 * 关闭连接
	 */
	close(code?: number, reason?: string): void {
		if (this.socket.readyState === WebSocket.OPEN) {
			this.socket.close(code, reason);
		}
	}

	/**
	 * 检查连接是否活跃
	 */
	isOpen(): boolean {
		return this.socket.readyState === WebSocket.OPEN;
	}
}
