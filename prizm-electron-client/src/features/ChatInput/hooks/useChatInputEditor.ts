import type { IEditor } from "@lobehub/editor";
import { useMemo } from "react";

import { useChatInputStore } from "../store";

export interface ChatInputEditor {
	clearContent: () => void;
	focus: () => void;
	getJSONState: () => unknown;
	getMarkdownContent: () => string;
	instance: IEditor;
	setDocument: (
		type: string,
		content: unknown,
		options?: Record<string, unknown>
	) => void;
	setExpand: (expand: boolean) => void;
	setJSONState: (content: unknown) => void;
}

export const useChatInputEditor = (): ChatInputEditor => {
	const [
		editor,
		getMarkdownContent,
		getJSONState,
		setExpand,
		setJSONState,
		setDocument,
	] = useChatInputStore((s) => [
		s.editor,
		s.getMarkdownContent,
		s.getJSONState,
		s.setExpand,
		s.setJSONState,
		s.setDocument,
	]);

	return useMemo<ChatInputEditor>(
		() => ({
			clearContent: () => editor?.cleanDocument(),
			focus: () => editor?.focus(),
			getJSONState,
			getMarkdownContent,
			instance: editor!,
			setDocument,
			setExpand,
			setJSONState,
		}),
		[
			editor,
			getMarkdownContent,
			getJSONState,
			setExpand,
			setJSONState,
			setDocument,
		]
	);
};
