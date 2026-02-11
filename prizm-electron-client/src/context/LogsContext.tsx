/**
 * 日志共享上下文
 */
import {
	createContext,
	useContext,
	useState,
	useCallback,
	type ReactNode,
} from "react";

export type LogType = "info" | "success" | "error" | "warning";

export interface LogEntry {
	message: string;
	type: LogType;
	timestamp: string;
}

interface LogsContextValue {
	logs: LogEntry[];
	addLog: (message: string, type?: LogType) => void;
}

const LogsContext = createContext<LogsContextValue | null>(null);

export function LogsProvider({ children }: { children: ReactNode }) {
	const [logs, setLogs] = useState<LogEntry[]>([]);

	const addLog = useCallback((message: string, type: LogType = "info") => {
		const timestamp = new Date().toLocaleTimeString("zh-CN", {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		setLogs((prev) => {
			const next = [{ message, type, timestamp }, ...prev];
			if (next.length > 50) next.pop();
			return next;
		});
	}, []);

	return (
		<LogsContext.Provider value={{ logs, addLog }}>
			{children}
		</LogsContext.Provider>
	);
}

export function useLogsContext(): LogsContextValue {
	const ctx = useContext(LogsContext);
	if (!ctx) throw new Error("useLogsContext must be used within LogsProvider");
	return ctx;
}
