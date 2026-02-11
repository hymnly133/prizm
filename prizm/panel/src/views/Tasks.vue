<template>
	<div class="space-y-6">
		<div class="flex flex-wrap items-center justify-between gap-4">
			<h1 class="text-2xl font-semibold">任务 (Scope: {{ currentScope }})</h1>
			<div class="flex flex-wrap items-center gap-3">
				<select
					v-model="statusFilter"
					class="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
				>
					<option value="">全部状态</option>
					<option value="todo">待办</option>
					<option value="doing">进行中</option>
					<option value="done">已完成</option>
				</select>
				<button
					class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
					@click="showCreate = true"
				>
					新建任务
				</button>
			</div>
		</div>

		<div v-if="loading" class="text-zinc-400">加载中...</div>
		<div v-else-if="error" class="rounded bg-red-950/30 p-4 text-red-400">
			{{ error }}
		</div>

		<div v-else class="space-y-4">
			<div
				v-for="task in tasks"
				:key="task.id"
				class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4"
			>
				<div class="flex items-start justify-between gap-4">
					<div class="min-w-0 flex-1">
						<p class="font-medium text-zinc-100">{{ task.title }}</p>
						<p v-if="task.description" class="mt-1 text-sm text-zinc-400">
							{{ task.description }}
						</p>
						<p class="mt-2 flex items-center gap-3 text-xs text-zinc-500">
							<span
								class="rounded px-1.5 py-0.5"
								:class="statusClass(task.status)"
							>
								{{ statusLabel(task.status) }}
							</span>
							<span>优先级: {{ priorityLabel(task.priority) }}</span>
							<span v-if="task.dueAt">
								截止: {{ formatDate(task.dueAt) }}
							</span>
							<span>更新于 {{ formatDate(task.updatedAt) }}</span>
						</p>
					</div>
					<div class="flex gap-2">
						<button
							class="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
							@click="editTask(task)"
						>
							编辑
						</button>
						<button
							class="rounded px-2 py-1 text-sm text-red-400 hover:bg-red-950/30"
							@click="confirmDelete(task)"
						>
							删除
						</button>
					</div>
				</div>
			</div>
			<p v-if="tasks.length === 0" class="text-zinc-500">暂无任务</p>
		</div>

		<!-- Create/Edit Modal -->
		<div
			v-if="showCreate || editing"
			class="fixed inset-0 z-10 flex items-center justify-center bg-black/60"
			@click.self="closeModal"
		>
			<div
				class="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-800 p-6"
			>
				<h2 class="mb-4 text-lg font-semibold">
					{{ editing ? "编辑任务" : "新建任务" }}
				</h2>
				<div class="space-y-4">
					<div>
						<label class="mb-1 block text-sm text-zinc-400">标题 *</label>
						<input
							v-model="formTitle"
							type="text"
							class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
							placeholder="任务标题"
						/>
					</div>
					<div>
						<label class="mb-1 block text-sm text-zinc-400">描述</label>
						<textarea
							v-model="formDescription"
							class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
							rows="3"
							placeholder="任务描述"
						/>
					</div>
					<div class="flex gap-4">
						<div>
							<label class="mb-1 block text-sm text-zinc-400">状态</label>
							<select
								v-model="formStatus"
								class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
							>
								<option value="todo">待办</option>
								<option value="doing">进行中</option>
								<option value="done">已完成</option>
							</select>
						</div>
						<div>
							<label class="mb-1 block text-sm text-zinc-400">优先级</label>
							<select
								v-model="formPriority"
								class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
							>
								<option value="low">低</option>
								<option value="medium">中</option>
								<option value="high">高</option>
							</select>
						</div>
					</div>
					<div>
						<label class="mb-1 block text-sm text-zinc-400">截止时间</label>
						<input
							v-model="formDueAt"
							type="datetime-local"
							class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
						/>
					</div>
				</div>
				<div class="mt-4 flex justify-end gap-2">
					<button
						class="rounded px-4 py-2 text-zinc-400 hover:bg-zinc-700"
						@click="closeModal"
					>
						取消
					</button>
					<button
						class="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500"
						@click="saveTask"
					>
						保存
					</button>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from "vue";
import {
	getTasks,
	createTask,
	updateTask,
	deleteTask,
	type Task,
	type TaskStatus,
	type TaskPriority,
} from "../api/client";
import { useScope } from "../composables/useScope";

const { currentScope } = useScope();
const tasks = ref<Task[]>([]);
const loading = ref(true);
const error = ref("");
const showCreate = ref(false);
const editing = ref<Task | null>(null);
const statusFilter = ref("");
const formTitle = ref("");
const formDescription = ref("");
const formStatus = ref<TaskStatus>("todo");
const formPriority = ref<TaskPriority>("medium");
const formDueAt = ref("");

const filters = computed(() => ({
	status: statusFilter.value || undefined,
}));

async function load() {
	loading.value = true;
	error.value = "";
	try {
		const res = await getTasks(currentScope.value, filters.value);
		tasks.value = res.tasks ?? [];
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	} finally {
		loading.value = false;
	}
}

function formatDate(ts: number) {
	return new Date(ts).toLocaleString("zh-CN");
}

function statusLabel(s: TaskStatus) {
	const map: Record<TaskStatus, string> = {
		todo: "待办",
		doing: "进行中",
		done: "已完成",
	};
	return map[s] ?? s;
}

function statusClass(s: TaskStatus) {
	const map: Record<TaskStatus, string> = {
		todo: "bg-zinc-600 text-zinc-200",
		doing: "bg-amber-900/50 text-amber-200",
		done: "bg-emerald-900/50 text-emerald-200",
	};
	return map[s] ?? "bg-zinc-600";
}

function priorityLabel(p: TaskPriority) {
	const map: Record<TaskPriority, string> = {
		low: "低",
		medium: "中",
		high: "高",
	};
	return map[p] ?? p;
}

function editTask(task: Task) {
	editing.value = task;
	formTitle.value = task.title;
	formDescription.value = task.description ?? "";
	formStatus.value = task.status;
	formPriority.value = task.priority;
	formDueAt.value = task.dueAt
		? new Date(task.dueAt).toISOString().slice(0, 16)
		: "";
}

function closeModal() {
	showCreate.value = false;
	editing.value = null;
	formTitle.value = "";
	formDescription.value = "";
	formStatus.value = "todo";
	formPriority.value = "medium";
	formDueAt.value = "";
}

async function saveTask() {
	const title = formTitle.value.trim();
	if (!title) {
		error.value = "标题不能为空";
		return;
	}
	const scope = currentScope.value;
	try {
		const payload = {
			title,
			description: formDescription.value.trim() || undefined,
			status: formStatus.value,
			priority: formPriority.value,
			dueAt: formDueAt.value ? new Date(formDueAt.value).getTime() : undefined,
		};
		if (editing.value) {
			await updateTask(editing.value.id, payload, scope);
		} else {
			await createTask(payload, scope);
		}
		closeModal();
		await load();
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	}
}

async function confirmDelete(task: Task) {
	if (!confirm("确定删除该任务？")) return;
	try {
		await deleteTask(task.id, currentScope.value);
		await load();
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	}
}

onMounted(load);
watch(currentScope, load);
watch(statusFilter, load);
</script>
