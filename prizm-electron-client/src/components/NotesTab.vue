<template>
	<div class="notes-tab">
		<div class="tab-header">
			<InputBar
				v-model="inputValue"
				placeholder="快速记一条便签..."
				submit-label="添加"
				@submit="createNote"
			/>
		</div>

		<ResourceList
			:items="notes"
			:loading="loading"
			empty-title="暂无便签"
			empty-desc="在上方输入内容并点击添加"
			:get-key="(n) => (n as StickyNote).id"
		>
			<template #item="{ item }">
				<ResourceCard>
					<div class="note-content md-preview-wrap">
						<MdPreview
							:model-value="(item as StickyNote).content || '(空)'"
							:editor-id="'note-' + (item as StickyNote).id"
						/>
					</div>
					<template #actions>
						<Btn
							variant="danger"
							size="sm"
							@click="deleteNote((item as StickyNote).id)"
						>
							删除
						</Btn>
					</template>
				</ResourceCard>
			</template>
		</ResourceList>
	</div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { MdPreview } from "md-editor-v3";
import "md-editor-v3/lib/preview.css";
import { manager, lastSyncEvent } from "../composables/usePrizm";
import { addLog } from "../composables/useLogs";
import ResourceCard from "./ui/ResourceCard.vue";
import ResourceList from "./ui/ResourceList.vue";
import InputBar from "./ui/InputBar.vue";
import Btn from "./ui/Btn.vue";
import type { StickyNote } from "@prizm/client-core";

const props = withDefaults(
	defineProps<{
		scope?: string;
	}>(),
	{ scope: "default" }
);

const notes = ref<StickyNote[]>([]);
const inputValue = ref("");
const loading = ref(false);

async function refresh() {
	const http = manager.value?.getHttpClient();
	if (!http) return;
	loading.value = true;
	try {
		notes.value = await http.listNotes({ scope: props.scope });
	} catch (e) {
		addLog(`加载便签失败: ${String(e)}`, "error");
	} finally {
		loading.value = false;
	}
}

async function createNote() {
	const content = inputValue.value.trim();
	if (!content) return;
	const http = manager.value?.getHttpClient();
	if (!http) return;
	try {
		await http.createNote({ content }, props.scope);
		inputValue.value = "";
		await refresh();
		addLog("已创建便签", "success");
	} catch (e) {
		addLog(`创建便签失败: ${String(e)}`, "error");
	}
}

async function deleteNote(id: string) {
	const http = manager.value?.getHttpClient();
	if (!http) return;
	try {
		await http.deleteNote(id, props.scope);
		await refresh();
	} catch (e) {
		addLog(`删除便签失败: ${String(e)}`, "error");
	}
}

watch(
	[manager, () => props.scope],
	([m]) => {
		if (m) void refresh();
	},
	{ immediate: true }
);

watch(lastSyncEvent, (ev) => {
	if (
		ev &&
		(ev === "note:created" || ev === "note:updated" || ev === "note:deleted")
	) {
		refresh();
	}
});

defineExpose({ refresh });
</script>

<style scoped>
.notes-tab {
	display: flex;
	flex-direction: column;
	min-height: 0;
	overflow: hidden;
}

.tab-header {
	margin-bottom: 12px;
	flex-shrink: 0;
}

.note-content :deep(.md-editor-preview-wrapper) {
	padding: 0;
	font-size: 13px;
}

.note-content :deep(.md-editor-preview-wrapper h1),
.note-content :deep(.md-editor-preview-wrapper h2),
.note-content :deep(.md-editor-preview-wrapper h3) {
	font-size: 1em;
	margin: 0;
}
</style>
