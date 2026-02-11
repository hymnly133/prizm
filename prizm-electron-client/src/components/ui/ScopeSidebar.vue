<template>
	<aside class="scope-sidebar" aria-label="工作区与文件">
		<!-- 1. 顶部：工作区选择 -->
		<div class="sidebar-workspace-row">
			<select
				class="workspace-select"
				:value="currentScope"
				:disabled="scopesLoading"
				:title="scopeDescriptions?.[currentScope]?.description"
				@change="(e) => $emit('select', (e.target as HTMLSelectElement).value)"
			>
				<option
					v-for="s in scopes"
					:key="s"
					:value="s"
					:title="scopeDescriptions?.[s]?.description"
				>
					{{ (getScopeLabel ?? ((id: string) => id))(s) }} ({{ s }})
				</option>
			</select>
		</div>

		<!-- 2. 主区域：文件列表 -->
		<div class="sidebar-files">
			<div class="files-header">
				<span class="files-title">文件</span>
				<div class="files-add-btns">
					<button
						type="button"
						class="files-add-btn"
						aria-label="新建便签"
						title="新建便签"
						@click="$emit('add-note')"
					>
						+
					</button>
					<button
						type="button"
						class="files-add-btn"
						aria-label="新建文档"
						title="新建文档"
						@click="$emit('add-document')"
					>
						📄
					</button>
				</div>
			</div>
			<div class="files-list" v-if="!filesLoading">
				<template v-if="files.length === 0">
					<div class="files-empty">暂无文件</div>
				</template>
				<button
					v-for="f in files"
					:key="f.kind + '-' + f.id"
					type="button"
					class="file-item"
					:class="{
						active:
							selectedId && f.kind === selectedKind && f.id === selectedId,
					}"
					@click="$emit('select-file', { kind: f.kind, id: f.id })"
				>
					<span class="file-icon">{{
						f.kind === "note" ? "📝" : f.kind === "task" ? "✓" : "📄"
					}}</span>
					<span class="file-title">{{ f.title }}</span>
				</button>
			</div>
			<div v-else class="files-loading">加载中...</div>
		</div>
	</aside>
</template>

<script setup lang="ts">
import type { FileKind } from "../../composables/useFileList";
import type { FileItem } from "../../composables/useFileList";

defineProps<{
	scopes: string[];
	scopeDescriptions?: Record<string, { label: string; description: string }>;
	getScopeLabel?: (scopeId: string) => string;
	scopesLoading: boolean;
	currentScope: string;
	files: FileItem[];
	filesLoading: boolean;
	selectedKind?: FileKind | null;
	selectedId?: string | null;
}>();

defineEmits<{
	select: [scope: string];
	"select-file": [payload: { kind: FileKind; id: string }];
	"add-note": [];
	"add-document": [];
}>();
</script>

<style scoped>
.scope-sidebar {
	width: 240px;
	flex-shrink: 0;
	background: var(--bg-sidebar);
	border-right: 1px solid var(--border);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

.sidebar-workspace-row {
	padding: 10px 12px;
	border-bottom: 1px solid var(--border-subtle);
	flex-shrink: 0;
}

.workspace-select {
	width: 100%;
	padding: 8px 10px;
	border: 1px solid var(--border);
	border-radius: var(--radius-sm);
	background: var(--input-bg);
	font-size: 13px;
	font-family: inherit;
	color: var(--text);
	cursor: pointer;
}

.workspace-select:focus {
	outline: none;
	border-color: var(--accent);
}

.sidebar-files {
	flex: 1;
	display: flex;
	flex-direction: column;
	min-height: 0;
	overflow: hidden;
}

.files-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 12px 6px;
}

.files-title {
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--text-muted);
}

.files-add-btns {
	display: flex;
	gap: 4px;
}

.files-add-btn {
	width: 24px;
	height: 24px;
	display: flex;
	align-items: center;
	justify-content: center;
	border: none;
	border-radius: 4px;
	background: transparent;
	color: var(--text-muted);
	font-size: 16px;
	cursor: pointer;
}

.files-add-btn:hover {
	background: var(--hover-bg);
	color: var(--text);
}

.files-list {
	flex: 1;
	overflow-y: auto;
	padding: 4px 6px;
}

.files-empty,
.files-loading {
	padding: 16px 12px;
	font-size: 13px;
	color: var(--text-muted);
	text-align: center;
}

.file-item {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	padding: 8px 10px;
	border: none;
	border-radius: var(--radius-sm);
	background: transparent;
	color: var(--text);
	font-size: 13px;
	font-family: inherit;
	cursor: pointer;
	transition: background 0.15s;
	text-align: left;
	margin-bottom: 2px;
}

.file-item:hover {
	background: var(--hover-bg);
}

.file-item.active {
	background: var(--accent);
	color: white;
}

.file-icon {
	font-size: 14px;
	line-height: 1;
	flex-shrink: 0;
}

.file-title {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
