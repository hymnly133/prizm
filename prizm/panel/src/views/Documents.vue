<template>
	<div class="space-y-6">
		<div class="flex items-center justify-between">
			<h1 class="text-2xl font-semibold">文档 (Scope: {{ currentScope }})</h1>
			<button
				class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
				@click="showCreate = true"
			>
				新建文档
			</button>
		</div>

		<div v-if="loading" class="text-zinc-400">加载中...</div>
		<div v-else-if="error" class="rounded bg-red-950/30 p-4 text-red-400">
			{{ error }}
		</div>

		<div v-else class="space-y-4">
			<div
				v-for="doc in documents"
				:key="doc.id"
				class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4"
			>
				<div class="flex items-start justify-between gap-4">
					<div class="min-w-0 flex-1">
						<p class="font-medium text-zinc-100">{{ doc.title }}</p>
						<p
							v-if="doc.content"
							class="mt-1 max-h-20 overflow-hidden text-ellipsis text-sm text-zinc-400 line-clamp-2"
						>
							{{ doc.content }}
						</p>
						<p class="mt-2 text-xs text-zinc-500">
							更新于 {{ formatDate(doc.updatedAt) }}
						</p>
					</div>
					<div class="flex gap-2">
						<button
							class="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
							@click="editDoc(doc)"
						>
							编辑
						</button>
						<button
							class="rounded px-2 py-1 text-sm text-red-400 hover:bg-red-950/30"
							@click="confirmDelete(doc)"
						>
							删除
						</button>
					</div>
				</div>
			</div>
			<p v-if="documents.length === 0" class="text-zinc-500">暂无文档</p>
		</div>

		<!-- Create/Edit Modal -->
		<div
			v-if="showCreate || editing"
			class="fixed inset-0 z-10 flex items-center justify-center bg-black/60"
			@click.self="closeModal"
		>
			<div
				class="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-zinc-700 bg-zinc-800 p-6"
			>
				<h2 class="mb-4 text-lg font-semibold">
					{{ editing ? "编辑文档" : "新建文档" }}
				</h2>
				<div class="flex flex-1 flex-col gap-4 overflow-hidden">
					<div>
						<label class="mb-1 block text-sm text-zinc-400">标题 *</label>
						<input
							v-model="formTitle"
							type="text"
							class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
							placeholder="文档标题"
						/>
					</div>
					<div class="min-h-0 flex-1">
						<label class="mb-1 block text-sm text-zinc-400"
							>内容（支持 Markdown）</label
						>
						<textarea
							v-model="formContent"
							class="h-48 w-full resize-none rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
							placeholder="文档内容..."
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
						@click="saveDoc"
					>
						保存
					</button>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import {
	getDocuments,
	createDocument,
	updateDocument,
	deleteDocument,
	type Document,
} from "../api/client";
import { useScope } from "../composables/useScope";

const { currentScope } = useScope();
const documents = ref<Document[]>([]);
const loading = ref(true);
const error = ref("");
const showCreate = ref(false);
const editing = ref<Document | null>(null);
const formTitle = ref("");
const formContent = ref("");

async function load() {
	loading.value = true;
	error.value = "";
	try {
		const res = await getDocuments(currentScope.value);
		documents.value = res.documents ?? [];
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	} finally {
		loading.value = false;
	}
}

function formatDate(ts: number) {
	return new Date(ts).toLocaleString("zh-CN");
}

function editDoc(doc: Document) {
	editing.value = doc;
	formTitle.value = doc.title;
	formContent.value = doc.content ?? "";
}

function closeModal() {
	showCreate.value = false;
	editing.value = null;
	formTitle.value = "";
	formContent.value = "";
}

async function saveDoc() {
	const title = formTitle.value.trim();
	if (!title) {
		error.value = "标题不能为空";
		return;
	}
	const scope = currentScope.value;
	try {
		const payload = { title, content: formContent.value.trim() || undefined };
		if (editing.value) {
			await updateDocument(editing.value.id, payload, scope);
		} else {
			await createDocument(payload, scope);
		}
		closeModal();
		await load();
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	}
}

async function confirmDelete(doc: Document) {
	if (!confirm("确定删除该文档？")) return;
	try {
		await deleteDocument(doc.id, currentScope.value);
		await load();
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	}
}

onMounted(load);
watch(currentScope, load);
</script>
