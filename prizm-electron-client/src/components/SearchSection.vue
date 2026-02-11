<template>
	<div class="search-section" ref="sectionRef">
		<div class="search-input-wrap">
			<span class="search-icon" aria-hidden="true">⌘</span>
			<input
				ref="inputRef"
				v-model="query"
				type="text"
				placeholder="搜索便签、任务、剪贴板... (Ctrl+K)"
				class="search-input"
				aria-label="全局搜索"
				:aria-expanded="showResults"
				aria-controls="search-results"
				@focus="onFocus"
				@keydown.enter="onEnter"
				@keydown.down.prevent="focusNext"
				@keydown.up.prevent="focusPrev"
			/>
		</div>
		<div
			id="search-results"
			class="search-results"
			:class="{ hidden: !showResults }"
			role="listbox"
			aria-label="搜索结果"
		>
			<template v-if="results.length === 0 && query.trim()">
				<div
					class="search-result-item search-result-empty"
					role="option"
					aria-selected="false"
				>
					无匹配结果
				</div>
			</template>
			<template v-else>
				<div
					v-for="(r, i) in results"
					:key="r.id + r.kind"
					class="search-result-item"
					:class="{ focused: focusedIndex === i }"
					:ref="(el) => setItemRef(el as HTMLElement, i)"
					role="option"
					:aria-selected="focusedIndex === i"
					tabindex="-1"
					@click="handleClick(r)"
					@mouseenter="focusedIndex = i"
				>
					<span :class="['search-result-badge', r.kind]">
						{{
							r.kind === "note"
								? "便签"
								: r.kind === "task"
								? "任务"
								: r.kind === "document"
								? "文档"
								: "剪贴板"
						}}
					</span>
					<span class="search-result-preview">{{ r.preview || "(空)" }}</span>
				</div>
			</template>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useDebounce } from "../composables/useDebounce";
import { manager } from "../composables/usePrizm";
import { addLog } from "../composables/useLogs";
import type {
	StickyNote,
	Task,
	ClipboardItem,
	Document,
} from "@prizm/client-core";

type SearchResultKind = "note" | "task" | "clipboard" | "document";

interface SearchResult {
	kind: SearchResultKind;
	id: string;
	preview: string;
	raw?: StickyNote | Task | ClipboardItem | Document;
}

const props = withDefaults(
	defineProps<{
		activeTab: string;
		scope?: string;
	}>(),
	{ scope: "default" }
);

const emit = defineEmits<{
	"update:activeTab": [value: string];
	refreshNotes: [];
	refreshTasks: [];
	refreshClipboard: [];
	"select-file"?: [payload: { kind: "note" | "task" | "document"; id: string }];
}>();

const query = ref("");
const results = ref<SearchResult[]>([]);
const showResults = ref(false);
const focusedIndex = ref(0);
const sectionRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const itemRefs = ref<(HTMLElement | null)[]>([]);

function setItemRef(el: HTMLElement | null, i: number) {
	itemRefs.value[i] = el;
}

const debouncedQuery = useDebounce(query, 200);

watch([debouncedQuery, () => props.scope], async ([q]) => {
	if (!q.trim()) {
		showResults.value = false;
		results.value = [];
		return;
	}
	results.value = await performSearch();
	showResults.value = true;
	focusedIndex.value = 0;
});

async function performSearch(): Promise<SearchResult[]> {
	const http = manager.value?.getHttpClient();
	if (!http || !query.value.trim()) return [];

	const q = query.value.trim().toLowerCase();
	const out: SearchResult[] = [];

	const scope = props.scope ?? "default";
	try {
		const [notes, tasks, clipboardItems, documents] = await Promise.all([
			http.listNotes({ q, scope }),
			http.listTasks({ scope }),
			http.getClipboardHistory({ limit: 50, scope }),
			http.listDocuments({ scope }),
		]);

		for (const n of notes) {
			const text = n.content || "";
			out.push({
				kind: "note",
				id: n.id,
				preview: text.length > 60 ? text.slice(0, 60) + "…" : text,
				raw: n,
			});
		}

		for (const t of tasks) {
			const title = t.title || "";
			const desc = t.description || "";
			if (title.toLowerCase().includes(q) || desc.toLowerCase().includes(q)) {
				out.push({
					kind: "task",
					id: t.id,
					preview: `${title}${desc ? ` · ${desc.slice(0, 30)}` : ""}`,
					raw: t,
				});
			}
		}

		for (const c of clipboardItems) {
			if (c.content.toLowerCase().includes(q)) {
				const preview =
					c.content.length > 60 ? c.content.slice(0, 60) + "…" : c.content;
				out.push({ kind: "clipboard", id: c.id, preview, raw: c });
			}
		}

		for (const d of documents) {
			const title = d.title || "";
			const content = d.content || "";
			if (
				title.toLowerCase().includes(q) ||
				content.toLowerCase().includes(q)
			) {
				const preview =
					title || (content.length > 60 ? content.slice(0, 60) + "…" : content);
				out.push({
					kind: "document",
					id: d.id,
					preview: preview || "(空)",
					raw: d,
				});
			}
		}
	} catch (e) {
		addLog(`搜索失败: ${String(e)}`, "error");
	}

	return out;
}

async function onFocus() {
	if (query.value.trim()) {
		results.value = await performSearch();
		showResults.value = true;
		focusedIndex.value = 0;
	}
}

function focusNext() {
	if (results.value.length) {
		focusedIndex.value = (focusedIndex.value + 1) % results.value.length;
		itemRefs.value[focusedIndex.value]?.scrollIntoView({ block: "nearest" });
	}
}

function focusPrev() {
	if (results.value.length) {
		focusedIndex.value =
			(focusedIndex.value - 1 + results.value.length) % results.value.length;
		itemRefs.value[focusedIndex.value]?.scrollIntoView({ block: "nearest" });
	}
}

function handleClick(r: SearchResult) {
	query.value = "";
	showResults.value = false;
	results.value = [];

	if (r.kind === "note") {
		emit("update:activeTab", "notes");
		emit("refreshNotes");
		emit("select-file", { kind: "note", id: r.id });
	} else if (r.kind === "task") {
		emit("update:activeTab", "tasks");
		emit("refreshTasks");
		emit("select-file", { kind: "task", id: r.id });
	} else if (r.kind === "document") {
		emit("update:activeTab", "notes");
		emit("refreshNotes");
		emit("select-file", { kind: "document", id: r.id });
	} else if (r.kind === "clipboard" && r.raw && "content" in r.raw) {
		void window.prizm.writeClipboard(r.raw.content);
		addLog("已复制到剪贴板", "success");
		emit("update:activeTab", "clipboard");
		emit("refreshClipboard");
	}
}

async function onEnter(e: KeyboardEvent) {
	if (!query.value.trim()) return;
	if (results.value.length > 0 && showResults.value) {
		const r = results.value[focusedIndex.value];
		if (r) {
			e.preventDefault();
			handleClick(r);
		}
		return;
	}
	// 无结果：快速创建便签
	const http = manager.value?.getHttpClient();
	if (!http) return;
	e.preventDefault();
	const content = query.value.trim();
	query.value = "";
	showResults.value = false;
	results.value = [];
	try {
		const note = await http.createNote({ content }, props.scope);
		addLog("已创建便签", "success");
		emit("update:activeTab", "notes");
		emit("refreshNotes");
		emit("select-file", { kind: "note", id: note.id });
	} catch (err) {
		addLog(`创建便签失败: ${String(err)}`, "error");
	}
}

function handleClickOutside(e: MouseEvent) {
	if (sectionRef.value && !sectionRef.value.contains(e.target as Node)) {
		showResults.value = false;
	}
}

onMounted(() => {
	document.addEventListener("click", handleClickOutside);
	document.addEventListener("keydown", (e) => {
		if ((e.ctrlKey || e.metaKey) && e.key === "k") {
			e.preventDefault();
			inputRef.value?.focus();
		}
	});
});

onUnmounted(() => {
	document.removeEventListener("click", handleClickOutside);
});
</script>

<style scoped>
.search-section {
	position: relative;
	flex-shrink: 0;
}

.search-input-wrap {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 14px;
	border-radius: var(--radius-md);
	border: 1px solid var(--border);
	background: var(--input-bg);
	transition: border-color 0.15s, box-shadow 0.15s;
}

.search-input-wrap:focus-within {
	border-color: var(--accent);
	box-shadow: 0 0 0 3px var(--focus-ring);
}

.search-icon {
	font-size: 12px;
	color: var(--text-muted);
}

.search-input {
	flex: 1;
	border: none;
	background: transparent;
	font-size: 14px;
	font-family: inherit;
	color: var(--text);
}

.search-input:focus {
	outline: none;
}

.search-input::placeholder {
	color: var(--text-muted);
}

.search-results {
	position: absolute;
	top: 100%;
	left: 0;
	right: 0;
	margin-top: 6px;
	max-height: 280px;
	overflow-y: auto;
	background: var(--bg-elevated);
	border: 1px solid var(--border);
	border-radius: var(--radius-md);
	box-shadow: var(--shadow);
	z-index: 100;
}

.search-results.hidden {
	display: none;
}

.search-result-item {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 14px;
	cursor: pointer;
	border-bottom: 1px solid var(--border-subtle);
	font-size: 13px;
	transition: background 0.1s;
}

.search-result-item:last-child {
	border-bottom: none;
}

.search-result-item:hover,
.search-result-item.focused {
	background: var(--hover-bg);
}

.search-result-empty {
	cursor: default;
	color: var(--text-muted);
}

.search-result-badge {
	padding: 2px 8px;
	border-radius: 4px;
	font-size: 11px;
	font-weight: 600;
	flex-shrink: 0;
}

.search-result-badge.note {
	background: #dbeafe;
	color: #1d4ed8;
}

.search-result-badge.task {
	background: #fef3c7;
	color: #b45309;
}

.search-result-badge.clipboard {
	background: #d1fae5;
	color: #047857;
}

.search-result-badge.document {
	background: #e9d5ff;
	color: #6b21a8;
}

.search-result-preview {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
