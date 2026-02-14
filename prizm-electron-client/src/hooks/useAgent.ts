/**
 * useAgent - Agent 会话管理、发消息、流式消费、停止生成
 * 仿照 LobeHub：乐观更新 + 流式原地更新，不依赖 loadSession 获取消息
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { usePrizmContext, useSyncEventContext } from "../context/PrizmContext";
import type { AgentSession, AgentMessage } from "@prizm/client-core";

function tmpId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function useAgent(scope: string) {
	const { manager } = usePrizmContext();
	const { lastSyncEvent } = useSyncEventContext();
	const [sessions, setSessions] = useState<AgentSession[]>([]);
	const [currentSession, setCurrentSession] = useState<AgentSession | null>(
		null
	);
	const [loading, setLoading] = useState(false);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	/** 乐观更新消息：发送时的 [userMsg, assistantMsg]，流式过程中原地更新 assistant */
	const [optimisticMessages, setOptimisticMessages] = useState<AgentMessage[]>(
		[]
	);

	/** 当前流式请求的 AbortController */
	const abortControllerRef = useRef<AbortController | null>(null);

	const http = manager?.getHttpClient();

	const refreshSessions = useCallback(async () => {
		if (!http || !scope) return;
		setLoading(true);
		try {
			const list = await http.listAgentSessions(scope);
			setSessions(list);
		} catch {
			setSessions([]);
		} finally {
			setLoading(false);
		}
	}, [http, scope]);

	const createSession = useCallback(async () => {
		if (!http || !scope) return null;
		setLoading(true);
		try {
			const session = await http.createAgentSession(scope);
			await refreshSessions();
			setCurrentSession(session);
			return session;
		} catch {
			return null;
		} finally {
			setLoading(false);
		}
	}, [http, scope, refreshSessions]);

	const deleteSession = useCallback(
		async (id: string) => {
			if (!http || !scope) return;
			setLoading(true);
			try {
				await http.deleteAgentSession(id, scope);
				if (currentSession?.id === id) {
					setCurrentSession(null);
					setOptimisticMessages([]);
				}
				await refreshSessions();
			} finally {
				setLoading(false);
			}
		},
		[http, scope, currentSession?.id, refreshSessions]
	);

	const loadSession = useCallback(
		async (id: string) => {
			if (!http || !scope) return null;
			setLoading(true);
			setOptimisticMessages([]); // 切换会话时清除乐观更新
			setError(null);
			try {
				const session = await http.getAgentSession(id, scope);
				setCurrentSession(session);
				return session;
			} catch {
				return null;
			} finally {
				setLoading(false);
			}
		},
		[http, scope]
	);

	const updateSession = useCallback(
		async (id: string, update: { title?: string }) => {
			if (!http || !scope) return null;
			try {
				const session = await http.updateAgentSession(id, update, scope);
				setCurrentSession((prev) =>
					prev?.id === id ? { ...prev, ...session } : prev
				);
				await refreshSessions();
				return session;
			} catch {
				return null;
			}
		},
		[http, scope, refreshSessions]
	);

	/** 停止当前生成 */
	const stopGeneration = useCallback(async () => {
		// 1. 本地 abort fetch
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
		}
		// 2. 通知后端停止（双路径保险）
		if (http && currentSession) {
			try {
				await http.stopAgentChat(currentSession.id, scope);
			} catch {
				// 忽略：后端可能已结束
			}
		}
	}, [http, currentSession, scope]);

	const sendMessage = useCallback(
		async (
			content: string,
			sessionOverride?: AgentSession | null
		): Promise<string | null> => {
			const session = sessionOverride ?? currentSession;
			if (!http || !session || !content.trim()) return null;
			setSending(true);
			setError(null);

			// 创建 AbortController
			const ac = new AbortController();
			abortControllerRef.current = ac;

			const now = Date.now();
			const userMsg: AgentMessage = {
				id: tmpId("user"),
				role: "user",
				content: content.trim(),
				createdAt: now,
			};
			const assistantMsg: AgentMessage = {
				id: tmpId("assistant"),
				role: "assistant",
				content: "",
				createdAt: now,
			};

			setOptimisticMessages([userMsg, assistantMsg]);
			const sessionId = session.id;

			try {
				let fullContent = "";
				let fullReasoning = "";
				let lastUsage: AgentMessage["usage"];
				let lastModel: string | undefined;
				let wasStopped = false;
				await http.streamChat(session.id, content.trim(), {
					scope,
					signal: ac.signal,
					onChunk: (chunk) => {
						if (chunk.type === "text" && chunk.value) {
							fullContent += chunk.value;
							setOptimisticMessages((prev) => {
								if (prev.length < 2) return prev;
								const assistant = { ...prev[1], content: fullContent };
								return [prev[0], assistant];
							});
						}
						if (chunk.type === "reasoning" && chunk.value) {
							fullReasoning += chunk.value;
							setOptimisticMessages((prev) => {
								if (prev.length < 2) return prev;
								const assistant = {
									...prev[1],
									content: prev[1].content,
									reasoning: fullReasoning,
								};
								return [prev[0], assistant];
							});
						}
						if (chunk.type === "done") {
							if (chunk.usage) lastUsage = chunk.usage;
							if (chunk.model) lastModel = chunk.model;
							if (chunk.stopped) wasStopped = true;
						}
					},
					onError: (msg) => {
						setError(msg);
					},
				});

				// 流式结束：将乐观消息合并进 currentSession（含 model、usage、reasoning）
				setCurrentSession((prev) => {
					const base = prev?.id === sessionId ? prev : session;
					if (base.id !== sessionId) return prev ?? base;
					return {
						...base,
						messages: [
							...base.messages,
							userMsg,
							{
								...assistantMsg,
								content: fullContent,
								model: lastModel,
								usage: lastUsage,
								...(fullReasoning && { reasoning: fullReasoning }),
							},
						],
					};
				});
				setOptimisticMessages([]);
				await refreshSessions();
				return fullContent;
			} catch (err) {
				// AbortError 是正常停止
				const isAbort = err instanceof Error && err.name === "AbortError";
				if (isAbort) {
					// 停止时将已有内容合并进 session
					setOptimisticMessages((prev) => {
						if (prev.length < 2) return [];
						const assistant = prev[1];
						if (assistant?.content) {
							setCurrentSession((s) => {
								const base = s?.id === sessionId ? s : session;
								if (base.id !== sessionId) return s ?? base;
								return {
									...base,
									messages: [
										...base.messages,
										userMsg,
										{
											...assistant,
											content: assistant.content,
											...(assistant.reasoning && {
												reasoning: assistant.reasoning,
											}),
										},
									],
								};
							});
						}
						return [];
					});
				} else {
					setError(err instanceof Error ? err.message : "发送失败");
					setOptimisticMessages([]);
				}
				return null;
			} finally {
				abortControllerRef.current = null;
				setSending(false);
			}
		},
		[http, currentSession, scope, refreshSessions]
	);

	useEffect(() => {
		if (http && scope) void refreshSessions();
	}, [http, scope, refreshSessions]);

	useEffect(() => {
		if (lastSyncEvent?.startsWith("agent:")) {
			if (scope) void refreshSessions();
			if (currentSession) void loadSession(currentSession.id);
		}
	}, [lastSyncEvent, scope, currentSession?.id, refreshSessions, loadSession]);

	// 组件卸载时 abort 进行中的请求
	useEffect(() => {
		return () => {
			abortControllerRef.current?.abort();
		};
	}, []);

	return {
		sessions,
		currentSession,
		loading,
		sending,
		error,
		refreshSessions,
		createSession,
		deleteSession,
		loadSession,
		updateSession,
		sendMessage,
		stopGeneration,
		setCurrentSession,
		optimisticMessages,
	};
}
