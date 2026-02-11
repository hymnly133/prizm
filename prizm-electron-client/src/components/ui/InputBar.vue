<template>
	<div class="input-bar">
		<input
			:value="modelValue"
			:type="type"
			:placeholder="placeholder"
			:disabled="disabled"
			class="input-bar-field"
			@input="
				$emit('update:modelValue', ($event.target as HTMLInputElement).value)
			"
			@keydown.enter="$emit('submit')"
		/>
		<slot name="append">
			<Btn
				v-if="submitLabel"
				variant="primary"
				size="sm"
				@click="$emit('submit')"
			>
				{{ submitLabel }}
			</Btn>
		</slot>
	</div>
</template>

<script setup lang="ts">
import Btn from "./Btn.vue";

defineProps<{
	modelValue: string;
	placeholder?: string;
	type?: string;
	disabled?: boolean;
	submitLabel?: string;
}>();

defineEmits<{
	"update:modelValue": [value: string];
	submit: [];
}>();
</script>

<style scoped>
.input-bar {
	display: flex;
	gap: 10px;
	align-items: center;
}

.input-bar-field {
	flex: 1;
	padding: 10px 14px;
	border-radius: var(--radius-md);
	border: 1px solid var(--border);
	font-size: 14px;
	font-family: inherit;
	background: var(--input-bg);
	transition: border-color 0.15s, box-shadow 0.15s;
}

.input-bar-field:focus {
	outline: none;
	border-color: var(--accent);
	box-shadow: 0 0 0 3px var(--focus-ring);
}

.input-bar-field::placeholder {
	color: var(--text-muted);
}
</style>
