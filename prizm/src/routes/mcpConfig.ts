/**
 * MCP 客户端配置 API
 * 管理用户配置的外部 MCP 服务器列表
 */

import type { Router, Request, Response } from "express";
import { ensureStringParam } from "../scopeUtils";
import { toErrorResponse } from "../errors";
import { createLogger } from "../logger";
import {
	listMcpServers,
	getMcpServerById,
	addMcpServer,
	updateMcpServer,
	removeMcpServer,
} from "../mcp-client/configStore";
import { getMcpClientManager } from "../mcp-client/McpClientManager";
import type { McpServerConfig } from "../mcp-client/types";

const log = createLogger("McpConfig");

function validateMcpConfig(body: unknown): McpServerConfig {
	if (!body || typeof body !== "object") {
		throw new Error("Invalid request body");
	}
	const o = body as Record<string, unknown>;
	const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : null;
	const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : null;
	const transport = o.transport as string | undefined;
	if (!id || !name) {
		throw new Error("id and name are required");
	}
	if (!["stdio", "streamable-http", "sse"].includes(transport ?? "")) {
		throw new Error("transport must be stdio, streamable-http, or sse");
	}

	const config: McpServerConfig = {
		id,
		name,
		transport: transport as McpServerConfig["transport"],
		enabled: o.enabled !== false,
	};

	if (transport === "stdio") {
		const stdio = o.stdio as Record<string, unknown> | undefined;
		if (!stdio || typeof stdio.command !== "string") {
			throw new Error("stdio.command is required for stdio transport");
		}
		config.stdio = {
			command: stdio.command,
			args: Array.isArray(stdio.args) ? stdio.args.map(String) : undefined,
			env:
				stdio.env && typeof stdio.env === "object" && !Array.isArray(stdio.env)
					? (stdio.env as Record<string, string>)
					: undefined,
		};
	} else if (transport === "streamable-http" || transport === "sse") {
		const url = typeof o.url === "string" && o.url.trim() ? o.url.trim() : null;
		if (!url) {
			throw new Error("url is required for " + transport);
		}
		config.url = url;
		if (o.headers && typeof o.headers === "object" && !Array.isArray(o.headers)) {
			config.headers = o.headers as Record<string, string>;
		}
	}

	return config;
}

export function createMcpConfigRoutes(router: Router): void {
	// GET /mcp/servers - 列出 MCP 服务器配置
	router.get("/mcp/servers", (_req: Request, res: Response) => {
		try {
			const servers = listMcpServers();
			res.json({ mcpServers: servers });
		} catch (error) {
			log.error("list MCP servers error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// POST /mcp/servers - 添加 MCP 服务器
	router.post("/mcp/servers", (req: Request, res: Response) => {
		try {
			const config = validateMcpConfig(req.body);
			const added = addMcpServer(config);
			res.status(201).json(added);
		} catch (error) {
			log.error("add MCP server error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// PATCH /mcp/servers/:id - 更新 MCP 服务器配置
	router.patch("/mcp/servers/:id", (req: Request, res: Response) => {
		try {
			const id = ensureStringParam(req.params.id);
			const update = req.body as Partial<Omit<McpServerConfig, "id">>;
			const updated = updateMcpServer(id, update);
			res.json(updated);
		} catch (error) {
			log.error("update MCP server error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// DELETE /mcp/servers/:id - 删除 MCP 服务器配置
	router.delete("/mcp/servers/:id", async (req: Request, res: Response) => {
		try {
			const id = ensureStringParam(req.params.id);
			const manager = getMcpClientManager();
			await manager.disconnect(id);
			removeMcpServer(id);
			res.status(204).send();
		} catch (error) {
			log.error("delete MCP server error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});

	// GET /mcp/servers/:id/tools - 获取某服务器的工具列表（测试连接）
	router.get("/mcp/servers/:id/tools", async (req: Request, res: Response) => {
		try {
			const id = ensureStringParam(req.params.id);
			const config = getMcpServerById(id);
			if (!config) {
				return res.status(404).json({ error: "MCP server not found" });
			}
			const manager = getMcpClientManager();
			await manager.connect(config);
			const tools = await manager.listAllTools();
			const serverTools = tools.filter((t) => t.serverId === id);
			res.json({ tools: serverTools });
		} catch (error) {
			log.error("list MCP server tools error:", error);
			const { status, body } = toErrorResponse(error);
			res.status(status).json(body);
		}
	});
}
