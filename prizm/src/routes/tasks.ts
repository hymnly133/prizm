/**
 * Tasks / TODO 路由
 */

import type { Router, Request, Response } from "express";
import type { ITasksAdapter } from "../adapters/interfaces";
import type { Task } from "../types";
import { EVENT_TYPES } from "../websocket/types";
import { toErrorResponse } from "../errors";
import { createLogger } from "../logger";
import {
	getScopeForCreate,
	requireScopeForList,
	getScopeForReadById,
	findAcrossScopes,
} from "../scopeUtils";

const log = createLogger("Tasks");

export function createTasksRoutes(
	router: Router,
	adapter?: ITasksAdapter
): void {
	if (!adapter) {
		log.warn("Tasks adapter not provided, routes will return 503");
	}

	// GET /tasks - 获取任务列表，scope 必填 ?scope=xxx
	router.get("/tasks", async (req: Request, res: Response) => {
		try {
			if (!adapter?.getAllTasks) {
				return res.status(503).json({ error: "Tasks adapter not available" });
			}

			const scope = requireScopeForList(req, res);
			if (!scope) return;
			const { status, due_before } = req.query;

			const filters: { status?: string; dueBefore?: number } = {};
			if (typeof status === "string") {
				filters.status = status;
			}
			if (typeof due_before === "string") {
				const num = Number(due_before);
				if (!Number.isNaN(num)) {
					filters.dueBefore = num;
				}
			}

			const tasks = await adapter.getAllTasks(scope, filters);
			res.json({ tasks });
		} catch (error) {
			log.error("get all tasks error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// GET /tasks/:id - 获取单个任务，scope 可选 ?scope=xxx，未提供则跨 scope 查找
	router.get("/tasks/:id", async (req: Request, res: Response) => {
		try {
			if (!adapter?.getTaskById) {
				return res.status(503).json({ error: "Tasks adapter not available" });
			}
			const a = adapter;

			const { id } = req.params;
			const scopeHint = getScopeForReadById(req);
			let task;
			if (scopeHint) {
				task = await a.getTaskById!(scopeHint, id);
			} else {
				const found = await findAcrossScopes(req, (s) => a.getTaskById!(s, id));
				task = found?.item ?? null;
			}

			if (!task) {
				return res.status(404).json({ error: "Task not found" });
			}

			res.json({ task });
		} catch (error) {
			log.error("get task by id error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// POST /tasks - 创建任务，scope 可选 body.scope，默认 default
	router.post("/tasks", async (req: Request, res: Response) => {
		try {
			if (!adapter?.createTask) {
				return res.status(503).json({ error: "Tasks adapter not available" });
			}

			const { title, description, status, priority, dueAt, noteId } =
				req.body ?? {};

			if (!title || typeof title !== "string") {
				return res.status(400).json({ error: "title is required" });
			}

			const scope = getScopeForCreate(req);
			const payload: Omit<Task, "id" | "createdAt" | "updatedAt"> = {
				title,
				description,
				status,
				priority,
				dueAt,
				noteId,
			};
			const task = await adapter.createTask(scope, payload);

			const wsServer = req.prizmServer;
			if (wsServer) {
				wsServer.broadcast(
					EVENT_TYPES.TASK_CREATED,
					{ id: task.id, scope, title: task.title },
					scope
				);
			}

			res.status(201).json({ task });
		} catch (error) {
			log.error("create task error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// PATCH /tasks/:id - 更新任务，scope 可选 query，未提供则跨 scope 查找
	router.patch("/tasks/:id", async (req: Request, res: Response) => {
		try {
			if (!adapter?.updateTask) {
				return res.status(503).json({ error: "Tasks adapter not available" });
			}
			const a = adapter;

			const { id } = req.params;
			const payload = req.body ?? {};
			const scopeHint = getScopeForReadById(req);
			let scope: string;
			if (scopeHint) {
				scope = scopeHint;
			} else {
				const found = await findAcrossScopes(req, (s) => a.getTaskById!(s, id));
				if (!found) {
					return res.status(404).json({ error: "Task not found" });
				}
				scope = found.scope;
			}
			const task = await a.updateTask!(scope, id, payload);

			const wsServer = req.prizmServer;
			if (wsServer) {
				wsServer.broadcast(
					EVENT_TYPES.TASK_UPDATED,
					{ id: task.id, scope, title: task.title },
					scope
				);
			}

			res.json({ task });
		} catch (error) {
			log.error("update task error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// DELETE /tasks/:id - 删除任务，scope 可选 query，未提供则跨 scope 查找
	router.delete("/tasks/:id", async (req: Request, res: Response) => {
		try {
			if (!adapter?.deleteTask) {
				return res.status(503).json({ error: "Tasks adapter not available" });
			}
			const a = adapter;

			const { id } = req.params;
			const scopeHint = getScopeForReadById(req);
			let scope: string;
			if (scopeHint) {
				scope = scopeHint;
			} else {
				const found = await findAcrossScopes(req, (s) => a.getTaskById!(s, id));
				if (!found) {
					return res.status(404).json({ error: "Task not found" });
				}
				scope = found.scope;
			}
			await a.deleteTask!(scope, id);

			const wsServer = req.prizmServer;
			if (wsServer) {
				wsServer.broadcast(EVENT_TYPES.TASK_DELETED, { id, scope }, scope);
			}

			res.status(204).send();
		} catch (error) {
			log.error("delete task error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});
}
