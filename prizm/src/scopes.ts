/**
 * Prizm Scope 定义与说明
 * 用于 MCP、HTTP 等远程连接服务的 scope 配置及 UI 展示
 */

import { DEFAULT_SCOPE, ONLINE_SCOPE } from "./core/ScopeStore";

export interface ScopeInfo {
	id: string;
	/** 简短说明，用于 UI 展示 */
	label: string;
	/** 详细说明 */
	description: string;
}

/** 内置 scope 的说明 */
export const SCOPE_INFOS: Record<string, ScopeInfo> = {
	[DEFAULT_SCOPE]: {
		id: DEFAULT_SCOPE,
		label: "默认工作区",
		description:
			"默认数据空间，用于通用工作场景。新建客户端未指定 scope 时使用。",
	},
	[ONLINE_SCOPE]: {
		id: ONLINE_SCOPE,
		label: "实时上下文",
		description:
			"用户实时上下文，Electron 客户端常驻显示此 scope 的 TODO 和便签。适合作为 Agent、MCP 的默认操作范围。",
	},
};

/**
 * 获取 scope 说明，自定义 scope 返回通用描述
 */
export function getScopeInfo(scopeId: string): ScopeInfo {
	return (
		SCOPE_INFOS[scopeId] ?? {
			id: scopeId,
			label: scopeId,
			description: `自定义工作区 "${scopeId}"，用于隔离特定项目或场景的数据。`,
		}
	);
}

/**
 * 获取所有 scope 的说明（含内置 + 传入的自定义 scope 列表）
 */
export function getScopeInfos(scopeIds: string[]): ScopeInfo[] {
	const seen = new Set<string>();
	const result: ScopeInfo[] = [];
	for (const id of scopeIds) {
		if (!seen.has(id)) {
			seen.add(id);
			result.push(getScopeInfo(id));
		}
	}
	return result;
}
