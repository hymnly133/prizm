/**
 * Prizm 全局上下文 - 连接状态、配置、manager
 */
import {
	createContext,
	useContext,
	useCallback,
	useState,
	type ReactNode,
} from "react";
import {
	PrizmClientManager,
	buildServerUrl,
	ONLINE_SCOPE,
} from "@prizm/client-core";
import type {
	PrizmConfig,
	NotificationPayload,
	StickyNote,
	Task,
	ClipboardItem,
	PomodoroSession,
} from "@prizm/client-core";

export type ConnectionStatus =
	| "connected"
	| "disconnected"
	| "error"
	| "connecting";

function getManagerRef(): { current: PrizmClientManager | null } {
	if (typeof import.meta !== "undefined" && import.meta.hot?.data?.managerRef) {
		return import.meta.hot.data.managerRef as {
			current: PrizmClientManager | null;
		};
	}
	const ref = { current: null as PrizmClientManager | null };
	if (typeof import.meta !== "undefined" && import.meta.hot) {
		import.meta.hot.data.managerRef = ref;
	}
	return ref;
}

const managerRef = getManagerRef();

export interface PrizmContextValue {
	status: ConnectionStatus;
	config: PrizmConfig | null;
	manager: PrizmClientManager | null;
	lastSyncEvent: string | null;
	setLastSyncEvent: (v: string | null) => void;
	loadConfig: () => Promise<PrizmConfig | null>;
	saveConfig: (cfg: PrizmConfig) => Promise<boolean>;
	testConnection: (serverUrl: string) => Promise<boolean>;
	registerClient: (
		serverUrl: string,
		clientName: string,
		scopes: string[]
	) => Promise<string | null>;
	initializePrizm: (
		cfg: PrizmConfig,
		opt: {
			onLog: (
				msg: string,
				type: "info" | "success" | "error" | "warning"
			) => void;
			onNotify: (payload: NotificationPayload) => void;
		}
	) => Promise<void>;
	disconnect: () => void;
	setConfig: (c: PrizmConfig | null) => void;
}

const PrizmContext = createContext<PrizmContextValue | null>(null);

export function PrizmProvider({ children }: { children: ReactNode }) {
	const [status, setStatus] = useState<ConnectionStatus>("disconnected");
	const [config, setConfigState] = useState<PrizmConfig | null>(null);
	const [lastSyncEvent, setLastSyncEvent] = useState<string | null>(null);
	const [, setTriggerUpdate] = useState({});

	const manager = managerRef.current;

	const loadConfig = useCallback(async (): Promise<PrizmConfig | null> => {
		try {
			const c = await window.prizm.loadConfig();
			setConfigState(c);
			return c;
		} catch {
			return null;
		}
	}, []);

	const saveConfig = useCallback(async (cfg: PrizmConfig): Promise<boolean> => {
		try {
			return await window.prizm.saveConfig(cfg);
		} catch {
			return false;
		}
	}, []);

	const testConnection = useCallback(
		async (serverUrl: string): Promise<boolean> => {
			try {
				return await window.prizm.testConnection(serverUrl);
			} catch {
				return false;
			}
		},
		[]
	);

	const registerClient = useCallback(
		async (
			serverUrl: string,
			clientName: string,
			scopes: string[]
		): Promise<string | null> => {
			try {
				setStatus("connecting");
				const apiKey = await window.prizm.registerClient(
					serverUrl,
					clientName,
					scopes
				);
				if (apiKey) return apiKey;
				throw new Error("注册失败");
			} catch {
				setStatus("error");
				return null;
			}
		},
		[]
	);

	const initializePrizm = useCallback(
		async (
			cfg: PrizmConfig,
			opt: {
				onLog: (
					msg: string,
					type: "info" | "success" | "error" | "warning"
				) => void;
				onNotify: (payload: NotificationPayload) => void;
			}
		): Promise<void> => {
			try {
				if (managerRef.current) {
					managerRef.current.disconnect();
				}

				const m = new PrizmClientManager({
					config: cfg,
					subscribeEvents: "all",
					notifyEvents: cfg.notify_events ?? ["notification"],
					onNotify: (payload: NotificationPayload) => {
						opt.onNotify(payload);
						void window.prizm.showNotification({
							title: payload.title ?? "通知",
							body: payload.body,
						});
					},
					onDataSync: (eventType: string) => {
						setLastSyncEvent(eventType);
					},
					onConnected: (msg: { clientId: string }) => {
						setStatus("connected");
						opt.onLog(
							`WebSocket 已连接 - Client ID: ${msg.clientId}`,
							"success"
						);
						void window.prizm.startClipboardSync({
							serverUrl: buildServerUrl(cfg.server.host, cfg.server.port),
							apiKey: cfg.api_key,
							scope: ONLINE_SCOPE,
						});
					},
					onDisconnected: () => {
						setStatus("disconnected");
						opt.onLog("WebSocket 已断开连接", "warning");
						void window.prizm.stopClipboardSync();
					},
					onError: (error: Error) => {
						setStatus("error");
						opt.onLog(`错误: ${error.message}`, "error");
					},
				});

				managerRef.current = m;
				setTriggerUpdate({});
				await m.connect();
			} catch (error) {
				setStatus("error");
				opt.onLog(`初始化失败: ${String(error)}`, "error");
				throw error;
			}
		},
		[]
	);

	const disconnect = useCallback(() => {
		managerRef.current?.disconnect();
		managerRef.current = null;
		setTriggerUpdate({});
	}, []);

	const setConfig = useCallback((c: PrizmConfig | null) => {
		setConfigState(c);
	}, []);

	const value: PrizmContextValue = {
		status,
		config,
		manager,
		lastSyncEvent,
		setLastSyncEvent,
		loadConfig,
		saveConfig,
		testConnection,
		registerClient,
		initializePrizm,
		disconnect,
		setConfig,
	};

	return (
		<PrizmContext.Provider value={value}>{children}</PrizmContext.Provider>
	);
}

export function usePrizmContext(): PrizmContextValue {
	const ctx = useContext(PrizmContext);
	if (!ctx)
		throw new Error("usePrizmContext must be used within PrizmProvider");
	return ctx;
}
