/**
 * useTabs - Compound Tabs 模式
 * 参考 frontend-patterns 中的 TabsContext 模式
 */
import { inject, provide, ref, type Ref } from "vue";

const TABS_KEY = Symbol("TabsContext");

export interface TabsContextValue {
	activeTab: Ref<string>;
	setActiveTab: (id: string) => void;
	tabs: { id: string; label: string; icon?: string }[];
}

export function provideTabs(
	tabs: { id: string; label: string; icon?: string }[],
	defaultTab: string
) {
	const activeTab = ref(defaultTab);

	const setActiveTab = (id: string) => {
		activeTab.value = id;
	};

	const context: TabsContextValue = {
		activeTab,
		setActiveTab,
		tabs,
	};

	provide(TABS_KEY, context);
	return context;
}

export function useTabs(): TabsContextValue {
	const context = inject<TabsContextValue>(TABS_KEY);
	if (!context) {
		throw new Error("useTabs must be used within a TabsProvider");
	}
	return context;
}
