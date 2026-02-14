/**
 * useFileList - 工作区内的文件列表（便签 + 任务 + 文档）
 */
import { useState, useCallback, useEffect } from "react";
import { usePrizmContext } from "../context/PrizmContext";
import { subscribeSyncEvents } from "../events/syncEventEmitter";
import type { StickyNote, Task, Document } from "@prizm/client-core";

const SYNC_REFRESH_DEBOUNCE_MS = 400;

export type FileKind = "note" | "task" | "document";

export interface FileItem {
	kind: FileKind;
	id: string;
	title: string;
	updatedAt: number;
	raw: StickyNote | Task | Document;
}

function noteToTitle(n: StickyNote): string {
	const firstLine = (n.content || "").split("\n")[0]?.trim();
	return firstLine || "(无标题)";
}

function isFileSyncEvent(eventType: string): boolean {
	return (
		eventType.startsWith("note:") ||
		eventType.startsWith("task:") ||
		eventType.startsWith("document:")
	);
}

export function useFileList(scope: string) {
	const { manager } = usePrizmContext();
	const [fileList, setFileList] = useState<FileItem[]>([]);
	const [fileListLoading, setFileListLoading] = useState(false);

	const refreshFileList = useCallback(
		async (s: string, options?: { silent?: boolean }) => {
			const http = manager?.getHttpClient();
			if (!http) return;
			if (!options?.silent) setFileListLoading(true);
			try {
				const [notes, tasks, documents] = await Promise.all([
					http.listNotes({ scope: s }),
					http.listTasks({ scope: s }),
					http.listDocuments({ scope: s }),
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
				setFileList((prev) => {
					if (prev.length === 0) return items;
					const prevMap = new Map(prev.map((p) => [`${p.kind}:${p.id}`, p]));
					const merged = items.map((newItem) => {
						const key = `${newItem.kind}:${newItem.id}`;
						const old = prevMap.get(key);
						if (old && old.updatedAt === newItem.updatedAt) return old;
						return newItem;
					});
					return merged;
				});
			} catch {
				setFileList([]);
			} finally {
				setFileListLoading(false);
			}
		},
		[manager]
	);

	useEffect(() => {
		if (manager && scope) void refreshFileList(scope);
	}, [manager, scope, refreshFileList]);

	useEffect(() => {
		if (!scope) return;
		let debounceTimer: ReturnType<typeof setTimeout> | null = null;
		const unsubscribe = subscribeSyncEvents((eventType) => {
			if (!isFileSyncEvent(eventType)) return;
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				debounceTimer = null;
				void refreshFileList(scope, { silent: true });
			}, SYNC_REFRESH_DEBOUNCE_MS);
		});
		return () => {
			unsubscribe();
			if (debounceTimer) clearTimeout(debounceTimer);
		};
	}, [scope, refreshFileList]);

	return { fileList, fileListLoading, refreshFileList };
}
