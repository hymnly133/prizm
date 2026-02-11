<template>
	<div class="file-detail" v-if="file">
		<div class="file-detail-header">
			<span class="file-detail-kind">{{
				file.kind === "note" ? "便签" : file.kind === "task" ? "任务" : "文档"
			}}</span>
			<Btn variant="danger" size="sm" @click="$emit('delete')">删除</Btn>
		</div>
		<div class="file-detail-body">
			<!-- 便签 -->
			<div v-if="file.kind === 'note'" class="note-detail">
				<div class="md-preview-wrap">
					<MdPreview
						:model-value="(file.raw as StickyNote).content || '(空)'"
						:editor-id="'detail-note-' + file.id"
					/>
				</div>
			</div>
			<!-- 文档 -->
			<div v-else-if="file.kind === 'document'" class="document-detail">
				<input
					v-model="docTitle"
					class="document-title-input"
					placeholder="文档标题"
					@blur="onDocumentTitleBlur"
				/>
				<div class="document-editor-wrap">
					<MdEditor
						v-model="docContent"
						:editor-id="'detail-doc-' + file.id"
						placeholder="输入文档内容，支持 Markdown..."
						@onBlur="saveDocumentContent"
						@onChange="debouncedSaveContent"
					/>
				</div>
			</div>
			<!-- 任务 -->
			<div v-else class="task-detail">
				<h2 class="task-title">{{ (file.raw as Task).title }}</h2>
				<div class="task-meta">
					<span class="task-status">[{{ (file.raw as Task).status }}]</span>
					<span class="task-priority"
						>优先级: {{ (file.raw as Task).priority }}</span
					>
				</div>
				<p v-if="(file.raw as Task).description" class="task-desc">
					{{ (file.raw as Task).description }}
				</p>
				<div class="task-actions">
					<Btn
						v-if="(file.raw as Task).status !== 'done'"
						variant="primary"
						size="sm"
						@click="$emit('done')"
					>
						标记完成
					</Btn>
				</div>
			</div>
		</div>
	</div>
	<div v-else class="file-detail-empty">
		<p class="empty-title">选择文件</p>
		<p class="empty-desc">在左侧列表中点击一个文件查看详情</p>
	</div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { MdPreview, MdEditor } from "md-editor-v3";
import "md-editor-v3/lib/preview.css";
import "md-editor-v3/lib/style.css";
import Btn from "./ui/Btn.vue";
import type { FileItem } from "../composables/useFileList";
import type { StickyNote, Task, Document } from "@prizm/client-core";
import { manager } from "../composables/usePrizm";
import { currentScope } from "../composables/useScope";
import { refreshFileList } from "../composables/useFileList";

const props = defineProps<{
	file: FileItem | null;
}>();

defineEmits<{
	delete: [];
	done: [];
}>();

const docTitle = ref("");
const docContent = ref("");

watch(
	() => props.file,
	(f) => {
		if (f?.kind === "document") {
			const d = f.raw as Document;
			docTitle.value = d.title || "";
			docContent.value = d.content ?? "";
		}
	},
	{ immediate: true }
);

async function onDocumentTitleBlur() {
	const f = props.file;
	if (!f || f.kind !== "document" || !manager.value) return;
	const raw = f.raw as Document;
	if (docTitle.value === raw.title) return;
	try {
		await manager.value
			.getHttpClient()
			.updateDocument(f.id, { title: docTitle.value }, currentScope.value);
		await refreshFileList(currentScope.value);
	} catch {
		docTitle.value = raw.title;
	}
}

let contentSaveTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSaveContent() {
	if (contentSaveTimer) clearTimeout(contentSaveTimer);
	contentSaveTimer = setTimeout(() => {
		contentSaveTimer = null;
		void saveDocumentContent();
	}, 800);
}

async function saveDocumentContent() {
	const f = props.file;
	if (!f || f.kind !== "document" || !manager.value) return;
	const raw = f.raw as Document;
	if (docContent.value === (raw.content ?? "")) return;
	try {
		await manager.value
			.getHttpClient()
			.updateDocument(f.id, { content: docContent.value }, currentScope.value);
		await refreshFileList(currentScope.value);
	} catch {
		docContent.value = raw.content ?? "";
	}
}
</script>

<style scoped>
.file-detail {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
	overflow: hidden;
}

.file-detail-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 12px 16px;
	border-bottom: 1px solid var(--border);
	flex-shrink: 0;
}

.file-detail-kind {
	font-size: 12px;
	font-weight: 500;
	color: var(--text-muted);
}

.file-detail-body {
	flex: 1;
	overflow-y: auto;
	padding: 16px;
}

.note-detail :deep(.md-editor-preview-wrapper) {
	padding: 0;
	font-size: 14px;
	line-height: 1.6;
}

.note-detail :deep(.md-editor-preview-wrapper h1) {
	font-size: 1.5em;
}
.note-detail :deep(.md-editor-preview-wrapper h2) {
	font-size: 1.25em;
}
.note-detail :deep(.md-editor-preview-wrapper h3) {
	font-size: 1.1em;
}

.document-detail {
	max-width: 720px;
}

.document-title-input {
	width: 100%;
	padding: 12px 0;
	margin-bottom: 12px;
	border: none;
	border-bottom: 1px solid var(--border);
	background: transparent;
	font-size: 20px;
	font-weight: 600;
	font-family: inherit;
	color: var(--text);
}

.document-title-input:focus {
	outline: none;
	border-bottom-color: var(--accent);
}

.document-editor-wrap {
	margin-top: 12px;
}

.document-editor-wrap :deep(.md-editor) {
	min-height: 200px;
}

.task-detail {
	max-width: 600px;
}

.task-title {
	font-size: 18px;
	font-weight: 600;
	margin-bottom: 12px;
	color: var(--text);
}

.task-meta {
	display: flex;
	gap: 16px;
	margin-bottom: 12px;
	font-size: 13px;
	color: var(--text-muted);
}

.task-desc {
	font-size: 14px;
	line-height: 1.6;
	color: var(--text);
	margin-bottom: 16px;
	white-space: pre-wrap;
}

.task-actions {
	margin-top: 16px;
}

.file-detail-empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	height: 100%;
	padding: 48px;
	text-align: center;
	color: var(--text-muted);
}

.empty-title {
	font-size: 16px;
	font-weight: 500;
	color: var(--text);
	margin-bottom: 8px;
}

.empty-desc {
	font-size: 14px;
	line-height: 1.5;
}
</style>
