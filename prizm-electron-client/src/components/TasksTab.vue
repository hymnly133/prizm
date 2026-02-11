<template>
	<div class="tasks-tab">
		<div class="tab-header">
			<InputBar
				v-model="inputValue"
				placeholder="新的待办事项..."
				submit-label="添加"
				@submit="createTask"
			/>
		</div>

		<ResourceList
			:items="tasks"
			:loading="loading"
			empty-title="暂无任务"
			empty-desc="在上方输入标题并点击添加"
			:get-key="(t) => (t as Task).id"
		>
			<template #item="{ item }">
				<ResourceCard>
					<div class="task-content">
						<span>{{ (item as Task).title }}</span>
						<span class="task-status">[{{ (item as Task).status }}]</span>
					</div>
					<template #actions>
						<Btn
							variant="secondary"
							size="sm"
							@click="doneTask((item as Task).id)"
						>
							完成
						</Btn>
						<Btn
							variant="danger"
							size="sm"
							@click="deleteTask((item as Task).id)"
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
import InputBar from "./ui/InputBar.vue";
import Btn from "./ui/Btn.vue";
import type { Task } from "@prizm/client-core";

const props = withDefaults(
	defineProps<{
		scope?: string;
	}>(),
	{ scope: "default" }
);

const tasks = ref<Task[]>([]);
const inputValue = ref("");
const loading = ref(false);

async function refresh() {
	const http = manager.value?.getHttpClient();
	if (!http) return;
	loading.value = true;
	try {
		tasks.value = await http.listTasks({ scope: props.scope });
	} catch (e) {
		addLog(`加载任务失败: ${String(e)}`, "error");
	} finally {
		loading.value = false;
	}
}

async function createTask() {
	const title = inputValue.value.trim();
	if (!title) return;
	const http = manager.value?.getHttpClient();
	if (!http) return;
	try {
		await http.createTask(
			{
				title,
				description: "",
				status: "todo",
				priority: "medium",
				dueAt: undefined,
				noteId: undefined,
			},
			props.scope
		);
		inputValue.value = "";
		await refresh();
		addLog("已创建任务", "success");
	} catch (e) {
		addLog(`创建任务失败: ${String(e)}`, "error");
	}
}

async function doneTask(id: string) {
	const http = manager.value?.getHttpClient();
	if (!http) return;
	try {
		await http.updateTask(id, { status: "done" }, props.scope);
		await refresh();
	} catch (e) {
		addLog(`更新任务失败: ${String(e)}`, "error");
	}
}

async function deleteTask(id: string) {
	const http = manager.value?.getHttpClient();
	if (!http) return;
	try {
		await http.deleteTask(id, props.scope);
		await refresh();
	} catch (e) {
		addLog(`删除任务失败: ${String(e)}`, "error");
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
		(ev === "task:created" || ev === "task:updated" || ev === "task:deleted")
	) {
		refresh();
	}
});

defineExpose({ refresh });
</script>

<style scoped>
.tasks-tab {
	display: flex;
	flex-direction: column;
	min-height: 0;
	overflow: hidden;
}

.tab-header {
	margin-bottom: 12px;
	flex-shrink: 0;
}

.task-content {
	display: flex;
	align-items: center;
	gap: 8px;
}

.task-status {
	color: var(--text-muted);
	font-size: 12px;
}
</style>
