<template>
	<aside class="app-sidebar" aria-label="资源导航">
		<nav class="sidebar-nav">
			<button
				v-for="t in tabs"
				:key="t.id"
				type="button"
				class="sidebar-item"
				:class="{ active: activeTab === t.id }"
				:aria-current="activeTab === t.id ? 'page' : undefined"
				@click="$emit('select', t.id)"
			>
				<span class="sidebar-item-icon" aria-hidden="true">
					{{ getIcon(t.id) }}
				</span>
				<span class="sidebar-item-label">{{ t.label }}</span>
			</button>
		</nav>
	</aside>
</template>

<script setup lang="ts">
defineProps<{
	tabs: { id: string; label: string; icon?: string }[];
	activeTab: string;
}>();

defineEmits<{
	select: [id: string];
}>();

function getIcon(id: string): string {
	const icons: Record<string, string> = {
		notes: "📝",
		tasks: "✓",
		clipboard: "📋",
		pomodoro: "🍅",
	};
	return icons[id] ?? "•";
}
</script>

<style scoped>
.app-sidebar {
	width: 200px;
	flex-shrink: 0;
	background: var(--bg-sidebar);
	border-right: 1px solid var(--border);
	display: flex;
	flex-direction: column;
}

.sidebar-nav {
	display: flex;
	flex-direction: column;
	padding: 12px 8px;
	gap: 2px;
}

.sidebar-item {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 12px;
	border: none;
	border-radius: var(--radius-md);
	background: transparent;
	color: var(--text-muted);
	font-size: 14px;
	font-weight: 500;
	font-family: inherit;
	cursor: pointer;
	transition: background 0.15s, color 0.15s;
	text-align: left;
	width: 100%;
}

.sidebar-item:hover {
	background: var(--hover-bg);
	color: var(--text);
}

.sidebar-item.active {
	background: var(--accent);
	color: white;
}

.sidebar-item-icon {
	font-size: 16px;
	line-height: 1;
	opacity: 0.9;
}

.sidebar-item-label {
	flex: 1;
}
</style>
