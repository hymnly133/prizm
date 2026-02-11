/**
 * 文档路由 - 正式信息文档 CRUD
 */

import type { Router, Request, Response } from "express";
import type { IDocumentsAdapter } from "../adapters/interfaces";
import type { CreateDocumentPayload, UpdateDocumentPayload } from "../types";
import { EVENT_TYPES } from "../websocket/types";
import { toErrorResponse } from "../errors";
import { createLogger } from "../logger";
import {
	getScopeForCreate,
	requireScopeForList,
	getScopeForReadById,
	findAcrossScopes,
} from "../scopeUtils";

const log = createLogger("Documents");

export function createDocumentsRoutes(
	router: Router,
	adapter?: IDocumentsAdapter
): void {
	if (!adapter) {
		log.warn("Documents adapter not provided, routes will return 503");
	}

	// GET /documents - 获取所有文档，scope 必填 ?scope=xxx
	router.get("/documents", async (req: Request, res: Response) => {
		try {
			if (!adapter?.getAllDocuments) {
				return res
					.status(503)
					.json({ error: "Documents adapter not available" });
			}

			const scope = requireScopeForList(req, res);
			if (!scope) return;
			const docs = await adapter.getAllDocuments(scope);
			res.json({ documents: docs });
		} catch (error) {
			log.error("get all documents error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// GET /documents/:id - 获取单个文档，scope 可选 ?scope=xxx，未提供则跨 scope 查找
	router.get("/documents/:id", async (req: Request, res: Response) => {
		try {
			if (!adapter?.getDocumentById) {
				return res
					.status(503)
					.json({ error: "Documents adapter not available" });
			}

			const { id } = req.params;
			const scopeHint = getScopeForReadById(req);
			let doc;
			if (scopeHint) {
				doc = await adapter.getDocumentById(scopeHint, id);
			} else {
				const found = await findAcrossScopes(req, (s) =>
					adapter!.getDocumentById!(s, id)
				);
				doc = found?.item ?? null;
			}

			if (!doc) {
				return res.status(404).json({ error: "Document not found" });
			}

			res.json({ document: doc });
		} catch (error) {
			log.error("get document by id error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// POST /documents - 创建文档，scope 可选 body.scope，默认 default
	router.post("/documents", async (req: Request, res: Response) => {
		try {
			if (!adapter?.createDocument) {
				return res
					.status(503)
					.json({ error: "Documents adapter not available" });
			}

			const { title, content } = req.body ?? {};
			if (!title || typeof title !== "string") {
				return res.status(400).json({ error: "title is required" });
			}

			const scope = getScopeForCreate(req);
			const payload: CreateDocumentPayload = { title, content };
			const doc = await adapter.createDocument(scope, payload);

			const wsServer = req.prizmServer;
			if (wsServer) {
				wsServer.broadcast(
					EVENT_TYPES.DOCUMENT_CREATED,
					{ id: doc.id, scope, title: doc.title },
					scope
				);
			}

			res.status(201).json({ document: doc });
		} catch (error) {
			log.error("create document error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// PATCH /documents/:id - 更新文档
	router.patch("/documents/:id", async (req: Request, res: Response) => {
		try {
			if (!adapter?.updateDocument) {
				return res
					.status(503)
					.json({ error: "Documents adapter not available" });
			}

			const { id } = req.params;
			const payload: UpdateDocumentPayload = req.body ?? {};
			const scopeHint = getScopeForReadById(req);
			let scope: string;
			if (scopeHint) {
				scope = scopeHint;
			} else {
				const found = await findAcrossScopes(req, (s) =>
					adapter!.getDocumentById!(s, id)
				);
				if (!found) {
					return res.status(404).json({ error: "Document not found" });
				}
				scope = found.scope;
			}
			const doc = await adapter.updateDocument(scope, id, payload);

			const wsServer = req.prizmServer;
			if (wsServer) {
				wsServer.broadcast(
					EVENT_TYPES.DOCUMENT_UPDATED,
					{ id: doc.id, scope, title: doc.title },
					scope
				);
			}

			res.json({ document: doc });
		} catch (error) {
			log.error("update document error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// DELETE /documents/:id - 删除文档，scope 可选 query，未提供则跨 scope 查找
	router.delete("/documents/:id", async (req: Request, res: Response) => {
		try {
			if (!adapter?.deleteDocument) {
				return res
					.status(503)
					.json({ error: "Documents adapter not available" });
			}

			const { id } = req.params;
			const scopeHint = getScopeForReadById(req);
			let scope: string;
			if (scopeHint) {
				scope = scopeHint;
			} else {
				const found = await findAcrossScopes(req, (s) =>
					adapter!.getDocumentById!(s, id)
				);
				if (!found) {
					return res.status(404).json({ error: "Document not found" });
				}
				scope = found.scope;
			}
			await adapter.deleteDocument(scope, id);

			const wsServer = req.prizmServer;
			if (wsServer) {
				wsServer.broadcast(EVENT_TYPES.DOCUMENT_DELETED, { id, scope }, scope);
			}

			res.status(204).send();
		} catch (error) {
			log.error("delete document error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});
}
