<template>
	<button
		:type="type"
		:disabled="disabled"
		:class="['btn', `btn-${variant}`, { 'btn-sm': size === 'sm' }]"
		@click="$emit('click', $event)"
	>
		<slot />
	</button>
</template>

<script setup lang="ts">
withDefaults(
	defineProps<{
		variant?: "primary" | "secondary" | "danger" | "ghost";
		size?: "default" | "sm";
		type?: "button" | "submit";
		disabled?: boolean;
	}>(),
	{ variant: "primary", size: "default", type: "button", disabled: false }
);

defineEmits<{
	click: [e: MouseEvent];
}>();
</script>

<style scoped>
.btn {
	padding: 10px 16px;
	border-radius: var(--radius-md);
	border: none;
	font-size: 14px;
	font-weight: 500;
	font-family: inherit;
	cursor: pointer;
	transition: background 0.15s, opacity 0.15s;
}

.btn:disabled {
	opacity: 0.6;
	cursor: not-allowed;
}

.btn-sm {
	padding: 6px 12px;
	font-size: 12px;
}

.btn-primary {
	background: var(--accent);
	color: white;
}

.btn-primary:hover:not(:disabled) {
	background: var(--accent-hover);
}

.btn-secondary {
	background: var(--btn-secondary-bg);
	color: var(--text);
}

.btn-secondary:hover:not(:disabled) {
	background: var(--btn-secondary-hover);
}

.btn-danger {
	background: var(--danger-bg);
	color: var(--danger-text);
}

.btn-danger:hover:not(:disabled) {
	background: var(--danger-bg-hover);
}

.btn-ghost {
	background: transparent;
	color: var(--text-muted);
}

.btn-ghost:hover:not(:disabled) {
	background: var(--hover-bg);
	color: var(--text);
}
</style>
