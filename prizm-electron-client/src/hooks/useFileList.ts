/**
 * useFileList - 工作区内的文件列表（便签 + 任务 + 文档）
 */
import { useState, useCallback, useEffect } from "react";
import { usePrizmContext } from "../context/PrizmContext";
import type { StickyNote, Task, Document } from "@prizm/client-core";

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

export function useFileList(scope: string) {
	const { manager, lastSyncEvent } = usePrizmContext();
	const [fileList, setFileList] = useState<FileItem[]>([]);
	const [fileListLoading, setFileListLoading] = useState(false);

	const refreshFileList = useCallback(
		async (s: string) => {
			const http = manager?.getHttpClient();
			if (!http) return;
			setFileListLoading(true);
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
				setFileList(items);
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
		if (
			lastSyncEvent &&
			(lastSyncEvent.startsWith("note:") ||
				lastSyncEvent.startsWith("task:") ||
				lastSyncEvent.startsWith("document:"))
		) {
			if (scope) void refreshFileList(scope);
		}
	}, [lastSyncEvent, scope, refreshFileList]);

	return { fileList, fileListLoading, refreshFileList };
}
