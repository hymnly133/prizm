import { Editor } from "@lobehub/editor/react";
import { cx, css } from "antd-style";
import { memo, useRef } from "react";

import { useChatInputStore, useStoreApi } from "../store";
import Placeholder from "./Placeholder";

const className = cx(css`
	p {
		margin-block-end: 0;
	}
`);

/** 是否是 Ctrl/Cmd 键按下 */
function isCommandPressed(e: KeyboardEvent): boolean {
	return e.metaKey || e.ctrlKey;
}

const InputEditor = memo<{ defaultRows?: number }>(({ defaultRows = 2 }) => {
	const [editor, send, updateMarkdownContent] = useChatInputStore((s) => [
		s.editor,
		s.handleSendButton,
		s.updateMarkdownContent,
	]);
	const storeApi = useStoreApi();
	const isChineseInput = useRef(false);

	// Enter 发送，Shift+Enter 换行（默认行为）
	const handlePressEnter = ({ event: e }: { event: KeyboardEvent }) => {
		if (e.shiftKey || isChineseInput.current) return;
		// Ctrl/Cmd+Enter 发送
		if (isCommandPressed(e)) {
			send();
			return true;
		}
		// Enter 发送
		send();
		return true;
	};

	return (
		<div style={{ display: "block" }}>
			<Editor
				autoFocus
				pasteAsPlainText
				className={className}
				content=""
				editor={editor}
				placeholder={<Placeholder />}
				type="text"
				variant="chat"
				style={{
					minHeight: defaultRows > 1 ? defaultRows * 23 : undefined,
				}}
				onInit={(ed) => storeApi.setState({ editor: ed })}
				onChange={() => updateMarkdownContent()}
				onCompositionEnd={() => {
					isChineseInput.current = false;
				}}
				onCompositionStart={() => {
					isChineseInput.current = true;
				}}
				onPressEnter={handlePressEnter}
			/>
		</div>
	);
});

InputEditor.displayName = "InputEditor";

export default InputEditor;
