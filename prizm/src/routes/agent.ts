/**
 * Agent 路由 - 会话 CRUD 与流式对话
 */

import type { Router, Request, Response } from "express";
import type { IAgentAdapter } from "../adapters/interfaces";
import { toErrorResponse } from "../errors";
import { createLogger } from "../logger";
import {
	getScopeForCreate,
	requireScopeForList,
	getScopeForReadById,
	hasScopeAccess,
} from "../scopeUtils";
import { DEFAULT_SCOPE } from "../core/ScopeStore";

const log = createLogger("Agent");

function getScopeFromQuery(req: Request): string {
	const s = req.query.scope;
	return typeof s === "string" && s.trim() ? s.trim() : DEFAULT_SCOPE;
}

export function createAgentRoutes(
	router: Router,
	adapter?: IAgentAdapter
): void {
	if (!adapter) {
		log.warn("Agent adapter not provided, routes will return 503");
	}

	// GET /agent/sessions - 列出 scope 下会话
	router.get("/agent/sessions", async (req: Request, res: Response) => {
		try {
			if (!adapter?.listSessions) {
				return res.status(503).json({ error: "Agent adapter not available" });
			}

			const scope = requireScopeForList(req, res);
			if (!scope) return;

			const sessions = await adapter.listSessions(scope);
			res.json({ sessions });
		} catch (error) {
			log.error("list agent sessions error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// POST /agent/sessions - 创建会话
	router.post("/agent/sessions", async (req: Request, res: Response) => {
		try {
			if (!adapter?.createSession) {
				return res.status(503).json({ error: "Agent adapter not available" });
			}

			const scope = getScopeForCreate(req);
			const session = await adapter.createSession(scope);
			res.status(201).json({ session });
		} catch (error) {
			log.error("create agent session error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// GET /agent/sessions/:id - 获取会话及消息
	router.get("/agent/sessions/:id", async (req: Request, res: Response) => {
		try {
			if (!adapter?.getSession) {
				return res.status(503).json({ error: "Agent adapter not available" });
			}

			const { id } = req.params;
			const scope = getScopeFromQuery(req);
			if (!hasScopeAccess(req, scope)) {
				return res.status(403).json({ error: "scope access denied" });
			}

			const session = await adapter.getSession(scope, id);
			if (!session) {
				return res.status(404).json({ error: "Session not found" });
			}

			res.json({ session });
		} catch (error) {
			log.error("get agent session error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// DELETE /agent/sessions/:id - 删除会话
	router.delete("/agent/sessions/:id", async (req: Request, res: Response) => {
		try {
			if (!adapter?.deleteSession) {
				return res.status(503).json({ error: "Agent adapter not available" });
			}

			const { id } = req.params;
			const scope = getScopeFromQuery(req);
			if (!hasScopeAccess(req, scope)) {
				return res.status(403).json({ error: "scope access denied" });
			}

			await adapter.deleteSession(scope, id);
			res.status(204).send();
		} catch (error) {
			log.error("delete agent session error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// POST /agent/sessions/:id/chat - 发送消息，返回 SSE 流
	router.post(
		"/agent/sessions/:id/chat",
		async (req: Request, res: Response) => {
			try {
				if (!adapter?.chat || !adapter?.appendMessage) {
					return res.status(503).json({ error: "Agent adapter not available" });
				}

				const { id } = req.params;
				const scope = getScopeFromQuery(req);
				if (!hasScopeAccess(req, scope)) {
					return res.status(403).json({ error: "scope access denied" });
				}

				const session = await adapter.getSession?.(scope, id);
				if (!session) {
					return res.status(404).json({ error: "Session not found" });
				}

				const { content } = req.body ?? {};
				if (typeof content !== "string" || !content.trim()) {
					return res.status(400).json({ error: "content is required" });
				}

				const { model } = req.body ?? {};

				// 追加用户消息
				await adapter.appendMessage(scope, id, {
					role: "user",
					content: content.trim(),
				});

				// 构建消息历史
				const history = [
					...session.messages.map((m) => ({
						role: m.role,
						content: m.content,
					})),
					{ role: "user" as const, content: content.trim() },
				];

				// SSE 流式响应
				res.setHeader("Content-Type", "text/event-stream");
				res.setHeader("Cache-Control", "no-cache");
				res.setHeader("Connection", "keep-alive");
				res.flushHeaders?.();

				let fullContent = "";
				try {
					for await (const chunk of adapter.chat(scope, id, history, {
						model,
					})) {
						if (chunk.text) {
							fullContent += chunk.text;
							res.write(
								`data: ${JSON.stringify({
									type: "text",
									value: chunk.text,
								})}\n\n`
							);
						}
						if (chunk.done) {
							// 追加 assistant 消息
							await adapter.appendMessage(scope, id, {
								role: "assistant",
								content: fullContent,
								model,
							});
							res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
						}
					}
				} catch (err) {
					log.error("agent chat stream error:", err);
					res.write(
						`data: ${JSON.stringify({ type: "error", value: String(err) })}\n\n`
					);
				} finally {
					res.end();
				}
			} catch (error) {
				log.error("agent chat error:", error);
				const { status, body } = toErrorResponse(error);
				res.status(status).json(body);
			}
		}
	);

	// POST /agent/sessions/:id/stop - 停止当前生成（占位）
	router.post(
		"/agent/sessions/:id/stop",
		async (req: Request, res: Response) => {
			try {
				const { id } = req.params;
				const scope = getScopeFromQuery(req);
				if (!hasScopeAccess(req, scope)) {
					return res.status(403).json({ error: "scope access denied" });
				}
				// Phase 2: 实现取消逻辑
				res.json({ stopped: true });
			} catch (error) {
				log.error("agent stop error:", error);
				const { status, body } = toErrorResponse(error);
				res.status(status).json(body);
			}
		}
	);
}
