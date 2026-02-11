<template>
	<section class="work-page">
		<ScopeSidebar
			:scopes="scopes"
			:scope-descriptions="scopeDescriptions"
			:get-scope-label="getScopeLabel"
			:scopes-loading="scopesLoading"
			:current-scope="currentScope"
			:files="fileList"
			:files-loading="fileListLoading"
			:selected-kind="selectedFile?.kind ?? null"
			:selected-id="selectedFile?.id ?? null"
			@select="setScope"
			@select-file="onSelectFile"
			@add-note="onAddNote"
			@add-document="onAddDocument"
		/>

		<div class="work-content">
			<div class="work-toolbar">
				<SearchSection
					ref="searchRef"
					v-model:active-tab="activeTab"
					:scope="currentScope"
					@refresh-notes="() => refreshFileList(currentScope.value)"
					@refresh-tasks="() => refreshFileList(currentScope.value)"
					@refresh-clipboard="() => {}"
					@select-file="onSelectFile"
				/>
			</div>

			<div class="work-detail">
				<FileDetailView
					:file="selectedFileData"
					@delete="onDeleteFile"
					@done="onDoneTask"
				/>
			</div>
		</div>
	</section>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import ScopeSidebar from "../components/ui/ScopeSidebar.vue";
import SearchSection from "../components/SearchSection.vue";
import FileDetailView from "../components/FileDetailView.vue";
import {
	currentScope,
	scopes,
	scopesLoading,
	scopeDescriptions,
	getScopeLabel,
	setScope,
} from "../composables/useScope";
import {
	fileList,
	fileListLoading,
	refreshFileList,
	useFileList,
	type FileItem,
	type FileKind,
} from "../composables/useFileList";
import { manager } from "../composables/usePrizm";
import { addLog } from "../composables/useLogs";

const activeTab = ref("notes");

useFileList(currentScope);

const selectedFile = ref<{ kind: FileKind; id: string } | null>(null);

// scope 切换时清空选中并刷新列表（确保显示当前 scope 的文件）
watch(currentScope, () => {
	selectedFile.value = null;
});

const selectedFileData = computed<FileItem | null>(() => {
	if (!selectedFile.value) return null;
	const { kind, id } = selectedFile.value;
	return fileList.value.find((f) => f.kind === kind && f.id === id) ?? null;
});

function onSelectFile(payload: { kind: FileKind; id: string }) {
	selectedFile.value = payload;
}

async function onAddNote() {
	const http = manager.value?.getHttpClient();
	if (!http) return;
	try {
		const note = await http.createNote({ content: "" }, currentScope.value);
		await refreshFileList(currentScope.value);
		selectedFile.value = { kind: "note", id: note.id };
		addLog("已创建便签", "success");
	} catch (e) {
		addLog(`创建便签失败: ${String(e)}`, "error");
	}
}

async function onAddDocument() {
	const http = manager.value?.getHttpClient();
	if (!http) return;
	try {
		const doc = await http.createDocument(
			{ title: "未命名文档", content: "" },
			currentScope.value
		);
		await refreshFileList(currentScope.value);
		selectedFile.value = { kind: "document", id: doc.id };
		addLog("已创建文档", "success");
	} catch (e) {
		addLog(`创建文档失败: ${String(e)}`, "error");
	}
}

async function onDeleteFile() {
	const f = selectedFileData.value;
	if (!f || !manager.value) return;
	const http = manager.value.getHttpClient();
	try {
		if (f.kind === "note") {
			await http.deleteNote(f.id, currentScope.value);
		} else if (f.kind === "task") {
			await http.deleteTask(f.id, currentScope.value);
		} else {
			await http.deleteDocument(f.id, currentScope.value);
		}
		selectedFile.value = null;
		await refreshFileList(currentScope.value);
		addLog("已删除", "success");
	} catch (e) {
		addLog(`删除失败: ${String(e)}`, "error");
	}
}

async function onDoneTask() {
	const f = selectedFileData.value;
	if (!f || f.kind !== "task" || !manager.value) return;
	const http = manager.value.getHttpClient();
	try {
		await http.updateTask(f.id, { status: "done" }, currentScope.value);
		await refreshFileList(currentScope.value);
		addLog("任务已完成", "success");
	} catch (e) {
		addLog(`更新失败: ${String(e)}`, "error");
	}
}

const searchRef = ref<InstanceType<typeof SearchSection> | null>(null);
</script>

<style scoped>
.work-page {
	display: flex;
	flex: 1;
	min-height: 0;
	overflow: hidden;
}

.work-content {
	flex: 1;
	display: flex;
	flex-direction: column;
	min-height: 0;
	overflow: hidden;
}

.work-toolbar {
	padding: 12px 16px;
	border-bottom: 1px solid var(--border);
	flex-shrink: 0;
}

.work-toolbar .search-section {
	width: 100%;
}

.work-detail {
	flex: 1;
	min-height: 0;
	overflow: hidden;
	background: var(--bg-elevated);
}
</style>
