<template>
	<div class="resource-list" role="list">
		<template v-if="items.length === 0 && !loading">
			<slot name="empty">
				<EmptyState :title="emptyTitle" :description="emptyDesc" />
			</slot>
		</template>
		<template v-else-if="loading">
			<div class="resource-list-loading">
				<slot name="loading">加载中...</slot>
			</div>
		</template>
		<template v-else>
			<div
				v-for="(item, index) in items"
				:key="getKey(item, index)"
				class="resource-list-item"
				role="listitem"
			>
				<slot name="item" :item="item" :index="index" />
			</div>
		</template>
	</div>
</template>

<script setup lang="ts">
import EmptyState from "./EmptyState.vue";

withDefaults(
	defineProps<{
		items: unknown[];
		loading?: boolean;
		emptyTitle?: string;
		emptyDesc?: string;
		getKey?: (item: unknown, index: number) => string | number;
	}>(),
	{
		loading: false,
		emptyTitle: "暂无数据",
		emptyDesc: undefined,
		getKey: (item: unknown, i: number) =>
			(item as { id?: string })?.id ?? String(i),
	}
);
</script>

<style scoped>
.resource-list {
	flex: 1;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-height: 0;
}

.resource-list-loading {
	padding: 24px;
	text-align: center;
	color: var(--text-muted);
	font-size: 13px;
}
</style>
