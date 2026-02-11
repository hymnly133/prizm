/**
 * useFileList - 工作区内的文件列表（便签 + 任务）
 */
import { ref, watch } from "vue";
import { manager, lastSyncEvent } from "./usePrizm";
import type { StickyNote, Task, Document } from "@prizm/client-core";

export type FileKind = "note" | "task" | "document";

export interface FileItem {
	kind: FileKind;
	id: string;
	title: string;
	updatedAt: number;
	raw: StickyNote | Task | Document;
}

export const fileList = ref<FileItem[]>([]);
export const fileListLoading = ref(false);

function noteToTitle(n: StickyNote): string {
	const firstLine = (n.content || "").split("\n")[0]?.trim();
	return firstLine || "(无标题)";
}

export async function refreshFileList(scope: string): Promise<void> {
	const http = manager.value?.getHttpClient();
	if (!http) return;
	fileListLoading.value = true;
	try {
		const [notes, tasks, documents] = await Promise.all([
			http.listNotes({ scope }),
			http.listTasks({ scope }),
			http.listDocuments({ scope }),
		]);

		const items: FileItem[] = [
			...notes.map((n) => ({
				kind: "note" as const,
				id: n.id,
				title: noteToTitle(n),
				updatedAt: n.updatedAt,
				raw: n,
			})),
			...tasks.map((t) => ({
				kind: "task" as const,
				id: t.id,
				title: t.title || "(无标题)",
				updatedAt: t.updatedAt,
				raw: t,
			})),
			...documents.map((d) => ({
				kind: "document" as const,
				id: d.id,
				title: d.title || "(无标题文档)",
				updatedAt: d.updatedAt,
				raw: d,
			})),
		];

		items.sort((a, b) => b.updatedAt - a.updatedAt);
		fileList.value = items;
	} catch {
		fileList.value = [];
	} finally {
		fileListLoading.value = false;
	}
}

export function useFileList(scopeRef: { value: string }) {
	// 使用 getter 确保 scope 变化时正确触发刷新
	watch(
		() => [manager.value, scopeRef.value] as const,
		([m, scope]) => {
			if (m && scope) void refreshFileList(scope);
		},
		{ immediate: true }
	);

	watch(lastSyncEvent, (ev) => {
		if (
			ev &&
			(ev.startsWith("note:") ||
				ev.startsWith("task:") ||
				ev.startsWith("document:"))
		) {
			if (scopeRef.value) void refreshFileList(scopeRef.value);
		}
	});

	return { fileList, fileListLoading, refreshFileList };
}
