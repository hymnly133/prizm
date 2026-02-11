/**
 * Auth / 权限相关类型
 */

export interface ClientInfo {
	clientId: string;
	name: string;
	allowedScopes: string[];
	createdAt: number;
}

export interface ScopeDescription {
	label: string;
	description: string;
}
