import { useState, useMemo, useEffect } from "react";
import ScopeSidebar from "../components/ui/ScopeSidebar";
import SearchSection from "../components/SearchSection";
import FileDetailView from "../components/FileDetailView";
import { useScope } from "../hooks/useScope";
import { useFileList } from "../hooks/useFileList";
import { usePrizmContext } from "../context/PrizmContext";
import { useLogsContext } from "../context/LogsContext";
import type { FileKind } from "../hooks/useFileList";

export default function WorkPage() {
	const { manager } = usePrizmContext();
	const { addLog } = useLogsContext();
	const {
		currentScope,
		scopes,
		scopesLoading,
		scopeDescriptions,
		getScopeLabel,
		setScope,
	} = useScope();
	const { fileList, fileListLoading, refreshFileList } =
		useFileList(currentScope);

	const [activeTab, setActiveTab] = useState("notes");
	const [selectedFile, setSelectedFile] = useState<{
		kind: FileKind;
		id: string;
	} | null>(null);

	useEffect(() => {
		setSelectedFile(null);
	}, [currentScope]);

	const selectedFileData = useMemo(() => {
		if (!selectedFile) return null;
		const { kind, id } = selectedFile;
		return fileList.find((f) => f.kind === kind && f.id === id) ?? null;
	}, [selectedFile, fileList]);

	function onSelectFile(payload: { kind: FileKind; id: string }) {
		setSelectedFile(payload);
	}

	async function onAddNote() {
		const http = manager?.getHttpClient();
		if (!http) return;
		try {
			const note = await http.createNote({ content: "" }, currentScope);
			await refreshFileList(currentScope);
			setSelectedFile({ kind: "note", id: note.id });
			addLog("已创建便签", "success");
		} catch (e) {
			addLog(`创建便签失败: ${String(e)}`, "error");
		}
	}

	async function onAddDocument() {
		const http = manager?.getHttpClient();
		if (!http) return;
		try {
			const doc = await http.createDocument(
				{ title: "未命名文档", content: "" },
				currentScope
			);
			await refreshFileList(currentScope);
			setSelectedFile({ kind: "document", id: doc.id });
			addLog("已创建文档", "success");
		} catch (e) {
			addLog(`创建文档失败: ${String(e)}`, "error");
		}
	}

	async function onDeleteFile() {
		const f = selectedFileData;
		if (!f || !manager) return;
		const http = manager.getHttpClient();
		try {
			if (f.kind === "note") {
				await http.deleteNote(f.id, currentScope);
			} else if (f.kind === "task") {
				await http.deleteTask(f.id, currentScope);
			} else {
				await http.deleteDocument(f.id, currentScope);
			}
			setSelectedFile(null);
			await refreshFileList(currentScope);
			addLog("已删除", "success");
		} catch (e) {
			addLog(`删除失败: ${String(e)}`, "error");
		}
	}

	async function onDoneTask() {
		const f = selectedFileData;
		if (!f || f.kind !== "task" || !manager) return;
		const http = manager.getHttpClient();
		try {
			await http.updateTask(f.id, { status: "done" }, currentScope);
			await refreshFileList(currentScope);
			addLog("任务已完成", "success");
		} catch (e) {
			addLog(`更新失败: ${String(e)}`, "error");
		}
	}

	const refreshScope = () => refreshFileList(currentScope);

	return (
		<section className="work-page">
			<ScopeSidebar
				scopes={scopes}
				scopeDescriptions={scopeDescriptions}
				getScopeLabel={getScopeLabel}
				scopesLoading={scopesLoading}
				currentScope={currentScope}
				files={fileList}
				filesLoading={fileListLoading}
				selectedKind={selectedFile?.kind ?? null}
				selectedId={selectedFile?.id ?? null}
				onSelect={setScope}
				onSelectFile={onSelectFile}
				onAddNote={onAddNote}
				onAddDocument={onAddDocument}
			/>

			<div className="work-content">
				<div className="work-toolbar">
					<SearchSection
						activeTab={activeTab}
						scope={currentScope}
						onActiveTabChange={setActiveTab}
						onRefreshNotes={refreshScope}
						onRefreshTasks={refreshScope}
						onRefreshClipboard={() => {}}
						onSelectFile={onSelectFile}
					/>
				</div>

				<div className="work-detail">
					<FileDetailView
						file={selectedFileData}
						onDelete={onDeleteFile}
						onDone={onDoneTask}
					/>
				</div>
			</div>
		</section>
	);
}
