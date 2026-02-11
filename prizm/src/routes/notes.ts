/**
 * Sticky Notes 路由
 */

import type { Router, Request, Response } from "express";
import type { IStickyNotesAdapter } from "../adapters/interfaces";
import { EVENT_TYPES } from "../websocket/types";
import { toErrorResponse } from "../errors";
import { createLogger } from "../logger";
import {
	getScopeForCreate,
	requireScopeForList,
	getScopeForReadById,
	findAcrossScopes,
} from "../scopeUtils";

const log = createLogger("Notes");

export function createNotesRoutes(
	router: Router,
	adapter?: IStickyNotesAdapter
): void {
	if (!adapter) {
		log.warn("Notes adapter not provided, routes will return 503");
	}

	// GET /notes - 获取所有便签（支持简单过滤），scope 必填 ?scope=xxx
	router.get("/notes", async (req: Request, res: Response) => {
		try {
			if (!adapter?.getAllNotes) {
				return res.status(503).json({ error: "Notes adapter not available" });
			}

			const scope = requireScopeForList(req, res);
			if (!scope) return;
			const notes = await adapter.getAllNotes(scope);

			const { q, groupId } = req.query;
			let filtered = notes;

			// 按分组过滤
			if (typeof groupId === "string" && groupId.length > 0) {
				filtered = filtered.filter((n) => n.groupId === groupId);
			}

			// 按内容关键字过滤
			if (typeof q === "string" && q.length > 0) {
				const keyword = q.toLowerCase();
				filtered = filtered.filter((n) =>
					n.content.toLowerCase().includes(keyword)
				);
			}
			res.json({ notes: filtered });
		} catch (error) {
			log.error("get all notes error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// ========== 分组路由（必须在 /notes/:id 之前定义）==========

	// GET /notes/groups - 获取所有分组，scope 必填 ?scope=xxx
	router.get("/notes/groups", async (req: Request, res: Response) => {
		try {
			if (!adapter?.getAllGroups) {
				return res.status(503).json({ error: "Notes adapter not available" });
			}

			const scope = requireScopeForList(req, res);
			if (!scope) return;
			const groups = await adapter.getAllGroups(scope);
			res.json({ groups });
		} catch (error) {
			log.error("get all groups error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// POST /notes/groups - 创建分组，scope 可选 body.scope，默认 default
	router.post("/notes/groups", async (req: Request, res: Response) => {
		try {
			if (!adapter?.createGroup) {
				return res.status(503).json({ error: "Notes adapter not available" });
			}

			const { name } = req.body;
			if (!name) {
				return res.status(400).json({ error: "name is required" });
			}

			const scope = getScopeForCreate(req);
			const group = await adapter.createGroup(scope, name);
			res.status(201).json({ group });
		} catch (error) {
			log.error("create group error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// PATCH /notes/groups/:id - 更新分组，scope 可选 query，未提供则跨 scope 查找
	router.patch("/notes/groups/:id", async (req: Request, res: Response) => {
		try {
			if (!adapter?.updateGroup) {
				return res.status(503).json({ error: "Notes adapter not available" });
			}
			const a = adapter;

			const { id } = req.params;
			const { name } = req.body;

			if (!name) {
				return res.status(400).json({ error: "name is required" });
			}

			const scopeHint = getScopeForReadById(req);
			let scope: string;
			if (scopeHint) {
				scope = scopeHint;
			} else {
				if (!a.getAllGroups) {
					return res.status(503).json({ error: "Notes adapter not available" });
				}
				const found = await findAcrossScopes(req, async (s) => {
					const groups = await a.getAllGroups!(s);
					return groups.find((x) => x.id === id) ?? null;
				});
				if (!found) {
					return res.status(404).json({ error: "Group not found" });
				}
				scope = found.scope;
			}
			const group = await a.updateGroup!(scope, id, name);
			res.json({ group });
		} catch (error) {
			log.error("update group error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// DELETE /notes/groups/:id - 删除分组，scope 可选，未提供则跨 scope 查找
	router.delete("/notes/groups/:id", async (req: Request, res: Response) => {
		try {
			if (!adapter?.deleteGroup) {
				return res.status(503).json({ error: "Notes adapter not available" });
			}
			const a = adapter;

			const { id } = req.params;
			const scopeHint = getScopeForReadById(req);
			let scope: string;
			if (scopeHint) {
				scope = scopeHint;
			} else {
				if (!a.getAllGroups) {
					return res.status(503).json({ error: "Notes adapter not available" });
				}
				const found = await findAcrossScopes(req, async (s) => {
					const groups = await a.getAllGroups!(s);
					return groups.find((x) => x.id === id) ?? null;
				});
				if (!found) {
					return res.status(404).json({ error: "Group not found" });
				}
				scope = found.scope;
			}
			await a.deleteGroup!(scope, id);
			res.status(204).send();
		} catch (error) {
			log.error("delete group error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// ========== 便签路由 ==========

	// GET /notes/:id - 获取单条便签，scope 可选 ?scope=xxx，未提供则跨 scope 查找
	router.get("/notes/:id", async (req: Request, res: Response) => {
		try {
			if (!adapter?.getNoteById) {
				return res.status(503).json({ error: "Notes adapter not available" });
			}
			const a = adapter;

			const { id } = req.params;
			const scopeHint = getScopeForReadById(req);
			let note;
			if (scopeHint) {
				note = await a.getNoteById!(scopeHint, id);
			} else {
				const found = await findAcrossScopes(req, (s) => a.getNoteById!(s, id));
				note = found?.item ?? null;
			}

			if (!note) {
				return res.status(404).json({ error: "Note not found" });
			}

			res.json({ note });
		} catch (error) {
			log.error("get note by id error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// POST /notes - 创建便签，scope 可选 body.scope，默认 default
	router.post("/notes", async (req: Request, res: Response) => {
		try {
			if (!adapter?.createNote) {
				return res.status(503).json({ error: "Notes adapter not available" });
			}

			const payload = req.body;
			const scope = getScopeForCreate(req);
			const note = await adapter.createNote(scope, payload);

			const wsServer = req.prizmServer;
			if (wsServer) {
				wsServer.broadcast(
					EVENT_TYPES.NOTE_CREATED,
					{ id: note.id, scope, content: note.content },
					scope
				);
			}
			res.status(201).json({ note });
		} catch (error) {
			log.error("create note error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// PATCH /notes/:id - 更新便签，scope 可选 query，未提供则跨 scope 查找
	router.patch("/notes/:id", async (req: Request, res: Response) => {
		try {
			if (!adapter?.updateNote) {
				return res.status(503).json({ error: "Notes adapter not available" });
			}
			const a = adapter;

			const { id } = req.params;
			const payload = req.body;
			const scopeHint = getScopeForReadById(req);
			let scope: string;
			if (scopeHint) {
				scope = scopeHint;
			} else {
				const found = await findAcrossScopes(req, (s) => a.getNoteById!(s, id));
				if (!found) {
					return res.status(404).json({ error: "Note not found" });
				}
				scope = found.scope;
			}
			const note = await a.updateNote!(scope, id, payload);

			const wsServer = req.prizmServer;
			if (wsServer) {
				wsServer.broadcast(
					EVENT_TYPES.NOTE_UPDATED,
					{ id: note.id, scope, content: note.content },
					scope
				);
			}

			res.json({ note });
		} catch (error) {
			log.error("update note error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// DELETE /notes/:id - 删除便签，scope 可选 query，未提供则跨 scope 查找
	router.delete("/notes/:id", async (req: Request, res: Response) => {
		try {
			if (!adapter?.deleteNote) {
				return res.status(503).json({ error: "Notes adapter not available" });
			}
			const a = adapter;

			const { id } = req.params;
			const scopeHint = getScopeForReadById(req);
			let scope: string;
			if (scopeHint) {
				scope = scopeHint;
			} else {
				const found = await findAcrossScopes(req, (s) => a.getNoteById!(s, id));
				if (!found) {
					return res.status(404).json({ error: "Note not found" });
				}
				scope = found.scope;
			}
			await a.deleteNote!(scope, id);

			const wsServer = req.prizmServer;
			if (wsServer) {
				wsServer.broadcast(EVENT_TYPES.NOTE_DELETED, { id, scope }, scope);
			}

			res.status(204).send();
		} catch (error) {
			log.error("delete note error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});
}
