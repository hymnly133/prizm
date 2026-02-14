import { EditorProvider, useEditor } from "@lobehub/editor/react";
import type { ReactNode } from "react";
import { memo, useRef } from "react";

import { createStore, Provider } from "./store";
import type { StoreUpdaterProps } from "./StoreUpdater";
import StoreUpdater from "./StoreUpdater";

interface ChatInputProviderProps extends StoreUpdaterProps {
	children: ReactNode;
}

export const ChatInputProvider = memo<ChatInputProviderProps>(
	({
		agentId,
		children,
		leftActions,
		rightActions,
		mobile,
		sendButtonProps,
		onSend,
		chatInputEditorRef,
		onMarkdownContentChange,
		allowExpand = true,
	}) => {
		const editor = useEditor();
		const slashMenuRef = useRef<HTMLDivElement>(null);

		return (
			<EditorProvider>
				<Provider
					createStore={() =>
						createStore({
							allowExpand,
							editor,
							leftActions,
							mobile,
							rightActions,
							sendButtonProps,
							slashMenuRef,
							onSend,
							onMarkdownContentChange,
						})
					}
				>
					<StoreUpdater
						agentId={agentId}
						allowExpand={allowExpand}
						chatInputEditorRef={chatInputEditorRef}
						leftActions={leftActions}
						mobile={mobile}
						rightActions={rightActions}
						sendButtonProps={sendButtonProps}
						onMarkdownContentChange={onMarkdownContentChange}
						onSend={onSend}
					/>
					{children}
				</Provider>
			</EditorProvider>
		);
	}
);

ChatInputProvider.displayName = "ChatInputProvider";
