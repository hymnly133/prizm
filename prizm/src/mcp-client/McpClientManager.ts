/**
 * MCP 客户端管理器
 * 连接用户配置的外部 MCP 服务器，聚合工具列表，执行工具调用
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// SSEClientTransport 已弃用，仅用于 streamable-http 失败时的回退
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpServerConfig } from "./types";
import { listMcpServers } from "../settings/agentToolsStore";
import { createLogger } from "../logger";

const log = createLogger("McpClientManager");

export interface McpTool {
	serverId: string;
	name: string;
	/** 带前缀的完整名称，用于 LLM（避免多服务器工具名冲突） */
	fullName: string;
	description?: string;
	inputSchema?: object;
}

export interface McpCallToolResult {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

interface ClientEntry {
	client: Client;
	config: McpServerConfig;
}

const MAX_TOOL_CALL_ROUNDS = 5;
const TOOL_NAME_PREFIX_SEP = "__";

export class McpClientManager {
	private clients = new Map<string, ClientEntry>();

	/**
	 * 连接单个 MCP 服务器
	 */
	async connect(config: McpServerConfig): Promise<void> {
		if (!config.enabled) return;
		if (this.clients.has(config.id)) {
			log.info("MCP server already connected:", config.id);
			return;
		}

		const client = new Client(
			{ name: "prizm-mcp-client", version: "0.1.0" },
			{ capabilities: {} }
		);
		client.onerror = (err: unknown) => log.error("MCP client error", config.id, err);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let transport: any;

		if (config.transport === "streamable-http" || config.transport === "sse") {
			if (!config.url?.trim()) {
				throw new Error(`MCP server ${config.id}: url is required for ${config.transport}`);
			}
			const url = new URL(config.url);
			const requestInit = config.headers ? { headers: config.headers } : undefined;
			if (config.transport === "streamable-http") {
				transport = new StreamableHTTPClientTransport(url, { requestInit });
			} else {
				// transport === "sse": 优先尝试 Streamable HTTP（SSEClientTransport 已弃用）
				transport = new StreamableHTTPClientTransport(url, { requestInit });
				try {
					await client.connect(transport);
				} catch {
					// Streamable HTTP 失败时回退到 SSE（迁移期兼容），需新建 Client
					log.warn(
						"MCP server",
						config.id,
						": SSEClientTransport is deprecated. Streamable HTTP failed, using SSE fallback."
					);
					const sseClient = new Client(
						{ name: "prizm-mcp-client", version: "0.1.0" },
						{ capabilities: {} }
					);
					sseClient.onerror = (err: unknown) => log.error("MCP client error", config.id, err);
					await sseClient.connect(new SSEClientTransport(url, { requestInit }));
					this.clients.set(config.id, { client: sseClient, config });
					log.info("MCP server connected:", config.id);
					return;
				}
				this.clients.set(config.id, { client, config });
				log.info("MCP server connected:", config.id);
				return;
			}
		} else if (config.transport === "stdio") {
			if (!config.stdio?.command) {
				throw new Error(`MCP server ${config.id}: stdio.command is required`);
			}
			transport = new StdioClientTransport({
				command: config.stdio.command,
				args: config.stdio.args ?? [],
				env: config.stdio.env,
			});
		} else {
			throw new Error(`Unsupported transport: ${config.transport}`);
		}

		await client.connect(transport);
		this.clients.set(config.id, { client, config });
		log.info("MCP server connected:", config.id);
	}

	/**
	 * 断开单个 MCP 服务器
	 */
	async disconnect(id: string): Promise<void> {
		const entry = this.clients.get(id);
		if (!entry) return;
		try {
			entry.client.close();
		} catch (e) {
			log.warn("Error closing MCP client:", id, e);
		}
		this.clients.delete(id);
		log.info("MCP server disconnected:", id);
	}

	/**
	 * 连接所有已启用且已配置的 MCP 服务器
	 */
	async connectAll(): Promise<void> {
		const configs = listMcpServers().filter((c) => c.enabled);
		for (const config of configs) {
			try {
				await this.connect(config);
			} catch (err) {
				log.error("Failed to connect MCP server:", config.id, err);
			}
		}
	}

	/**
	 * 聚合所有已连接服务器的工具列表，工具名加 serverId 前缀避免冲突
	 */
	async listAllTools(): Promise<McpTool[]> {
		const tools: McpTool[] = [];
		for (const [serverId, entry] of this.clients) {
			try {
				const result = await entry.client.listTools();
				for (const t of result.tools) {
					tools.push({
						serverId,
						name: t.name,
						fullName: `${serverId}${TOOL_NAME_PREFIX_SEP}${t.name}`,
						description: t.description,
						inputSchema: t.inputSchema as object | undefined,
					});
				}
			} catch (err) {
				log.error("Failed to list tools for", serverId, err);
			}
		}
		return tools;
	}

	/**
	 * 调用工具。fullName 格式为 "serverId__toolName"
	 */
	async callTool(
		fullName: string,
		args: Record<string, unknown>
	): Promise<McpCallToolResult> {
		const idx = fullName.indexOf(TOOL_NAME_PREFIX_SEP);
		if (idx < 0) {
			return {
				content: [{ type: "text", text: `Invalid tool name format: ${fullName}` }],
				isError: true,
			};
		}
		const serverId = fullName.slice(0, idx);
		const toolName = fullName.slice(idx + TOOL_NAME_PREFIX_SEP.length);

		const entry = this.clients.get(serverId);
		if (!entry) {
			return {
				content: [{ type: "text", text: `MCP server not connected: ${serverId}` }],
				isError: true,
			};
		}

		try {
			const result = await entry.client.callTool({ name: toolName, arguments: args });
			const content =
				result.content?.map((c) =>
					c.type === "text" ? { type: "text" as const, text: c.text } : { type: "text" as const, text: JSON.stringify(c) }
				) ?? [];
			return {
				content,
				isError: result.isError,
			};
		} catch (err) {
			log.error("Tool call failed:", serverId, toolName, err);
			return {
				content: [
					{
						type: "text",
						text: `Tool call failed: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				isError: true,
			};
		}
	}

	/**
	 * 解析 fullName 为 serverId 和 toolName
	 */
	static parseFullName(fullName: string): { serverId: string; toolName: string } | null {
		const idx = fullName.indexOf(TOOL_NAME_PREFIX_SEP);
		if (idx < 0) return null;
		return {
			serverId: fullName.slice(0, idx),
			toolName: fullName.slice(idx + TOOL_NAME_PREFIX_SEP.length),
		};
	}
}

let _instance: McpClientManager | null = null;

export function getMcpClientManager(): McpClientManager {
	if (!_instance) {
		_instance = new McpClientManager();
	}
	return _instance;
}
