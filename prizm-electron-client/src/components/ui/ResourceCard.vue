<template>
	<div
		class="resource-card"
		:class="{ clickable, 'is-hover': isHover }"
		@click="clickable ? $emit('click') : undefined"
		@keydown.enter="clickable ? $emit('click') : undefined"
		@keydown.space.prevent="clickable ? $emit('click') : undefined"
		:tabindex="clickable ? 0 : undefined"
		:role="clickable ? 'button' : undefined"
	>
		<div class="resource-card-body">
			<slot />
		</div>
		<div v-if="$slots.actions" class="resource-card-actions">
			<slot name="actions" />
		</div>
	</div>
</template>

<script setup lang="ts">
withDefaults(
	defineProps<{
		clickable?: boolean;
		isHover?: boolean;
	}>(),
	{ clickable: false, isHover: false }
);

defineEmits<{
	click: [];
}>();
</script>

<style scoped>
.resource-card {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
	padding: 12px 14px;
	border-radius: var(--radius-md);
	background: var(--card-bg);
	border: 1px solid var(--border-subtle);
	transition: border-color 0.15s, background 0.15s;
}

.resource-card:hover {
	border-color: var(--border-hover);
	background: var(--card-bg-hover);
}

.resource-card.clickable {
	cursor: pointer;
}

.resource-card-body {
	flex: 1;
	min-width: 0;
	font-size: 13px;
	line-height: 1.5;
	color: var(--text);
}

.resource-card-actions {
	display: flex;
	gap: 6px;
	flex-shrink: 0;
}
</style>
