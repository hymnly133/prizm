/**
 * 领域数据类型 - 与服务器 API 结构对齐
 */

// ============ 便签 ============

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

// ============ 任务 ============

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

// ============ 番茄钟 ============

export interface PomodoroSession {
	id: string;
	taskId?: string;
	startedAt: number;
	endedAt: number;
	durationMinutes: number;
	tag?: string;
}

// ============ 剪贴板 ============

export type ClipboardItemType = "text" | "image" | "file" | "other";

export interface ClipboardItem {
	id: string;
	type: ClipboardItemType;
	content: string;
	sourceApp?: string;
	createdAt: number;
}

// ============ 文档 ============

export interface Document {
	id: string;
	title: string;
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

// ============ Agent ============

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

// ============ 通知 ============

export interface NotificationPayload {
	title: string;
	body?: string;
}
