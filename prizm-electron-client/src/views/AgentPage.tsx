/**
 * Agent 页面 - 会话列表 + 消息区 + 输入框
 */
import { useRef, useState } from "react";
import { useScope } from "../hooks/useScope";
import { useAgent } from "../hooks/useAgent";
import MdPreview from "../components/MdPreview";
import Btn from "../components/ui/Btn";

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

	return (
		<section className="agent-page">
			<aside className="agent-sidebar">
				<div className="agent-sidebar-header">
					<span className="agent-sidebar-title">会话</span>
					<button
						type="button"
						className="agent-add-btn"
						title="新建会话"
						onClick={createSession}
						disabled={loading}
					>
						+
					</button>
				</div>
				<div className="agent-sessions-list">
					{loading && sessions.length === 0 ? (
						<div className="agent-sessions-loading">加载中...</div>
					) : sessions.length === 0 ? (
						<div className="agent-sessions-empty">暂无会话</div>
					) : (
						sessions.map((s) => (
							<div
								key={s.id}
								className={`agent-session-item ${
									currentSession?.id === s.id ? "active" : ""
								}`}
							>
								<button
									type="button"
									className="agent-session-btn"
									onClick={() => loadSession(s.id)}
								>
									{s.title || "新会话"}
								</button>
								<button
									type="button"
									className="agent-session-delete"
									title="删除"
									onClick={(e) => {
										e.stopPropagation();
										deleteSession(s.id);
									}}
								>
									×
								</button>
							</div>
						))
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
										<MdPreview>{m.content}</MdPreview>
									</div>
								</div>
							))}
							<div ref={messagesEndRef} />
						</div>

						<div className="agent-input-wrap">
							<textarea
								className="agent-input"
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
							/>
							<Btn
								variant="primary"
								onClick={handleSend}
								disabled={sending || !input.trim()}
							>
								{sending ? "发送中..." : "发送"}
							</Btn>
						</div>
					</>
				) : (
					<div className="agent-empty">
						<p className="agent-empty-title">选择或创建会话</p>
						<p className="agent-empty-desc">
							{loading ? "加载中..." : "点击左侧 + 新建会话开始对话"}
						</p>
						{!loading && sessions.length === 0 && (
							<Btn variant="primary" onClick={createSession}>
								新建会话
							</Btn>
						)}
					</div>
				)}
			</div>
		</section>
	);
}
