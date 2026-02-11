<template>
	<div class="clipboard-tab">
		<div class="tab-header">
			<Btn variant="secondary" @click="refresh">刷新历史</Btn>
		</div>

		<ResourceList
			:items="items"
			:loading="loading"
			empty-title="暂无剪贴板历史"
			empty-desc="复制内容后会自动同步到这里"
			:get-key="(c) => (c as ClipboardItem).id"
		>
			<template #item="{ item }">
				<ResourceCard clickable @click="copyItem(item as ClipboardItem)">
					<div class="clipboard-content">
						{{ preview((item as ClipboardItem).content) }}
						<span class="item-meta">[{{ (item as ClipboardItem).type }}]</span>
					</div>
					<template #actions>
						<Btn
							variant="danger"
							size="sm"
							@click.stop="deleteItem((item as ClipboardItem).id)"
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
import { manager, lastSyncEvent } from "../composables/usePrizm";
import { addLog } from "../composables/useLogs";
import ResourceCard from "./ui/ResourceCard.vue";
import ResourceList from "./ui/ResourceList.vue";
import Btn from "./ui/Btn.vue";
import type { ClipboardItem } from "@prizm/client-core";

const props = withDefaults(
	defineProps<{
		scope?: string;
	}>(),
	{ scope: "default" }
);

const items = ref<ClipboardItem[]>([]);
const loading = ref(false);

function preview(content: string) {
	return content.length > 80 ? content.slice(0, 80) + "…" : content;
}

async function refresh() {
	const http = manager.value?.getHttpClient();
	if (!http) return;
	loading.value = true;
	try {
		items.value = await http.getClipboardHistory({
			limit: 20,
			scope: props.scope,
		});
	} catch (e) {
		addLog(`加载剪贴板历史失败: ${String(e)}`, "error");
	} finally {
		loading.value = false;
	}
}

async function copyItem(item: ClipboardItem) {
	try {
		await window.prizm.writeClipboard(item.content);
		addLog("已复制到剪贴板", "success");
	} catch (e) {
		addLog(`复制失败: ${String(e)}`, "error");
	}
}

async function deleteItem(id: string) {
	const http = manager.value?.getHttpClient();
	if (!http) return;
	try {
		await http.deleteClipboardItem(id, props.scope);
		await refresh();
	} catch (e) {
		addLog(`删除失败: ${String(e)}`, "error");
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
	if (ev && (ev === "clipboard:itemAdded" || ev === "clipboard:itemDeleted")) {
		refresh();
	}
});

defineExpose({ refresh });
</script>

<style scoped>
.clipboard-tab {
	display: flex;
	flex-direction: column;
	min-height: 0;
	overflow: hidden;
}

.tab-header {
	margin-bottom: 12px;
	flex-shrink: 0;
}

.clipboard-content {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.item-meta {
	margin-left: 6px;
	color: var(--text-muted);
	font-size: 12px;
}
</style>
