<template>
	<div class="space-y-6">
		<p class="rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2 text-sm text-zinc-400">
			本页可查看剪贴板历史；日常使用推荐使用 Electron 客户端。
		</p>
		<div class="flex flex-wrap items-center justify-between gap-4">
			<h1 class="text-2xl font-semibold">
				剪贴板历史 (Scope: {{ currentScope }})
			</h1>
			<div class="flex flex-wrap items-center gap-3">
				<select
					v-model="limit"
					class="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
				>
					<option :value="20">最近 20 条</option>
					<option :value="50">最近 50 条</option>
					<option :value="100">最近 100 条</option>
				</select>
				<button
					class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
					@click="showAdd = true"
				>
					手动添加
				</button>
			</div>
		</div>

		<div v-if="loading" class="text-zinc-400">加载中...</div>
		<div v-else-if="error" class="rounded bg-red-950/30 p-4 text-red-400">
			{{ error }}
		</div>

		<div v-else class="space-y-4">
			<div
				v-for="item in items"
				:key="item.id"
				class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4"
			>
				<div class="flex items-start justify-between gap-4">
					<div class="min-w-0 flex-1">
						<p class="text-xs text-zinc-500">
							{{ typeLabel(item.type) }}
							<span v-if="item.sourceApp"> · {{ item.sourceApp }}</span>
							· {{ formatDate(item.createdAt) }}
						</p>
						<p
							class="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words text-zinc-100"
						>
							{{ truncate(item.content) }}
						</p>
					</div>
					<div class="flex gap-2">
						<button
							class="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
							@click="copyToClipboard(item.content)"
						>
							复制
						</button>
						<button
							class="rounded px-2 py-1 text-sm text-red-400 hover:bg-red-950/30"
							@click="confirmDelete(item)"
						>
							删除
						</button>
					</div>
				</div>
			</div>
			<p v-if="items.length === 0" class="text-zinc-500">暂无剪贴板记录</p>
		</div>

		<!-- Add Modal -->
		<div
			v-if="showAdd"
			class="fixed inset-0 z-10 flex items-center justify-center bg-black/60"
			@click.self="showAdd = false"
		>
			<div
				class="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-800 p-6"
			>
				<h2 class="mb-4 text-lg font-semibold">手动添加</h2>
				<div class="space-y-4">
					<div>
						<label class="mb-1 block text-sm text-zinc-400">类型</label>
						<select
							v-model="addType"
							class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
						>
							<option value="text">文本</option>
							<option value="image">图片</option>
							<option value="file">文件</option>
							<option value="other">其他</option>
						</select>
					</div>
					<div>
						<label class="mb-1 block text-sm text-zinc-400">内容 *</label>
						<textarea
							v-model="addContent"
							class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
							rows="4"
							placeholder="粘贴或输入内容"
						/>
					</div>
				</div>
				<div class="mt-4 flex justify-end gap-2">
					<button
						class="rounded px-4 py-2 text-zinc-400 hover:bg-zinc-700"
						@click="showAdd = false"
					>
						取消
					</button>
					<button
						class="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500"
						:disabled="!addContent.trim()"
						@click="submitAdd"
					>
						添加
					</button>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import {
	getClipboardHistory,
	addClipboardItem,
	deleteClipboardItem,
	type ClipboardItem,
	type ClipboardItemType,
} from "../api/client";
import { useScope } from "../composables/useScope";

const { currentScope } = useScope();
const items = ref<ClipboardItem[]>([]);
const loading = ref(true);
const error = ref("");
const showAdd = ref(false);
const limit = ref(50);
const addType = ref<ClipboardItemType>("text");
const addContent = ref("");

async function load() {
	loading.value = true;
	error.value = "";
	try {
		const res = await getClipboardHistory(currentScope.value, limit.value);
		items.value = res.items ?? [];
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	} finally {
		loading.value = false;
	}
}

function formatDate(ts: number) {
	return new Date(ts).toLocaleString("zh-CN");
}

function typeLabel(t: ClipboardItemType) {
	const map: Record<ClipboardItemType, string> = {
		text: "文本",
		image: "图片",
		file: "文件",
		other: "其他",
	};
	return map[t] ?? t;
}

function truncate(s: string, max = 200) {
	if (!s) return "(无内容)";
	return s.length > max ? s.slice(0, max) + "..." : s;
}

async function copyToClipboard(text: string) {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		// fallback
	}
}

async function submitAdd() {
	const content = addContent.value.trim();
	if (!content) return;
	try {
		await addClipboardItem(
			{ type: addType.value, content },
			currentScope.value
		);
		showAdd.value = false;
		addContent.value = "";
		await load();
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	}
}

async function confirmDelete(item: ClipboardItem) {
	if (!confirm("确定删除该条记录？")) return;
	try {
		await deleteClipboardItem(item.id, currentScope.value);
		await load();
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	}
}

onMounted(load);
watch(currentScope, load);
watch(limit, load);
</script>
