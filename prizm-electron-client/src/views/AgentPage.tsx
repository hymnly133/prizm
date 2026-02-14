/**
 * Agent 页面 - 会话列表 + 消息区（lobe-ui ChatList/ChatItem）+ 输入框
 * 参照 lobehub 对话逻辑，使用 lobe-ui 对话框组件，显示 token 等信息
 * 支持停止生成、错误提示、会话重命名
 * 输入框使用 @lobehub/editor ChatInput，悬浮面板样式
 */
import { ActionIcon, Button, Empty, List } from "@lobehub/ui";
import {
	ChatActionsBar as BaseChatActionsBar,
	ChatList,
	type ChatMessage,
} from "@lobehub/ui/chat";

/** 过滤 createAt/updateAt 等非 DOM 属性，避免 React 警告 */
function ChatActionsBar(
	props: React.ComponentProps<typeof BaseChatActionsBar>
) {
	const { createAt, updateAt, ...rest } = props as typeof props & {
		createAt?: unknown;
		updateAt?: unknown;
	};
	return <BaseChatActionsBar {...rest} />;
}
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState, useMemo, useCallback } from "react";
import { useAgent } from "../hooks/useAgent";
import { useScope } from "../hooks/useScope";
import { MessageUsage } from "../components/MessageUsage";
import {
	ChatInputProvider,
	DesktopChatInput,
	type ActionKeys,
} from "../features/ChatInput";
import type { AgentMessage } from "@prizm/client-core";

/** 将 AgentMessage 转为 lobe-ui ChatMessage 格式 */
function toChatMessage(m: AgentMessage & { streaming?: boolean }): ChatMessage {
	const ts = m.createdAt;
	return {
		id: m.id,
		content: m.content,
		role: m.role,
		createAt: ts,
		updateAt: ts,
		meta: {
			title: m.role === "user" ? "你" : "AI",
			avatar: m.role === "user" ? "👤" : "🤖",
		},
		extra: {
			model: m.model,
			usage: m.usage,
			streaming: m.streaming,
			reasoning: m.reasoning,
		},
	};
}

/** 助手消息额外信息：model + token + 思考过程（可折叠） */
function AssistantMessageExtra(props: ChatMessage) {
	const extra = props.extra as
		| {
				model?: string;
				usage?: {
					totalTokens?: number;
					totalInputTokens?: number;
					totalOutputTokens?: number;
				};
				reasoning?: string;
		  }
		| undefined;
	const hasReasoning = !!extra?.reasoning?.trim();
	return (
		<div className="assistant-message-extra">
			{hasReasoning && (
				<details className="reasoning-details">
					<summary className="reasoning-summary">思考过程</summary>
					<pre className="reasoning-content">{extra!.reasoning}</pre>
				</details>
			)}
			<MessageUsage model={extra?.model} usage={extra?.usage} />
		</div>
	);
}

export default function AgentPage() {
	const { currentScope } = useScope();
	const {
		sessions,
		currentSession,
		loading,
		sending,
		error,
		createSession,
		deleteSession,
		loadSession,
		updateSession,
		sendMessage,
		stopGeneration,
		optimisticMessages,
	} = useAgent(currentScope);

	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [editTitle, setEditTitle] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);

	const handleSend = useCallback(
		async ({
			clearContent,
			getMarkdownContent,
		}: {
			clearContent: () => void;
			getMarkdownContent: () => string;
		}) => {
			const content = getMarkdownContent().trim();
			if (!content || sending) return;

			let session = currentSession;
			if (!session) {
				session = await createSession();
				if (!session) return;
			}

			await sendMessage(content, session);
			clearContent();
			messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
		},
		[currentSession, sending, createSession, sendMessage]
	);

	/** 清空：创建新会话 */
	const handleClear = useCallback(async () => {
		await createSession();
	}, [createSession]);

	const leftActions: ActionKeys[] = ["fileUpload", "clear"];

	const handleRename = async (id: string) => {
		if (!editTitle.trim()) {
			setEditingSessionId(null);
			return;
		}
		await updateSession(id, { title: editTitle.trim() });
		setEditingSessionId(null);
		setEditTitle("");
	};

	/** 单一消息源：服务器消息 + 乐观更新（流式过程中原地更新 assistant） */
	const chatData: ChatMessage[] = useMemo(() => {
		if (!currentSession) return [];

		const messages: (AgentMessage & { streaming?: boolean })[] = [
			...currentSession.messages,
			...optimisticMessages.map((m) => ({
				...m,
				streaming:
					sending && m.role === "assistant" && m.id.startsWith("assistant-"),
			})),
		];

		return messages.map(toChatMessage);
	}, [currentSession, optimisticMessages, sending]);

	const loadingId =
		sending && chatData.length > 0
			? chatData[chatData.length - 1].id
			: undefined;

	const sessionListItems = sessions.map((s) => ({
		key: s.id,
		title:
			editingSessionId === s.id ? (
				<input
					className="agent-rename-input"
					value={editTitle}
					onChange={(e) => setEditTitle(e.target.value)}
					onBlur={() => handleRename(s.id)}
					onKeyDown={(e) => {
						if (e.key === "Enter") handleRename(s.id);
						if (e.key === "Escape") setEditingSessionId(null);
					}}
					autoFocus
					onClick={(e) => e.stopPropagation()}
				/>
			) : (
				s.title || "新会话"
			),
		active: currentSession?.id === s.id,
		actions: (
			<>
				<ActionIcon
					icon={Pencil}
					title="重命名"
					size="small"
					onClick={(e) => {
						e.stopPropagation();
						setEditingSessionId(s.id);
						setEditTitle(s.title || "");
					}}
				/>
				<ActionIcon
					icon={Trash2}
					title="删除"
					size="small"
					onClick={(e) => {
						e.stopPropagation();
						deleteSession(s.id);
					}}
				/>
			</>
		),
		showAction: currentSession?.id === s.id,
		onClick: () => loadSession(s.id),
	}));

	return (
		<section className="agent-page">
			<aside className="agent-sidebar">
				<div className="agent-sidebar-header">
					<span className="agent-sidebar-title">会话</span>
					<ActionIcon
						icon={Plus}
						title="新建会话"
						onClick={createSession}
						disabled={loading}
					/>
				</div>
				<div className="agent-sessions-list">
					{loading && sessions.length === 0 ? (
						<div className="agent-sessions-loading">加载中...</div>
					) : sessions.length === 0 ? (
						<Empty title="暂无会话" description="点击 + 新建会话" />
					) : (
						<List activeKey={currentSession?.id} items={sessionListItems} />
					)}
				</div>
			</aside>

			<div className="agent-content">
				<div className="agent-main">
					{currentSession ? (
						<>
							<div className="agent-messages">
								<ChatList
									data={chatData}
									variant="bubble"
									showAvatar
									showTitle
									loadingId={loadingId}
									renderActions={{
										default: ChatActionsBar,
									}}
									renderMessages={{
										default: ({ editableContent }) => editableContent,
									}}
									renderMessagesExtra={{
										assistant: AssistantMessageExtra,
									}}
								/>
								<div ref={messagesEndRef} />
							</div>

							{error && <div className="agent-error-banner">{error}</div>}

							<div className="agent-input-wrap agent-input-floating">
								<ChatInputProvider
									leftActions={leftActions}
									rightActions={[]}
									sendButtonProps={{
										disabled: sending,
										generating: sending,
										onStop: ({ editor }) => {
											stopGeneration();
										},
										shape: "round",
									}}
									onSend={handleSend}
									allowExpand
								>
									<DesktopChatInput
										onClear={handleClear}
										inputContainerProps={{
											minHeight: 88,
											style: {
												borderRadius: 20,
												boxShadow: "0 12px 32px rgba(0,0,0,.04)",
											},
										}}
									/>
								</ChatInputProvider>
							</div>
						</>
					) : (
						<div className="agent-empty">
							<Empty
								title="选择或创建会话"
								description={
									loading ? "加载中..." : "点击左侧 + 新建会话开始对话"
								}
								action={
									!loading && sessions.length === 0 ? (
										<Button type="primary" onClick={createSession}>
											新建会话
										</Button>
									) : undefined
								}
							/>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
