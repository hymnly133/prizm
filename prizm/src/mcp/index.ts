/**
 * Prizm MCP (Model Context Protocol) 服务器
 * 暴露本机统一上下文（便签、任务、剪贴板、文档）给 Agent 使用
 *
 * 连接方式：
 * - Cursor: 通过 stdio-bridge（见 MCP-CONFIG.md）或 HTTP/SSE
 * - LobeChat / Claude Desktop: HTTP/SSE 直连 http://127.0.0.1:4127/mcp
 *
 * Scope：通过 URL 查询参数 ?scope=xxx 指定，未传则用 PRIZM_MCP_SCOPE 或 online
 */

import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { PrizmAdapters } from "../adapters/interfaces";
import type { WebSocketServer } from "../websocket/WebSocketServer";
import { EVENT_TYPES } from "../websocket/types";
import { ONLINE_SCOPE } from "../core/ScopeStore";
import { getConfig } from "../config";

function createMcpServerWithTools(
	adapters: PrizmAdapters,
	scope: string,
	getWsServer?: () => WebSocketServer | undefined
): McpServer {
	const server = new McpServer(
		{ name: "prizm", version: "0.1.0" },
		{ capabilities: {} }
	);

	server.registerTool(
		"prizm_list_notes",
		{
			description: "列出 Prizm 便签",
			inputSchema: z.object({
				q: z.string().optional().describe("关键词过滤"),
			}),
		},
		async ({ q }) => {
			const notes = adapters.notes?.getAllNotes
				? await adapters.notes.getAllNotes(scope)
				: [];
			const filtered = q
				? notes.filter((n) => n.content.toLowerCase().includes(q.toLowerCase()))
				: notes;
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							filtered.map((n) => ({
								id: n.id,
								content: n.content.slice(0, 200),
								createdAt: n.createdAt,
							})),
							null,
							2
						),
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_create_note",
		{
			description: "在 Prizm 中创建便签",
			inputSchema: z.object({
				content: z.string().describe("便签内容"),
			}),
		},
		async ({ content }) => {
			if (!adapters.notes?.createNote) {
				return {
					content: [
						{ type: "text" as const, text: "Notes adapter not available" },
					],
					isError: true,
				};
			}
			const note = await adapters.notes.createNote(scope, { content });
			return {
				content: [
					{
						type: "text" as const,
						text: `Created note ${note.id}: ${note.content.slice(0, 100)}`,
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_get_note",
		{
			description: "根据 ID 获取单条便签详情",
			inputSchema: z.object({
				id: z.string().describe("便签 ID"),
			}),
		},
		async ({ id }) => {
			const note = adapters.notes?.getNoteById
				? await adapters.notes.getNoteById(scope, id)
				: null;
			if (!note) {
				return {
					content: [{ type: "text" as const, text: `Note not found: ${id}` }],
					isError: true,
				};
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								id: note.id,
								content: note.content,
								imageUrls: note.imageUrls,
								groupId: note.groupId,
								createdAt: note.createdAt,
								updatedAt: note.updatedAt,
							},
							null,
							2
						),
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_update_note",
		{
			description: "更新 Prizm 便签内容",
			inputSchema: z.object({
				id: z.string().describe("便签 ID"),
				content: z.string().optional().describe("便签内容"),
				groupId: z.string().optional().describe("分组 ID"),
			}),
		},
		async ({ id, content, groupId }) => {
			if (!adapters.notes?.updateNote) {
				return {
					content: [
						{ type: "text" as const, text: "Notes adapter not available" },
					],
					isError: true,
				};
			}
			const payload: { content?: string; groupId?: string } = {};
			if (content !== undefined) payload.content = content;
			if (groupId !== undefined) payload.groupId = groupId;
			const note = await adapters.notes.updateNote(scope, id, payload);
			return {
				content: [
					{
						type: "text" as const,
						text: `Updated note ${note.id}`,
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_delete_note",
		{
			description: "删除 Prizm 便签",
			inputSchema: z.object({
				id: z.string().describe("便签 ID"),
			}),
		},
		async ({ id }) => {
			if (!adapters.notes?.deleteNote) {
				return {
					content: [
						{ type: "text" as const, text: "Notes adapter not available" },
					],
					isError: true,
				};
			}
			await adapters.notes.deleteNote(scope, id);
			return {
				content: [{ type: "text" as const, text: `Deleted note ${id}` }],
			};
		}
	);

	server.registerTool(
		"prizm_search_notes",
		{
			description: "搜索 Prizm 便签内容",
			inputSchema: z.object({
				query: z.string().describe("搜索关键词"),
			}),
		},
		async ({ query }) => {
			const notes = adapters.notes?.getAllNotes
				? await adapters.notes.getAllNotes(scope)
				: [];
			const kw = query.toLowerCase();
			const matched = notes.filter((n) => n.content.toLowerCase().includes(kw));
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							matched.map((n) => ({
								id: n.id,
								content: n.content,
								createdAt: n.createdAt,
							})),
							null,
							2
						),
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_list_tasks",
		{
			description: "列出 Prizm 任务/TODO",
			inputSchema: z.object({
				status: z
					.enum(["todo", "doing", "done"])
					.optional()
					.describe("按状态过滤"),
			}),
		},
		async ({ status }) => {
			const tasks = adapters.tasks?.getAllTasks
				? await adapters.tasks.getAllTasks(scope, { status })
				: [];
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							tasks.map((t) => ({
								id: t.id,
								title: t.title,
								status: t.status,
								priority: t.priority,
								dueAt: t.dueAt,
							})),
							null,
							2
						),
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_create_task",
		{
			description: "在 Prizm 中创建任务",
			inputSchema: z.object({
				title: z.string().describe("任务标题"),
				description: z.string().optional(),
				priority: z.enum(["low", "medium", "high"]).optional(),
			}),
		},
		async ({ title, description, priority }) => {
			if (!adapters.tasks?.createTask) {
				return {
					content: [
						{ type: "text" as const, text: "Tasks adapter not available" },
					],
					isError: true,
				};
			}
			const task = await adapters.tasks.createTask(scope, {
				title,
				description: description ?? "",
				status: "todo",
				priority: (priority as "low" | "medium" | "high") ?? "medium",
			});
			return {
				content: [
					{
						type: "text" as const,
						text: `Created task ${task.id}: ${task.title}`,
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_update_task",
		{
			description: "更新 Prizm 任务（状态、标题、优先级等）",
			inputSchema: z.object({
				id: z.string().describe("任务 ID"),
				status: z.enum(["todo", "doing", "done"]).optional(),
				title: z.string().optional(),
				priority: z.enum(["low", "medium", "high"]).optional(),
			}),
		},
		async ({ id, status, title, priority }) => {
			if (!adapters.tasks?.updateTask) {
				return {
					content: [
						{ type: "text" as const, text: "Tasks adapter not available" },
					],
					isError: true,
				};
			}
			const payload: Record<string, unknown> = {};
			if (status) payload.status = status;
			if (title) payload.title = title;
			if (priority) payload.priority = priority;
			const task = await adapters.tasks.updateTask(scope, id, payload);
			return {
				content: [
					{
						type: "text" as const,
						text: `Updated task ${task.id}: status=${task.status}`,
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_get_task",
		{
			description: "根据 ID 获取单条任务详情",
			inputSchema: z.object({
				id: z.string().describe("任务 ID"),
			}),
		},
		async ({ id }) => {
			const task = adapters.tasks?.getTaskById
				? await adapters.tasks.getTaskById(scope, id)
				: null;
			if (!task) {
				return {
					content: [{ type: "text" as const, text: `Task not found: ${id}` }],
					isError: true,
				};
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								id: task.id,
								title: task.title,
								description: task.description,
								status: task.status,
								priority: task.priority,
								dueAt: task.dueAt,
								createdAt: task.createdAt,
								updatedAt: task.updatedAt,
							},
							null,
							2
						),
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_delete_task",
		{
			description: "删除 Prizm 任务",
			inputSchema: z.object({
				id: z.string().describe("任务 ID"),
			}),
		},
		async ({ id }) => {
			if (!adapters.tasks?.deleteTask) {
				return {
					content: [
						{ type: "text" as const, text: "Tasks adapter not available" },
					],
					isError: true,
				};
			}
			await adapters.tasks.deleteTask(scope, id);
			return {
				content: [{ type: "text" as const, text: `Deleted task ${id}` }],
			};
		}
	);

	server.registerTool(
		"prizm_list_documents",
		{
			description: "列出 Prizm 文档（正式信息文档）",
			inputSchema: z.object({
				q: z.string().optional().describe("关键词过滤标题或内容"),
			}),
		},
		async ({ q }) => {
			const docs = adapters.documents?.getAllDocuments
				? await adapters.documents.getAllDocuments(scope)
				: [];
			const filtered = q
				? docs.filter(
						(d) =>
							(d.title || "").toLowerCase().includes(q.toLowerCase()) ||
							(d.content || "").toLowerCase().includes(q.toLowerCase())
				  )
				: docs;
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							filtered.map((d) => ({
								id: d.id,
								title: d.title,
								content: (d.content ?? "").slice(0, 200),
								createdAt: d.createdAt,
							})),
							null,
							2
						),
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_create_document",
		{
			description: "在 Prizm 中创建文档",
			inputSchema: z.object({
				title: z.string().describe("文档标题"),
				content: z.string().optional().describe("文档正文内容，支持 Markdown"),
			}),
		},
		async ({ title, content }) => {
			if (!adapters.documents?.createDocument) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Documents adapter not available",
						},
					],
					isError: true,
				};
			}
			const doc = await adapters.documents.createDocument(scope, {
				title,
				content,
			});
			return {
				content: [
					{
						type: "text" as const,
						text: `Created document ${doc.id}: ${doc.title}`,
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_get_document",
		{
			description: "根据 ID 获取单条文档详情",
			inputSchema: z.object({
				id: z.string().describe("文档 ID"),
			}),
		},
		async ({ id }) => {
			const doc = adapters.documents?.getDocumentById
				? await adapters.documents.getDocumentById(scope, id)
				: null;
			if (!doc) {
				return {
					content: [
						{ type: "text" as const, text: `Document not found: ${id}` },
					],
					isError: true,
				};
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								id: doc.id,
								title: doc.title,
								content: doc.content,
								createdAt: doc.createdAt,
								updatedAt: doc.updatedAt,
							},
							null,
							2
						),
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_update_document",
		{
			description: "更新 Prizm 文档",
			inputSchema: z.object({
				id: z.string().describe("文档 ID"),
				title: z.string().optional().describe("文档标题"),
				content: z.string().optional().describe("文档正文，支持 Markdown"),
			}),
		},
		async ({ id, title, content }) => {
			if (!adapters.documents?.updateDocument) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Documents adapter not available",
						},
					],
					isError: true,
				};
			}
			const payload: { title?: string; content?: string } = {};
			if (title !== undefined) payload.title = title;
			if (content !== undefined) payload.content = content;
			const doc = await adapters.documents.updateDocument(scope, id, payload);
			return {
				content: [
					{
						type: "text" as const,
						text: `Updated document ${doc.id}: ${doc.title}`,
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_delete_document",
		{
			description: "删除 Prizm 文档",
			inputSchema: z.object({
				id: z.string().describe("文档 ID"),
			}),
		},
		async ({ id }) => {
			if (!adapters.documents?.deleteDocument) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Documents adapter not available",
						},
					],
					isError: true,
				};
			}
			await adapters.documents.deleteDocument(scope, id);
			return {
				content: [{ type: "text" as const, text: `Deleted document ${id}` }],
			};
		}
	);

	server.registerTool(
		"prizm_get_clipboard",
		{
			description: "获取 Prizm 剪贴板历史",
			inputSchema: z.object({
				limit: z.number().optional().default(10),
			}),
		},
		async ({ limit }) => {
			const items = adapters.clipboard?.getHistory
				? await adapters.clipboard.getHistory(scope, { limit })
				: [];
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							items.map((c) => ({
								id: c.id,
								type: c.type,
								content: c.content.slice(0, 200),
								createdAt: c.createdAt,
							})),
							null,
							2
						),
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_add_clipboard_item",
		{
			description: "向 Prizm 剪贴板历史新增一条记录",
			inputSchema: z.object({
				type: z.enum(["text", "image"]).optional().default("text"),
				content: z.string().describe("剪贴板内容"),
			}),
		},
		async ({ type, content }) => {
			if (!adapters.clipboard?.addItem) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Clipboard adapter not available",
						},
					],
					isError: true,
				};
			}
			const item = await adapters.clipboard.addItem(scope, {
				type,
				content,
				createdAt: Date.now(),
			});
			return {
				content: [
					{
						type: "text" as const,
						text: `Added clipboard item ${item.id}`,
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_get_clipboard_item",
		{
			description: "根据 ID 获取单条剪贴板历史记录",
			inputSchema: z.object({
				id: z.string().describe("剪贴板记录 ID"),
			}),
		},
		async ({ id }) => {
			const items = adapters.clipboard?.getHistory
				? await adapters.clipboard.getHistory(scope, { limit: 500 })
				: [];
			const item = items.find((c) => c.id === id);
			if (!item) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Clipboard item not found: ${id}`,
						},
					],
					isError: true,
				};
			}
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								id: item.id,
								type: item.type,
								content: item.content,
								createdAt: item.createdAt,
							},
							null,
							2
						),
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_delete_clipboard_item",
		{
			description: "删除 Prizm 剪贴板历史中的一条记录",
			inputSchema: z.object({
				id: z.string().describe("剪贴板记录 ID"),
			}),
		},
		async ({ id }) => {
			if (!adapters.clipboard?.deleteItem) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Clipboard adapter not available",
						},
					],
					isError: true,
				};
			}
			await adapters.clipboard.deleteItem(scope, id);
			return {
				content: [
					{
						type: "text" as const,
						text: `Deleted clipboard item ${id}`,
					},
				],
			};
		}
	);

	server.registerTool(
		"prizm_notice",
		{
			description:
				"主动发送通知到已连接的客户端（Electron 等），Agent 完成操作后可通知用户",
			inputSchema: z.object({
				title: z.string().describe("通知标题"),
				body: z.string().optional().describe("通知正文"),
			}),
		},
		async ({ title, body }) => {
			const ws = getWsServer?.();
			if (ws) {
				ws.broadcast(EVENT_TYPES.NOTIFICATION, { title, body }, undefined);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: `Notification sent: ${title}`,
					},
				],
			};
		}
	);

	return server;
}

const transports = new Map<string, StreamableHTTPServerTransport>();

/**
 * 挂载 MCP 路由到 Express 应用
 * 路径: POST /mcp, GET /mcp (SSE)
 * 鉴权：沿用全局 auth 中间件，客户端需传 Authorization: Bearer <api_key>
 */
export function mountMcpRoutes(
	app: Express,
	adapters: PrizmAdapters,
	getWsServer?: () => WebSocketServer | undefined
): void {
	const handler = async (req: Request, res: Response): Promise<void> => {
		const sessionId = req.headers["mcp-session-id"] as string | undefined;

		if (sessionId && transports.has(sessionId)) {
			const transport = transports.get(sessionId)!;
			await transport.handleRequest(req, res, req.body);
			return;
		}

		if (!sessionId && req.body && isInitializeRequest(req.body)) {
			const transportRef: { t?: StreamableHTTPServerTransport } = {};
			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => randomUUID(),
				onsessioninitialized: (sid: string): void => {
					if (transportRef.t) transports.set(sid, transportRef.t);
				},
			});
			transportRef.t = transport;

			const scope =
				(typeof req.query.scope === "string" ? req.query.scope.trim() : null) ||
				getConfig().mcpScope ||
				ONLINE_SCOPE;
			const mcpServer = createMcpServerWithTools(adapters, scope, getWsServer);
			await mcpServer.connect(transport);
			await transport.handleRequest(req, res, req.body);
			return;
		}

		res.status(400).json({ error: "Invalid MCP request" });
	};

	app.post("/mcp", (req: Request, res: Response) => void handler(req, res));
	// GET 用于 SSE 被动流：客户端需带 Mcp-Session-Id（初始化后由 POST 响应返回）
	app.get("/mcp", (req: Request, res: Response) => void handler(req, res));
}
