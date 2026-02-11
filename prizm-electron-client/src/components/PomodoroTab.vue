<template>
	<div class="pomodoro-tab">
		<div class="tab-header">
			<Btn variant="primary" @click="startPomodoro">开始番茄钟</Btn>
			<Btn variant="secondary" @click="stopPomodoro">停止当前</Btn>
		</div>

		<ResourceList
			:items="sessions"
			:loading="loading"
			empty-title="暂无番茄钟记录"
			empty-desc="点击上方按钮开始专注"
			:get-key="(s) => (s as PomodoroSession).id"
		>
			<template #item="{ item }">
				<ResourceCard>
					{{ formatSession(item as PomodoroSession) }}
				</ResourceCard>
			</template>
		</ResourceList>
	</div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { manager, activePomodoroId } from "../composables/usePrizm";
import { addLog } from "../composables/useLogs";
import ResourceCard from "./ui/ResourceCard.vue";
import ResourceList from "./ui/ResourceList.vue";
import Btn from "./ui/Btn.vue";
import type { PomodoroSession } from "@prizm/client-core";

const props = withDefaults(
	defineProps<{
		scope?: string;
	}>(),
	{ scope: "default" }
);

const sessions = ref<PomodoroSession[]>([]);
const loading = ref(false);

function formatSession(s: PomodoroSession) {
	const start = new Date(s.startedAt).toLocaleTimeString("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
	});
	const mins = s.durationMinutes ?? 0;
	return `${start} · ${mins} 分钟${s.tag ? ` · ${s.tag}` : ""}`;
}

async function refresh() {
	const http = manager.value?.getHttpClient();
	if (!http) return;
	loading.value = true;
	try {
		const list = await http.listPomodoroSessions({ scope: props.scope });
		sessions.value = list.slice(-10).reverse();
	} catch (e) {
		addLog(`加载番茄钟记录失败: ${String(e)}`, "error");
	} finally {
		loading.value = false;
	}
}

async function startPomodoro() {
	const http = manager.value?.getHttpClient();
	if (!http) return;
	try {
		const session = await http.startPomodoro({ scope: props.scope });
		activePomodoroId.value = session.id;
		addLog("已开始番茄钟", "success");
		await refresh();
	} catch (e) {
		addLog(`开始番茄钟失败: ${String(e)}`, "error");
	}
}

async function stopPomodoro() {
	const http = manager.value?.getHttpClient();
	if (!http || !activePomodoroId.value) {
		addLog("当前没有正在进行的番茄钟", "warning");
		return;
	}
	try {
		await http.stopPomodoro(activePomodoroId.value, props.scope);
		activePomodoroId.value = null;
		addLog("番茄钟已停止", "success");
		await refresh();
	} catch (e) {
		addLog(`停止番茄钟失败: ${String(e)}`, "error");
	}
}

watch(
	[manager, () => props.scope],
	([m]) => {
		if (m) void refresh();
	},
	{ immediate: true }
);
</script>

<style scoped>
.pomodoro-tab {
	display: flex;
	flex-direction: column;
	min-height: 0;
	overflow: hidden;
}

.tab-header {
	display: flex;
	gap: 10px;
	margin-bottom: 12px;
	flex-shrink: 0;
}
</style>
