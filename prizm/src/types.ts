/**
 * Prizm Server 类型定义
 * 这些类型与主应用兼容，但独立定义以避免循环依赖
 */

// ============ Sticky Notes / Notes 类型 ============

export interface StickyNoteFileRef {
	path: string;
}

/**
 * 兼容现有 StickyNote 结构的基础便签类型。
 *
 * 注意：
 * - 为了向后兼容，暂不在这里直接加入 title/tags/pinned 等字段
 * - 如果后续需要更丰富的 Note 形态，可以在不破坏现有字段的前提下扩展
 */
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

export interface CreateNotePayload {
	content?: string;
	imageUrls?: string[];
	groupId?: string;
	fileRefs?: StickyNoteFileRef[];
}

export interface UpdateNotePayload {
	content?: string;
	imageUrls?: string[];
	groupId?: string;
	fileRefs?: StickyNoteFileRef[];
}

// ============ Tasks / TODO 类型 ============

export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "low" | "medium" | "high";

export interface Task {
	id: string;
	title: string;
	description?: string;
	status: TaskStatus;
	priority: TaskPriority;
	/** 截止时间（时间戳，毫秒） */
	dueAt?: number;
	/** 可选关联的便签 ID */
	noteId?: string;
	createdAt: number;
	updatedAt: number;
}

// ============ 番茄钟会话类型 ============

export interface PomodoroSession {
	id: string;
	/** 可选关联的任务 ID */
	taskId?: string;
	/** 开始时间（时间戳，毫秒） */
	startedAt: number;
	/** 结束时间（时间戳，毫秒） */
	endedAt: number;
	/** 实际持续时长（分钟） */
	durationMinutes: number;
	/** 标签，例如 deep-work / review 等 */
	tag?: string;
}

// ============ 文档类型（正式信息文档） ============

export interface Document {
	id: string;
	/** 文档标题 */
	title: string;
	/** 文档正文内容（支持 Markdown） */
	content?: string;
	createdAt: number;
	updatedAt: number;
}

export interface CreateDocumentPayload {
	title: string;
	content?: string;
}

export interface UpdateDocumentPayload {
	title?: string;
	content?: string;
}

// ============ 剪贴板历史类型 ============

export type ClipboardItemType = "text" | "image" | "file" | "other";

export interface ClipboardItem {
	id: string;
	type: ClipboardItemType;
	/**
	 * 原始内容或内容预览。
	 * - 对于 text：为完整文本
	 * - 对于 image/file：可以是摘要或路径等
	 */
	content: string;
	/** 来源应用（可选） */
	sourceApp?: string;
	createdAt: number;
}

// ============ Agent 会话类型 ============

export interface AgentMessage {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	createdAt: number;
	model?: string;
	toolCalls?: unknown[];
}

export interface AgentSession {
	id: string;
	title?: string;
	scope: string;
	messages: AgentMessage[];
	createdAt: number;
	updatedAt: number;
}

// ============ Scope 与 Auth 类型 ============

export type Scope = string;

export interface ClientRecord {
	clientId: string;
	apiKeyHash: string;
	name: string;
	allowedScopes: string[];
	createdAt: number;
}

// ============ Server 配置 ============

export interface PrizmServerOptions {
	port?: number;
	host?: string;
	/** 数据目录，默认从 PRIZM_DATA_DIR 或 .prizm-data */
	dataDir?: string;
	enableCors?: boolean;
	/** 是否启用鉴权，默认 true；设为 false 时行为与旧版一致 */
	authEnabled?: boolean;
	/** 是否启用 WebSocket 服务器，默认 true */
	enableWebSocket?: boolean;
	/** WebSocket 路径，默认 '/ws' */
	websocketPath?: string;
}
