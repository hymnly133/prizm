import type { PrizmConfig, NotificationPayload } from "../types";
import { PrizmWebSocketClient } from "../websocket/connection";
import type {
	WebSocketConfig,
	WebSocketEventHandler,
	WebSocketEventType,
} from "../types";
import type {
	StickyNote,
	Task,
	PomodoroSession,
	ClipboardItem,
	Document,
	AgentSession,
	AgentMessage,
	StreamChatOptions,
} from "../types";

export interface PrizmClientOptions {
	/**
	 * 服务器基础地址，例如 http://127.0.0.1:4127
	 */
	baseUrl: string;
	/**
	 * API Key，用于访问受保护接口
	 */
	apiKey?: string;
	/**
	 * 默认 scope，不传则为 default
	 */
	defaultScope?: string;
}

interface HttpRequestOptions extends RequestInit {
	scope?: string;
}

export class PrizmClient {
	private readonly baseUrl: string;
	private readonly apiKey?: string;
	private readonly defaultScope: string;

	constructor(options: PrizmClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.apiKey = options.apiKey;
		this.defaultScope = options.defaultScope ?? "default";
	}

	// ============ WebSocket ============

	/**
	 * 基于 PrizmConfig 创建 WebSocket 客户端（快捷方式）
	 */
	createWebSocketClientFromConfig(config: PrizmConfig): PrizmWebSocketClient {
		const wsConfig: WebSocketConfig = {
			host: config.server.host,
			port: parseInt(config.server.port, 10),
			apiKey: config.api_key,
		};
		return new PrizmWebSocketClient(wsConfig);
	}

	/**
	 * 创建 WebSocket 客户端
	 */
	createWebSocketClient(config: WebSocketConfig): PrizmWebSocketClient {
		return new PrizmWebSocketClient(config);
	}

	// ============ HTTP 基础封装 ============

	private buildUrl(
		path: string,
		query?: Record<string, string | undefined>
	): string {
		const url = new URL(path, this.baseUrl);
		if (query) {
			for (const [key, value] of Object.entries(query)) {
				if (value !== undefined) {
					url.searchParams.set(key, value);
				}
			}
		}
		return url.toString();
	}

	private buildHeaders(): Headers {
		const headers = new Headers();
		headers.set("Content-Type", "application/json");
		if (this.apiKey) {
			headers.set("Authorization", `Bearer ${this.apiKey}`);
		}
		return headers;
	}

	private async request<T>(
		path: string,
		options: HttpRequestOptions = {}
	): Promise<T> {
		const { scope, ...init } = options;
		const normalizedPath = path.startsWith("/") ? path : `/${path}`;
		const method = (init.method ?? "GET").toUpperCase();

		let url: string;
		let body = init.body;
		if (scope !== undefined) {
			if (method === "GET" || method === "DELETE") {
				url = this.buildUrl(normalizedPath, { scope });
			} else {
				url = this.buildUrl(normalizedPath);
				if (body && typeof body === "string") {
					try {
						const parsed = JSON.parse(body) as Record<string, unknown>;
						parsed.scope = scope;
						body = JSON.stringify(parsed);
					} catch {
						// 非 JSON body 不添加 scope
					}
				} else if (body === undefined || body === null) {
					body = JSON.stringify({ scope });
				}
			}
		} else {
			url = this.buildUrl(normalizedPath);
		}

		const headers = this.buildHeaders();
		if (init.headers) {
			const extra = new Headers(init.headers as HeadersInit);
			extra.forEach((value, key) => {
				headers.set(key, value);
			});
		}

		const response = await fetch(url, {
			...init,
			body,
			headers,
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(
				`HTTP ${response.status} ${response.statusText}: ${
					text || "Request failed"
				}`
			);
		}

		// 某些 204 响应用不到 body
		if (response.status === 204) {
			return undefined as unknown as T;
		}

		return (await response.json()) as T;
	}

	// ============ Auth / Scopes ============

	async listScopes(): Promise<string[]> {
		const data = await this.request<{ scopes: string[] }>("/auth/scopes");
		return data.scopes ?? [];
	}

	/** 获取 scope 列表及说明（用于 UI 展示） */
	async listScopesWithInfo(): Promise<{
		scopes: string[];
		descriptions: Record<string, { label: string; description: string }>;
	}> {
		const data = await this.request<{
			scopes: string[];
			descriptions?: Record<string, { label: string; description: string }>;
		}>("/auth/scopes");
		return {
			scopes: data.scopes ?? [],
			descriptions: data.descriptions ?? {},
		};
	}

	// ============ Notes / Sticky Notes ============

	async listNotes(options?: {
		q?: string;
		groupId?: string;
		scope?: string;
	}): Promise<StickyNote[]> {
		const scope = options?.scope ?? this.defaultScope;
		const query: Record<string, string | undefined> = {
			q: options?.q,
			groupId: options?.groupId,
			scope,
		};
		const url = this.buildUrl("/notes", query);
		const response = await fetch(url, {
			method: "GET",
			headers: this.buildHeaders(),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(
				`HTTP ${response.status} ${response.statusText}: ${
					text || "Request failed"
				}`
			);
		}
		const data = (await response.json()) as { notes: StickyNote[] };
		return data.notes;
	}

	async getNote(id: string, scope?: string): Promise<StickyNote> {
		const data = await this.request<{ note: StickyNote }>(
			`/notes/${encodeURIComponent(id)}`,
			{
				method: "GET",
				scope,
			}
		);
		return data.note;
	}

	async createNote(
		payload: Partial<
			Pick<StickyNote, "content" | "imageUrls" | "groupId" | "fileRefs">
		>,
		scope?: string
	): Promise<StickyNote> {
		const data = await this.request<{ note: StickyNote }>("/notes", {
			method: "POST",
			scope,
			body: JSON.stringify(payload ?? {}),
		});
		return data.note;
	}

	async updateNote(
		id: string,
		payload: Partial<
			Pick<StickyNote, "content" | "imageUrls" | "groupId" | "fileRefs">
		>,
		scope?: string
	): Promise<StickyNote> {
		const data = await this.request<{ note: StickyNote }>(
			`/notes/${encodeURIComponent(id)}`,
			{
				method: "PATCH",
				scope,
				body: JSON.stringify(payload ?? {}),
			}
		);
		return data.note;
	}

	async deleteNote(id: string, scope?: string): Promise<void> {
		await this.request<void>(`/notes/${encodeURIComponent(id)}`, {
			method: "DELETE",
			scope,
		});
	}

	// ============ Tasks / TODO ============

	async listTasks(options?: {
		status?: string;
		dueBefore?: number;
		scope?: string;
	}): Promise<Task[]> {
		const scope = options?.scope ?? this.defaultScope;
		const query: Record<string, string | undefined> = {
			scope,
		};
		if (options?.status) {
			query.status = options.status;
		}
		if (typeof options?.dueBefore === "number") {
			query.due_before = String(options.dueBefore);
		}

		const url = this.buildUrl("/tasks", query);
		const response = await fetch(url, {
			method: "GET",
			headers: this.buildHeaders(),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(
				`HTTP ${response.status} ${response.statusText}: ${
					text || "Request failed"
				}`
			);
		}
		const data = (await response.json()) as { tasks: Task[] };
		return data.tasks;
	}

	async getTask(id: string, scope?: string): Promise<Task> {
		const data = await this.request<{ task: Task }>(
			`/tasks/${encodeURIComponent(id)}`,
			{
				method: "GET",
				scope,
			}
		);
		return data.task;
	}

	async createTask(
		payload: Omit<Task, "id" | "createdAt" | "updatedAt">,
		scope?: string
	): Promise<Task> {
		const data = await this.request<{ task: Task }>("/tasks", {
			method: "POST",
			scope,
			body: JSON.stringify(payload),
		});
		return data.task;
	}

	async updateTask(
		id: string,
		payload: Partial<Omit<Task, "id" | "createdAt">>,
		scope?: string
	): Promise<Task> {
		const data = await this.request<{ task: Task }>(
			`/tasks/${encodeURIComponent(id)}`,
			{
				method: "PATCH",
				scope,
				body: JSON.stringify(payload),
			}
		);
		return data.task;
	}

	async deleteTask(id: string, scope?: string): Promise<void> {
		await this.request<void>(`/tasks/${encodeURIComponent(id)}`, {
			method: "DELETE",
			scope,
		});
	}

	// ============ Pomodoro ============

	async startPomodoro(options?: {
		taskId?: string;
		tag?: string;
		scope?: string;
	}): Promise<PomodoroSession> {
		const data = await this.request<{ session: PomodoroSession }>(
			"/pomodoro/start",
			{
				method: "POST",
				scope: options?.scope,
				body: JSON.stringify({
					taskId: options?.taskId,
					tag: options?.tag,
				}),
			}
		);
		return data.session;
	}

	async stopPomodoro(id: string, scope?: string): Promise<PomodoroSession> {
		const data = await this.request<{ session: PomodoroSession }>(
			"/pomodoro/stop",
			{
				method: "POST",
				scope,
				body: JSON.stringify({ id }),
			}
		);
		return data.session;
	}

	async listPomodoroSessions(options?: {
		taskId?: string;
		from?: number;
		to?: number;
		scope?: string;
	}): Promise<PomodoroSession[]> {
		const query: Record<string, string | undefined> = {};
		if (options?.taskId) query.taskId = options.taskId;
		if (typeof options?.from === "number") query.from = String(options.from);
		if (typeof options?.to === "number") query.to = String(options.to);

		const url = this.buildUrl("/pomodoro/sessions", query);
		const response = await fetch(url, {
			method: "GET",
			headers: this.buildHeaders(),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(
				`HTTP ${response.status} ${response.statusText}: ${
					text || "Request failed"
				}`
			);
		}
		const data = (await response.json()) as { sessions: PomodoroSession[] };
		return data.sessions;
	}

	// ============ Notify ============

	async sendNotify(
		title: string,
		body?: string,
		scope?: string
	): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>("/notify", {
			method: "POST",
			scope,
			body: JSON.stringify({ title, body }),
		});
	}

	// ============ Clipboard ============

	async getClipboardHistory(options?: {
		limit?: number;
		scope?: string;
	}): Promise<ClipboardItem[]> {
		const query: Record<string, string | undefined> = {};
		if (typeof options?.limit === "number") {
			query.limit = String(options.limit);
		}
		const url = this.buildUrl("/clipboard/history", query);
		const response = await fetch(url, {
			method: "GET",
			headers: this.buildHeaders(),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(
				`HTTP ${response.status} ${response.statusText}: ${
					text || "Request failed"
				}`
			);
		}
		const data = (await response.json()) as { items: ClipboardItem[] };
		return data.items;
	}

	async addClipboardItem(
		item: Omit<ClipboardItem, "id">,
		scope?: string
	): Promise<ClipboardItem> {
		const data = await this.request<{ item: ClipboardItem }>("/clipboard", {
			method: "POST",
			scope,
			body: JSON.stringify(item),
		});
		return data.item;
	}

	async deleteClipboardItem(id: string, scope?: string): Promise<void> {
		await this.request<void>(`/clipboard/${encodeURIComponent(id)}`, {
			method: "DELETE",
			scope,
		});
	}

	// ============ Documents ============

	async listDocuments(options?: { scope?: string }): Promise<Document[]> {
		const scope = options?.scope ?? this.defaultScope;
		const url = this.buildUrl("/documents", { scope });
		const response = await fetch(url, {
			method: "GET",
			headers: this.buildHeaders(),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(
				`HTTP ${response.status} ${response.statusText}: ${
					text || "Request failed"
				}`
			);
		}
		const data = (await response.json()) as { documents: Document[] };
		return data.documents;
	}

	async getDocument(id: string, scope?: string): Promise<Document> {
		const data = await this.request<{ document: Document }>(
			`/documents/${encodeURIComponent(id)}`,
			{
				method: "GET",
				scope,
			}
		);
		return data.document;
	}

	async createDocument(
		payload: { title: string; content?: string },
		scope?: string
	): Promise<Document> {
		const data = await this.request<{ document: Document }>("/documents", {
			method: "POST",
			scope,
			body: JSON.stringify(payload),
		});
		return data.document;
	}

	async updateDocument(
		id: string,
		payload: Partial<Pick<Document, "title" | "content">>,
		scope?: string
	): Promise<Document> {
		const data = await this.request<{ document: Document }>(
			`/documents/${encodeURIComponent(id)}`,
			{
				method: "PATCH",
				scope,
				body: JSON.stringify(payload),
			}
		);
		return data.document;
	}

	async deleteDocument(id: string, scope?: string): Promise<void> {
		await this.request<void>(`/documents/${encodeURIComponent(id)}`, {
			method: "DELETE",
			scope,
		});
	}

	// ============ Agent 会话 ============

	async listAgentSessions(scope?: string): Promise<AgentSession[]> {
		const s = scope ?? this.defaultScope;
		const url = this.buildUrl("/agent/sessions", { scope: s });
		const response = await fetch(url, {
			method: "GET",
			headers: this.buildHeaders(),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(
				`HTTP ${response.status} ${response.statusText}: ${
					text || "Request failed"
				}`
			);
		}
		const data = (await response.json()) as { sessions: AgentSession[] };
		return data.sessions ?? [];
	}

	async createAgentSession(scope?: string): Promise<AgentSession> {
		const data = await this.request<{ session: AgentSession }>(
			"/agent/sessions",
			{
				method: "POST",
				scope: scope ?? this.defaultScope,
				body: JSON.stringify({}),
			}
		);
		return data.session;
	}

	async getAgentSession(id: string, scope?: string): Promise<AgentSession> {
		const s = scope ?? this.defaultScope;
		const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(id)}`, {
			scope: s,
		});
		const response = await fetch(url, {
			method: "GET",
			headers: this.buildHeaders(),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(
				`HTTP ${response.status} ${response.statusText}: ${
					text || "Request failed"
				}`
			);
		}
		const data = (await response.json()) as { session: AgentSession };
		return data.session;
	}

	async deleteAgentSession(id: string, scope?: string): Promise<void> {
		const s = scope ?? this.defaultScope;
		const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(id)}`, {
			scope: s,
		});
		const response = await fetch(url, {
			method: "DELETE",
			headers: this.buildHeaders(),
		});
		if (!response.ok && response.status !== 204) {
			const text = await response.text().catch(() => "");
			throw new Error(
				`HTTP ${response.status} ${response.statusText}: ${
					text || "Request failed"
				}`
			);
		}
	}

	/**
	 * 流式对话，消费 SSE 并逐块回调
	 */
	async streamChat(
		sessionId: string,
		content: string,
		options?: StreamChatOptions & { scope?: string }
	): Promise<string> {
		const scope = options?.scope ?? this.defaultScope;
		const url = this.buildUrl(
			`/agent/sessions/${encodeURIComponent(sessionId)}/chat`,
			{
				scope,
			}
		);

		const response = await fetch(url, {
			method: "POST",
			headers: this.buildHeaders(),
			body: JSON.stringify({
				content,
				model: options?.model,
			}),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(
				`HTTP ${response.status} ${response.statusText}: ${
					text || "Request failed"
				}`
			);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error("No response body");
		}

		const decoder = new TextDecoder();
		let buffer = "";
		let fullContent = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = line.slice(6);
						try {
							const parsed = JSON.parse(data) as {
								type: string;
								value?: string;
							};
							options?.onChunk?.(parsed);
							if (parsed.type === "text" && parsed.value) {
								fullContent += parsed.value;
							}
						} catch {
							// 忽略解析错误
						}
					}
				}
			}
		} finally {
			reader.releaseLock();
		}

		return fullContent;
	}

	async stopAgentChat(
		sessionId: string,
		scope?: string
	): Promise<{ stopped: boolean }> {
		const s = scope ?? this.defaultScope;
		const url = this.buildUrl(
			`/agent/sessions/${encodeURIComponent(sessionId)}/stop`,
			{
				scope: s,
			}
		);
		const response = await fetch(url, {
			method: "POST",
			headers: this.buildHeaders(),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(
				`HTTP ${response.status} ${response.statusText}: ${
					text || "Request failed"
				}`
			);
		}
		return (await response.json()) as { stopped: boolean };
	}
}
