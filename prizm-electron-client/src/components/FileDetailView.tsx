import { Button, Empty, Markdown, Tag } from "@lobehub/ui";
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
				<Empty
					title="选择文件"
					description="在左侧列表中点击一个文件查看详情"
				/>
			</div>
		);
	}

	return (
		<div className="file-detail">
			<div className="file-detail-header">
				<Tag>
					{file.kind === "note"
						? "便签"
						: file.kind === "task"
						? "任务"
						: "文档"}
				</Tag>
				<Button size="small" type="primary" danger onClick={onDelete}>
					删除
				</Button>
			</div>
			<div className="file-detail-body">
				{file.kind === "note" && (
					<div className="note-detail">
						<div className="md-preview-wrap">
							<Markdown>{(file.raw as StickyNote).content || "(空)"}</Markdown>
						</div>
					</div>
				)}
				{file.kind === "document" && (
					<div className="document-detail">
						<h2 className="document-title">
							{(file.raw as Document).title || "无标题"}
						</h2>
						<div className="md-preview-wrap">
							<Markdown>{(file.raw as Document).content ?? "(空)"}</Markdown>
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
								<Button size="small" type="primary" onClick={onDone}>
									标记完成
								</Button>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
