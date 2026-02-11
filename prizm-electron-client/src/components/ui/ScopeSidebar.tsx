import { ActionIcon, Empty, Icon, List, Select, Skeleton } from "@lobehub/ui";
import type { FileKind, FileItem } from "../../hooks/useFileList";
import { FileText, Plus, StickyNote } from "lucide-react";

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

function getFileIcon(kind: FileKind) {
	switch (kind) {
		case "note":
			return StickyNote;
		case "task":
			return "✓";
		case "document":
			return FileText;
		default:
			return FileText;
	}
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
	const selectOptions = scopes.map((s) => ({
		value: s,
		label: `${getScopeLabel(s)} (${s})`,
	}));

	const listItems = files.map((f) => {
		const isActive =
			selectedId != null && f.kind === selectedKind && f.id === selectedId;
		const icon = getFileIcon(f.kind);
		return {
			key: `${f.kind}-${f.id}`,
			title: f.title,
			active: isActive,
			avatar:
				typeof icon === "string" ? (
					<span style={{ fontSize: 14 }}>{icon}</span>
				) : (
					<Icon icon={icon} size="small" />
				),
			onClick: () => onSelectFile({ kind: f.kind, id: f.id }),
		};
	});

	return (
		<aside className="scope-sidebar" aria-label="工作区与文件">
			<div className="sidebar-workspace-row">
				<Select
					value={currentScope}
					disabled={scopesLoading}
					options={selectOptions}
					onChange={(v) => onSelect(v as string)}
					style={{ width: "100%" }}
					size="small"
				/>
			</div>

			<div className="sidebar-files">
				<div className="files-header">
					<span className="files-title">文件</span>
					<div className="files-add-btns">
						<ActionIcon
							icon={Plus}
							size="small"
							title="新建便签"
							onClick={onAddNote}
						/>
						<ActionIcon
							icon={FileText}
							size="small"
							title="新建文档"
							onClick={onAddDocument}
						/>
					</div>
				</div>
				{filesLoading ? (
					<div className="files-list">
						<Skeleton active paragraph={{ rows: 4 }} />
					</div>
				) : files.length === 0 ? (
					<Empty
						title="暂无文件"
						description="点击上方 + 新建便签或文档"
						imageSize={32}
					/>
				) : (
					<div className="files-list">
						<List
							activeKey={
								selectedId && selectedKind
									? `${selectedKind}-${selectedId}`
									: undefined
							}
							items={listItems}
						/>
					</div>
				)}
			</div>
		</aside>
	);
}
