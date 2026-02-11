/**
 * Markdown 预览 - 使用 react-markdown 替代 md-editor-v3
 */
import ReactMarkdown from "react-markdown";

interface MdPreviewProps {
	children?: string;
	className?: string;
}

export default function MdPreview({
	children = "",
	className,
}: MdPreviewProps) {
	return (
		<div className={`md-preview-wrapper ${className ?? ""}`}>
			<ReactMarkdown>{children || "(空)"}</ReactMarkdown>
		</div>
	);
}
