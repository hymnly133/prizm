<template>
	<div class="space-y-6">
		<div class="flex flex-wrap items-center justify-between gap-4">
			<h1 class="text-2xl font-semibold">番茄钟 (Scope: {{ currentScope }})</h1>
			<div class="flex flex-wrap items-center gap-3">
				<input
					v-model="newTag"
					type="text"
					class="w-32 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
					placeholder="标签（可选）"
				/>
				<button
					class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
					:disabled="loading || !!runningSession"
					@click="startSession"
				>
					{{ runningSession ? "进行中..." : "开始番茄钟" }}
				</button>
			</div>
		</div>

		<div v-if="loading" class="text-zinc-400">加载中...</div>
		<div v-else-if="error" class="rounded bg-red-950/30 p-4 text-red-400">
			{{ error }}
		</div>

		<div v-else class="space-y-4">
			<div
				v-for="session in sessions"
				:key="session.id"
				class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4"
				:class="{ 'border-emerald-600/50': isRunning(session) }"
			>
				<div class="flex items-start justify-between gap-4">
					<div class="min-w-0 flex-1">
						<p class="flex items-center gap-2 font-medium text-zinc-100">
							{{ formatDate(session.startedAt) }}
							<span
								v-if="isRunning(session)"
								class="rounded bg-emerald-900/50 px-1.5 py-0.5 text-xs text-emerald-300"
							>
								进行中
							</span>
							<span
								v-if="session.tag"
								class="rounded bg-zinc-600 px-1.5 py-0.5 text-xs text-zinc-300"
							>
								{{ session.tag }}
							</span>
						</p>
						<p class="mt-1 text-sm text-zinc-400">
							时长: {{ session.durationMinutes }} 分钟
							<span v-if="session.taskId"> · 任务: {{ session.taskId }}</span>
						</p>
					</div>
					<div v-if="isRunning(session)" class="flex gap-2">
						<button
							class="rounded bg-amber-600 px-3 py-1 text-sm text-white hover:bg-amber-500"
							@click="stopSession(session)"
						>
							结束
						</button>
					</div>
				</div>
			</div>
			<p v-if="sessions.length === 0" class="text-zinc-500">暂无番茄钟记录</p>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import {
	getPomodoroSessions,
	startPomodoro,
	stopPomodoro,
	type PomodoroSession,
} from "../api/client";
import { useScope } from "../composables/useScope";

const { currentScope } = useScope();
const sessions = ref<PomodoroSession[]>([]);
const loading = ref(true);
const error = ref("");
const newTag = ref("");
const runningSession = ref<PomodoroSession | null>(null);

function isRunning(s: PomodoroSession) {
	return runningSession.value?.id === s.id;
}

async function load() {
	loading.value = true;
	error.value = "";
	try {
		const res = await getPomodoroSessions(currentScope.value);
		sessions.value = res.sessions ?? [];
		const running = sessions.value.find(isRunning);
		runningSession.value = running ?? null;
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	} finally {
		loading.value = false;
	}
}

function formatDate(ts: number) {
	return new Date(ts).toLocaleString("zh-CN");
}

async function startSession() {
	if (runningSession.value) return;
	try {
		const payload = newTag.value.trim() ? { tag: newTag.value.trim() } : {};
		const res = await startPomodoro(payload, currentScope.value);
		sessions.value = [res.session, ...sessions.value];
		runningSession.value = res.session;
		newTag.value = "";
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	}
}

async function stopSession(session: PomodoroSession) {
	try {
		const res = await stopPomodoro(session.id, currentScope.value);
		const idx = sessions.value.findIndex((s) => s.id === session.id);
		if (idx >= 0) sessions.value[idx] = res.session;
		runningSession.value = null;
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	}
}

onMounted(load);
watch(currentScope, load);
</script>
