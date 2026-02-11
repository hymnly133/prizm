/**
 * useAgent - Agent 会话管理、发消息、流式消费
 */
import { useState, useCallback, useEffect } from "react";
import { usePrizmContext } from "../context/PrizmContext";
import type { AgentSession, AgentMessage } from "@prizm/client-core";

export function useAgent(scope: string) {
	const { manager, lastSyncEvent, setLastSyncEvent } = usePrizmContext();
	const [sessions, setSessions] = useState<AgentSession[]>([]);
	const [currentSession, setCurrentSession] = useState<AgentSession | null>(
		null
	);
	const [loading, setLoading] = useState(false);
	const [sending, setSending] = useState(false);

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

	const sendMessage = useCallback(
		async (
			content: string,
			options?: {
				onChunk?: (chunk: { type: string; value?: string }) => void;
			}
		): Promise<string | null> => {
			if (!http || !currentSession || !content.trim()) return null;
			setSending(true);
			try {
				const fullContent = await http.streamChat(
					currentSession.id,
					content.trim(),
					{
						scope,
						onChunk: options?.onChunk,
					}
				);
				// 刷新会话以获取最新消息
				await loadSession(currentSession.id);
				return fullContent;
			} catch {
				return null;
			} finally {
				setSending(false);
			}
		},
		[http, currentSession, scope, loadSession]
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

	return {
		sessions,
		currentSession,
		loading,
		sending,
		refreshSessions,
		createSession,
		deleteSession,
		loadSession,
		sendMessage,
		setCurrentSession,
	};
}
