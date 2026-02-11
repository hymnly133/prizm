import Btn from "./ui/Btn";
import MdPreview from "./MdPreview";
import type { FileItem } from "../hooks/useFileList";
import type { StickyNote, Task, Document } from "@prizm/client-core";

interface FileDetailViewProps {
	file: FileItem | null;
	onDelete: () => void;
	onDone: () => void;
}

export default function FileDetailView({
	file,
	onDelete,
	onDone,
}: FileDetailViewProps) {
	if (!file) {
		return (
			<div className="file-detail-empty">
				<p className="empty-title">选择文件</p>
				<p className="empty-desc">在左侧列表中点击一个文件查看详情</p>
			</div>
		);
	}

	return (
		<div className="file-detail">
			<div className="file-detail-header">
				<span className="file-detail-kind">
					{file.kind === "note"
						? "便签"
						: file.kind === "task"
						? "任务"
						: "文档"}
				</span>
				<Btn variant="danger" size="sm" onClick={onDelete}>
					删除
				</Btn>
			</div>
			<div className="file-detail-body">
				{file.kind === "note" && (
					<div className="note-detail">
						<div className="md-preview-wrap">
							<MdPreview>
								{(file.raw as StickyNote).content || "(空)"}
							</MdPreview>
						</div>
					</div>
				)}
				{file.kind === "document" && (
					<div className="document-detail">
						<h2 className="document-title">
							{(file.raw as Document).title || "无标题"}
						</h2>
						<div className="md-preview-wrap">
							<MdPreview>{(file.raw as Document).content ?? "(空)"}</MdPreview>
						</div>
					</div>
				)}
				{file.kind === "task" && (
					<div className="task-detail">
						<h2 className="task-title">{(file.raw as Task).title}</h2>
						<div className="task-meta">
							<span className="task-status">[{(file.raw as Task).status}]</span>
							<span className="task-priority">
								优先级: {(file.raw as Task).priority}
							</span>
						</div>
						{(file.raw as Task).description && (
							<p className="task-desc">{(file.raw as Task).description}</p>
						)}
						<div className="task-actions">
							{(file.raw as Task).status !== "done" && (
								<Btn variant="primary" size="sm" onClick={onDone}>
									标记完成
								</Btn>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
