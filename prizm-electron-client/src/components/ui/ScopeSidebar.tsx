import type { FileKind, FileItem } from "../../hooks/useFileList";

interface ScopeSidebarProps {
	scopes: string[];
	scopeDescriptions?: Record<string, { label: string; description: string }>;
	getScopeLabel?: (scopeId: string) => string;
	scopesLoading: boolean;
	currentScope: string;
	files: FileItem[];
	filesLoading: boolean;
	selectedKind?: FileKind | null;
	selectedId?: string | null;
	onSelect: (scope: string) => void;
	onSelectFile: (payload: { kind: FileKind; id: string }) => void;
	onAddNote: () => void;
	onAddDocument: () => void;
}

export default function ScopeSidebar({
	scopes,
	scopeDescriptions = {},
	getScopeLabel = (id) => id,
	scopesLoading,
	currentScope,
	files,
	filesLoading,
	selectedKind,
	selectedId,
	onSelect,
	onSelectFile,
	onAddNote,
	onAddDocument,
}: ScopeSidebarProps) {
	return (
		<aside className="scope-sidebar" aria-label="工作区与文件">
			<div className="sidebar-workspace-row">
				<select
					className="workspace-select"
					value={currentScope}
					disabled={scopesLoading}
					title={scopeDescriptions[currentScope]?.description}
					onChange={(e) => onSelect((e.target as HTMLSelectElement).value)}
				>
					{scopes.map((s) => (
						<option key={s} value={s} title={scopeDescriptions[s]?.description}>
							{getScopeLabel(s)} ({s})
						</option>
					))}
				</select>
			</div>

			<div className="sidebar-files">
				<div className="files-header">
					<span className="files-title">文件</span>
					<div className="files-add-btns">
						<button
							type="button"
							className="files-add-btn"
							aria-label="新建便签"
							title="新建便签"
							onClick={onAddNote}
						>
							+
						</button>
						<button
							type="button"
							className="files-add-btn"
							aria-label="新建文档"
							title="新建文档"
							onClick={onAddDocument}
						>
							📄
						</button>
					</div>
				</div>
				{!filesLoading ? (
					<div className="files-list">
						{files.length === 0 ? (
							<div className="files-empty">暂无文件</div>
						) : (
							files.map((f) => (
								<button
									key={`${f.kind}-${f.id}`}
									type="button"
									className={`file-item ${
										selectedId && f.kind === selectedKind && f.id === selectedId
											? "active"
											: ""
									}`}
									onClick={() => onSelectFile({ kind: f.kind, id: f.id })}
								>
									<span className="file-icon">
										{f.kind === "note" ? "📝" : f.kind === "task" ? "✓" : "📄"}
									</span>
									<span className="file-title">{f.title}</span>
								</button>
							))
						)}
					</div>
				) : (
					<div className="files-loading">加载中...</div>
				)}
			</div>
		</aside>
	);
}
