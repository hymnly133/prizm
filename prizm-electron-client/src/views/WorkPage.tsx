/**
 * WorkPage - 工作页：中间大卡片展示便签/任务/文档，现代交互
 */
import { useState, useMemo, useEffect } from "react";
import { ActionIcon, Button, Checkbox } from "@lobehub/ui";
import { App, Drawer, Empty, Skeleton } from "antd";
import ScopeSidebar from "../components/ui/ScopeSidebar";
import SearchSection from "../components/SearchSection";
import FileDetailView from "../components/FileDetailView";
import DataCard from "../components/DataCard";
import { useScope } from "../hooks/useScope";
import { useFileList } from "../hooks/useFileList";
import { usePrizmContext } from "../context/PrizmContext";
import { useLogsContext } from "../context/LogsContext";
import type { FileKind, FileItem } from "../hooks/useFileList";
import { FileText, StickyNote } from "lucide-react";

export default function WorkPage() {
	const { modal } = App.useApp();
	const { manager } = usePrizmContext();
	const { addLog } = useLogsContext();
	const { currentScope, scopes, scopesLoading, getScopeLabel, setScope } =
		useScope();
	const { fileList, fileListLoading, refreshFileList } =
		useFileList(currentScope);

	const [activeTab, setActiveTab] = useState("notes");
	const [categoryFilter, setCategoryFilter] = useState<
		Record<FileKind, boolean>
	>({
		note: true,
		task: true,
		document: true,
	});
	const [selectedFile, setSelectedFile] = useState<{
		kind: FileKind;
		id: string;
	} | null>(null);
	const [drawerOpen, setDrawerOpen] = useState(false);

	useEffect(() => {
		setSelectedFile(null);
		setDrawerOpen(false);
	}, [currentScope]);

	useEffect(() => {
		setDrawerOpen(!!selectedFile);
	}, [selectedFile]);

	const filteredFileList = useMemo(() => {
		return fileList.filter((f) => categoryFilter[f.kind]);
	}, [fileList, categoryFilter]);

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
			setDrawerOpen(false);
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

	async function handleDeleteFile(file: FileItem) {
		modal.confirm({
			title: "确认删除",
			content: `确定要删除「${file.title}」吗？`,
			okText: "删除",
			okType: "danger",
			cancelText: "取消",
			onOk: async () => {
				if (!manager) return;
				const http = manager.getHttpClient();
				try {
					if (file.kind === "note") {
						await http.deleteNote(file.id, currentScope);
					} else if (file.kind === "task") {
						await http.deleteTask(file.id, currentScope);
					} else {
						await http.deleteDocument(file.id, currentScope);
					}
					if (
						selectedFile?.kind === file.kind &&
						selectedFile?.id === file.id
					) {
						setSelectedFile(null);
						setDrawerOpen(false);
					}
					await refreshFileList(currentScope);
					addLog("已删除", "success");
				} catch (e) {
					addLog(`删除失败: ${String(e)}`, "error");
				}
			},
		});
	}

	async function handleDoneTask(file: FileItem) {
		if (file.kind !== "task" || !manager) return;
		const http = manager.getHttpClient();
		try {
			await http.updateTask(file.id, { status: "done" }, currentScope);
			await refreshFileList(currentScope);
			addLog("任务已完成", "success");
		} catch (e) {
			addLog(`更新失败: ${String(e)}`, "error");
		}
	}

	const refreshScope = () => refreshFileList(currentScope);

	return (
		<section className="work-page work-page--cards">
			<div className="work-page__toolbar">
				<div className="work-page__toolbar-left">
					<div className="work-page__category-filter">
						<Checkbox
							checked={categoryFilter.note}
							onChange={(checked) =>
								setCategoryFilter((f) => ({ ...f, note: checked }))
							}
						>
							便签
						</Checkbox>
						<Checkbox
							checked={categoryFilter.task}
							onChange={(checked) =>
								setCategoryFilter((f) => ({ ...f, task: checked }))
							}
						>
							任务
						</Checkbox>
						<Checkbox
							checked={categoryFilter.document}
							onChange={(checked) =>
								setCategoryFilter((f) => ({ ...f, document: checked }))
							}
						>
							文档
						</Checkbox>
					</div>
					<ScopeSidebar
						scopes={scopes}
						getScopeLabel={getScopeLabel}
						scopesLoading={scopesLoading}
						currentScope={currentScope}
						onSelect={setScope}
					/>
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
				<div className="work-page__toolbar-actions">
					<ActionIcon
						icon={StickyNote}
						title="新建便签"
						onClick={onAddNote}
						size="large"
					/>
					<ActionIcon
						icon={FileText}
						title="新建文档"
						onClick={onAddDocument}
						size="large"
					/>
				</div>
			</div>

			<div className="work-page__content">
				{fileListLoading ? (
					<div className="work-page__cards-grid">
						{[1, 2, 3, 4, 5, 6].map((i) => (
							<div key={i} className="data-card data-card--skeleton">
								<Skeleton active paragraph={{ rows: 4 }} />
							</div>
						))}
					</div>
				) : filteredFileList.length === 0 ? (
					<div className="work-page__empty">
						<Empty
							image={Empty.PRESENTED_IMAGE_SIMPLE}
							description={
								fileList.length === 0
									? "暂无内容，创建便签或文档开始工作"
									: "没有符合条件的项，勾选上方类别筛选"
							}
							imageStyle={{ height: 80 }}
						>
							{fileList.length === 0 && (
								<div className="work-page__empty-actions">
									<Button type="primary" onClick={onAddNote}>
										新建便签
									</Button>
									<Button onClick={onAddDocument}>新建文档</Button>
								</div>
							)}
						</Empty>
					</div>
				) : (
					<div className="work-page__cards-grid">
						{filteredFileList.map((file) => (
							<DataCard
								key={`${file.kind}-${file.id}`}
								file={file}
								onClick={() => onSelectFile({ kind: file.kind, id: file.id })}
								onDelete={() => handleDeleteFile(file)}
								onDone={
									file.kind === "task" ? () => handleDoneTask(file) : undefined
								}
							/>
						))}
					</div>
				)}
			</div>

			<Drawer
				title={
					selectedFileData
						? selectedFileData.kind === "task"
							? "任务"
							: selectedFileData.kind === "note"
							? "便签"
							: "文档"
						: ""
				}
				placement="right"
				open={drawerOpen}
				onClose={() => {
					setSelectedFile(null);
					setDrawerOpen(false);
				}}
				width={420}
				styles={{ body: { paddingTop: 12 } }}
			>
				{selectedFileData && (
					<FileDetailView
						file={selectedFileData}
						onDelete={onDeleteFile}
						onDone={onDoneTask}
					/>
				)}
			</Drawer>
		</section>
	);
}
