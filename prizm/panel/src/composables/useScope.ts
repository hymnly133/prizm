/**
 * Scope 切换 composable - 全局共享
 */

import { ref, readonly, type Ref } from "vue";
import { getScopes } from "../api/client";

const ONLINE_SCOPE = "online";
const currentScope = ref(ONLINE_SCOPE);
const scopes = ref<string[]>(["default", ONLINE_SCOPE]);
const scopeDescriptions = ref<
	Record<string, { label: string; description: string }>
>({});

export function useScope() {
	async function loadScopes() {
		try {
			const res = await getScopes();
			scopes.value = res.scopes?.length
				? res.scopes
				: ["default", ONLINE_SCOPE];
			scopeDescriptions.value = res.descriptions ?? {};
			if (!scopes.value.includes(currentScope.value)) {
				currentScope.value = res.scopes?.includes(ONLINE_SCOPE)
					? ONLINE_SCOPE
					: scopes.value[0] ?? "default";
			}
		} catch {
			scopes.value = ["default", ONLINE_SCOPE];
			scopeDescriptions.value = {};
			currentScope.value = ONLINE_SCOPE;
		}
	}

	function setScope(scope: string) {
		currentScope.value = scope;
		if (!scopes.value.includes(scope)) {
			scopes.value = [scope, ...scopes.value].filter(Boolean).sort();
		}
	}

	function getScopeLabel(scopeId: string): string {
		const d = scopeDescriptions.value[scopeId];
		return d?.label ?? scopeId;
	}

	return {
		currentScope: readonly(currentScope) as Ref<string>,
		scopes: readonly(scopes) as Ref<string[]>,
		scopeDescriptions: readonly(scopeDescriptions) as Ref<
			Record<string, { label: string; description: string }>
		>,
		getScopeLabel,
		setScope,
		loadScopes,
	};
}
