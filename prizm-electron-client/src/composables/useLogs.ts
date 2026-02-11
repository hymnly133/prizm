import { ref } from "vue";

export type LogType = "info" | "success" | "error" | "warning";

export interface LogEntry {
	message: string;
	type: LogType;
	timestamp: string;
}

export const logs = ref<LogEntry[]>([]);

export function addLog(message: string, type: LogType = "info"): void {
	const timestamp = new Date().toLocaleTimeString("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
	logs.value.unshift({ message, type, timestamp });
	if (logs.value.length > 50) {
		logs.value.pop();
	}
}
