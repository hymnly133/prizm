/**
 * Agent 页面 - 会话列表 + 消息区 + 输入框
 */
import {
	ActionIcon,
	Button,
	Empty,
	List,
	Markdown,
	TextArea,
} from "@lobehub/ui";
import { Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useAgent } from "../hooks/useAgent";
import { useScope } from "../hooks/useScope";

export default function AgentPage() {
	const { currentScope } = useScope();
	const {
		sessions,
		currentSession,
		loading,
		sending,
		createSession,
		deleteSession,
		loadSession,
		sendMessage,
		setCurrentSession,
	} = useAgent(currentScope);

	const [input, setInput] = useState("");
	const [streamingContent, setStreamingContent] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);

	const handleSend = async () => {
		const content = input.trim();
		if (!content || sending) return;

		if (!currentSession) {
			const session = await createSession();
			if (!session) return;
		}

		setInput("");
		setStreamingContent("");

		await sendMessage(content, {
			onChunk: (chunk) => {
				if (chunk.type === "text" && chunk.value) {
					setStreamingContent((prev) => prev + chunk.value);
				}
			},
		});

		setStreamingContent("");
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	};

	const displayMessages = currentSession
		? [
				...currentSession.messages,
				...(streamingContent
					? [
							{
								id: "streaming",
								role: "assistant" as const,
								content: streamingContent,
								createdAt: Date.now(),
							},
					  ]
					: []),
		  ]
		: [];

	const sessionListItems = sessions.map((s) => ({
		key: s.id,
		title: s.title || "新会话",
		active: currentSession?.id === s.id,
		actions: (
			<ActionIcon
				icon={Trash2}
				size="small"
				title="删除"
				danger
				onClick={(e) => {
					e.stopPropagation();
					deleteSession(s.id);
				}}
			/>
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
						size="small"
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

			<div className="agent-main">
				{currentSession ? (
					<>
						<div className="agent-messages">
							{displayMessages.map((m) => (
								<div
									key={m.id}
									className={`agent-message agent-message-${m.role}`}
								>
									<span className="agent-message-role">
										{m.role === "user" ? "你" : "AI"}
									</span>
									<div className="agent-message-content">
										<Markdown>{m.content}</Markdown>
									</div>
								</div>
							))}
							<div ref={messagesEndRef} />
						</div>

						<div className="agent-input-wrap">
							<TextArea
								value={input}
								onChange={(e) => setInput(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										handleSend();
									}
								}}
								placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
								rows={2}
								disabled={sending}
								style={{ flex: 1, minHeight: 44 }}
							/>
							<Button
								type="primary"
								onClick={handleSend}
								disabled={sending || !input.trim()}
							>
								{sending ? "发送中..." : "发送"}
							</Button>
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
		</section>
	);
}
