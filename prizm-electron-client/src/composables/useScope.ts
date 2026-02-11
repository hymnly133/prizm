/**
 * useScope - Scope 管理与选择
 * 提供 scope 列表、当前选中 scope，供 Notion 风格侧边栏使用
 */
import { ref, watch } from "vue";
import { ONLINE_SCOPE } from "@prizm/client-core";
import { manager } from "./usePrizm";

export const currentScope = ref<string>(ONLINE_SCOPE);
export const scopes = ref<string[]>([]);
export const scopeDescriptions = ref<
	Record<string, { label: string; description: string }>
>({});
export const scopesLoading = ref(false);

export async function refreshScopes(): Promise<void> {
	const http = manager.value?.getHttpClient();
	if (!http) return;
	scopesLoading.value = true;
	try {
		const { scopes: list, descriptions } = await http.listScopesWithInfo();
		scopes.value = list.length > 0 ? list : ["default", ONLINE_SCOPE];
		scopeDescriptions.value = descriptions ?? {};
		// 若当前 scope 不在列表中，优先选 online，否则第一项
		if (!list.includes(currentScope.value)) {
			currentScope.value = list.includes(ONLINE_SCOPE)
				? ONLINE_SCOPE
				: scopes.value[0] ?? "default";
		}
	} catch {
		scopes.value = ["default", ONLINE_SCOPE];
		scopeDescriptions.value = {};
	} finally {
		scopesLoading.value = false;
	}
}

export function getScopeLabel(scopeId: string): string {
	return scopeDescriptions.value[scopeId]?.label ?? scopeId;
}

export function setScope(scope: string): void {
	currentScope.value = scope;
}

watch(
	manager,
	(m) => {
		if (m) void refreshScopes();
	},
	{ immediate: true }
);
