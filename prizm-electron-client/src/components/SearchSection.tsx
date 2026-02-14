import { Input, List, Tag } from "@lobehub/ui";
import type {
	ClipboardItem,
	Document,
	StickyNote,
	Task,
} from "@prizm/client-core";
import { useRef, useState, useEffect } from "react";
import { useDebounce } from "../hooks/useDebounce";
import { useLogsContext } from "../context/LogsContext";
import { usePrizmContext } from "../context/PrizmContext";

type SearchResultKind = "note" | "task" | "clipboard" | "document";

interface SearchResult {
	kind: SearchResultKind;
	id: string;
	preview: string;
	raw?: StickyNote | Task | ClipboardItem | Document;
}

interface SearchSectionProps {
	activeTab: string;
	scope?: string;
	onActiveTabChange: (value: string) => void;
	onRefreshNotes: () => void;
	onRefreshTasks: () => void;
	onRefreshClipboard: () => void;
	onSelectFile?: (payload: {
		kind: "note" | "task" | "document";
		id: string;
	}) => void;
}

export default function SearchSection({
	activeTab,
	scope = "default",
	onActiveTabChange,
	onRefreshNotes,
	onRefreshTasks,
	onRefreshClipboard,
	onSelectFile,
}: SearchSectionProps) {
	const { manager } = usePrizmContext();
	const { addLog } = useLogsContext();
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<SearchResult[]>([]);
	const [showResults, setShowResults] = useState(false);
	const [focusedIndex, setFocusedIndex] = useState(0);
	const sectionRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const itemRefs = useRef<(HTMLElement | null)[]>([]);

	const debouncedQuery = useDebounce(query, 200);

	async function performSearch(): Promise<SearchResult[]> {
		const http = manager?.getHttpClient();
		if (!http || !query.trim()) return [];

		const q = query.trim().toLowerCase();
		const out: SearchResult[] = [];

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
						title ||
						(content.length > 60 ? content.slice(0, 60) + "…" : content);
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

	useEffect(() => {
		if (!debouncedQuery.trim()) {
			setShowResults(false);
			setResults([]);
			return;
		}
		performSearch().then((r) => {
			setResults(r);
			setShowResults(true);
			setFocusedIndex(0);
		});
	}, [debouncedQuery, scope]);

	async function onFocus() {
		if (query.trim()) {
			const r = await performSearch();
			setResults(r);
			setShowResults(true);
			setFocusedIndex(0);
		}
	}

	function focusNext() {
		if (results.length) {
			const next = (focusedIndex + 1) % results.length;
			setFocusedIndex(next);
			itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
		}
	}

	function focusPrev() {
		if (results.length) {
			const prev = (focusedIndex - 1 + results.length) % results.length;
			setFocusedIndex(prev);
			itemRefs.current[prev]?.scrollIntoView({ block: "nearest" });
		}
	}

	function handleClick(r: SearchResult) {
		setQuery("");
		setShowResults(false);
		setResults([]);

		if (r.kind === "note") {
			onActiveTabChange("notes");
			onRefreshNotes();
			onSelectFile?.({ kind: "note", id: r.id });
		} else if (r.kind === "task") {
			onActiveTabChange("tasks");
			onRefreshTasks();
			onSelectFile?.({ kind: "task", id: r.id });
		} else if (r.kind === "document") {
			onActiveTabChange("notes");
			onRefreshNotes();
			onSelectFile?.({ kind: "document", id: r.id });
		} else if (r.kind === "clipboard" && r.raw && "content" in r.raw) {
			const content = (r.raw as { content?: string }).content;
			if (content != null) void window.prizm.writeClipboard(content);
			addLog("已复制到剪贴板", "success");
			onActiveTabChange("clipboard");
			onRefreshClipboard();
		}
	}

	async function onEnter(e: React.KeyboardEvent) {
		if (!query.trim()) return;
		if (results.length > 0 && showResults) {
			const r = results[focusedIndex];
			if (r) {
				e.preventDefault();
				handleClick(r);
			}
			return;
		}
		const http = manager?.getHttpClient();
		if (!http) return;
		e.preventDefault();
		const content = query.trim();
		setQuery("");
		setShowResults(false);
		setResults([]);
		try {
			const note = await http.createNote({ content }, scope);
			addLog("已创建便签", "success");
			onActiveTabChange("notes");
			onRefreshNotes();
			onSelectFile?.({ kind: "note", id: note.id });
		} catch (err) {
			addLog(`创建便签失败: ${String(err)}`, "error");
		}
	}

	function handleClickOutside(e: MouseEvent) {
		if (sectionRef.current && !sectionRef.current.contains(e.target as Node)) {
			setShowResults(false);
		}
	}

	useEffect(() => {
		document.addEventListener("click", handleClickOutside);
		const handler = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "k") {
				e.preventDefault();
				inputRef.current?.focus();
			}
		};
		document.addEventListener("keydown", handler);
		return () => {
			document.removeEventListener("click", handleClickOutside);
			document.removeEventListener("keydown", handler);
		};
	}, []);

	const kindLabel = (k: SearchResultKind) =>
		k === "note"
			? "便签"
			: k === "task"
			? "任务"
			: k === "document"
			? "文档"
			: "剪贴板";

	const listItems = results.map((r, i) => ({
		key: `${r.id}-${r.kind}`,
		title: r.preview || "(空)",
		active: focusedIndex === i,
		addon: <Tag>{kindLabel(r.kind)}</Tag>,
		onClick: () => handleClick(r),
		onMouseEnter: () => setFocusedIndex(i),
	}));

	return (
		<div className="search-section" ref={sectionRef}>
			<div className="search-input-wrap">
				<Input
					ref={inputRef}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="搜索便签、任务、剪贴板... (Ctrl+K)"
					aria-label="全局搜索"
					aria-expanded={showResults}
					aria-controls="search-results"
					onFocus={onFocus}
					onKeyDown={(e) => {
						if (e.key === "Enter") onEnter(e as unknown as React.KeyboardEvent);
						if (e.key === "ArrowDown") {
							e.preventDefault();
							focusNext();
						}
						if (e.key === "ArrowUp") {
							e.preventDefault();
							focusPrev();
						}
					}}
					style={{ width: "100%" }}
				/>
			</div>
			{showResults && (
				<div
					id="search-results"
					className="search-results"
					role="listbox"
					aria-label="搜索结果"
				>
					{results.length === 0 && query.trim() ? (
						<div className="search-result-item search-result-empty">
							无匹配结果
						</div>
					) : (
						<List
							activeKey={
								results[focusedIndex]
									? `${results[focusedIndex].id}-${results[focusedIndex].kind}`
									: undefined
							}
							items={listItems}
						/>
					)}
				</div>
			)}
		</div>
	);
}
