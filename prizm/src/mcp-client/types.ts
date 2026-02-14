/**
 * MCP 客户端配置类型
 * 用于调用外部 MCP 服务器（作为 MCP 客户端）
 */

export type McpTransport = "stdio" | "streamable-http" | "sse";

export interface McpStdioConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

export interface McpServerConfig {
	id: string;
	name: string;
	transport: McpTransport;
	/** 当 transport=stdio 时使用 */
	stdio?: McpStdioConfig;
	/** 当 transport=streamable-http 或 sse 时使用 */
	url?: string;
	/** 可选鉴权 headers（用于 HTTP 传输） */
	headers?: Record<string, string>;
	enabled: boolean;
}

export interface McpServersFile {
	mcpServers: McpServerConfig[];
}
