<template>
	<div class="empty-state">
		<div class="empty-state-icon" aria-hidden="true">
			<slot name="icon">
				<span class="icon-placeholder">{{ iconChar }}</span>
			</slot>
		</div>
		<p class="empty-state-title">{{ title }}</p>
		<p v-if="description" class="empty-state-desc">{{ description }}</p>
		<div v-if="$slots.actions" class="empty-state-actions">
			<slot name="actions" />
		</div>
	</div>
</template>

<script setup lang="ts">
withDefaults(
	defineProps<{
		title: string;
		description?: string;
		iconChar?: string;
	}>(),
	{ iconChar: "—" }
);
</script>

<style scoped>
.empty-state {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 48px 24px;
	text-align: center;
	color: var(--text-muted);
}

.empty-state-icon {
	width: 48px;
	height: 48px;
	display: flex;
	align-items: center;
	justify-content: center;
	margin-bottom: 12px;
	font-size: 20px;
	color: var(--text-muted);
	opacity: 0.6;
}

.icon-placeholder {
	font-weight: 300;
}

.empty-state-title {
	font-size: 14px;
	font-weight: 500;
	color: var(--text);
	margin-bottom: 4px;
}

.empty-state-desc {
	font-size: 13px;
	line-height: 1.5;
	margin-bottom: 16px;
}

.empty-state-actions {
	display: flex;
	gap: 8px;
	justify-content: center;
}
</style>
