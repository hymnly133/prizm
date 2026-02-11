/**
 * Prizm Client Core - 通用工具函数
 */

import type { NotificationPayload, EventPushPayload } from "./types";

/** 事件类型到通知展示文案的映射 */
export const EVENT_LABELS: Record<string, { title: string; body?: string }> = {
	notification: { title: "", body: "" },
	"smtc:change": { title: "媒体控制", body: "状态变更" },
	"note:created": { title: "新便签", body: "已创建" },
	"note:updated": { title: "便签已更新", body: "" },
	"note:deleted": { title: "便签已删除", body: "" },
	"group:created": { title: "新分组", body: "已创建" },
	"group:updated": { title: "分组已更新", body: "" },
	"group:deleted": { title: "分组已删除", body: "" },
	"task:created": { title: "新任务", body: "" },
	"task:updated": { title: "任务已更新", body: "" },
	"task:deleted": { title: "任务已删除", body: "" },
	"clipboard:itemAdded": { title: "剪贴板", body: "新内容已记录" },
	"clipboard:itemDeleted": { title: "剪贴板", body: "记录已删除" },
	"document:created": { title: "新文档", body: "" },
	"document:updated": { title: "文档已更新", body: "" },
	"document:deleted": { title: "文档已删除", body: "" },
	"pomodoro:started": { title: "番茄钟", body: "已开始" },
	"pomodoro:stopped": { title: "番茄钟", body: "已结束" },
};

/** 事件类型到 UI 展示标签的映射（用于设置页等） */
export const EVENT_LABELS_UI: Record<string, string> = {
	notification: "主动通知 (MCP/Agent)",
	"smtc:change": "媒体控制",
	"note:created": "新便签",
	"note:updated": "便签更新",
	"note:deleted": "便签删除",
	"group:created": "新分组",
	"group:updated": "分组更新",
	"group:deleted": "分组删除",
	"task:created": "新任务",
	"task:updated": "任务更新",
	"task:deleted": "任务删除",
	"clipboard:itemAdded": "剪贴板新增",
	"clipboard:itemDeleted": "剪贴板删除",
	"document:created": "新文档",
	"document:updated": "文档更新",
	"document:deleted": "文档删除",
	"pomodoro:started": "番茄钟开始",
	"pomodoro:stopped": "番茄钟结束",
};

/**
 * 构建服务器 URL
 */
export function buildServerUrl(host: string, port: string): string {
	if (host.startsWith("http://") || host.startsWith("https://")) {
		return host.includes(":") ? host : `${host}:${port}`;
	}
	return `http://${host}:${port}`;
}

/** 截断长文本用于通知展示 */
function truncateForNotif(s: string, maxLen: number): string {
	const str = String(s).trim();
	if (!str) return "";
	return str.length <= maxLen ? str : str.slice(0, maxLen) + "…";
}

/**
 * 将 WebSocket 事件载荷格式化为通知展示内容
 */
export function formatEventToNotification(
	ev: EventPushPayload
): NotificationPayload {
	if (ev.eventType === "notification") {
		const p = ev.payload as NotificationPayload;
		return { title: p.title || "通知", body: p.body };
	}
	const labels = EVENT_LABELS[ev.eventType];
	if (labels) {
		const payload = ev.payload as Record<string, unknown>;
		const extra = payload?.title ?? payload?.content;
		const body = extra
			? labels.body
				? `${labels.body} · ${truncateForNotif(String(extra), 50)}`
				: truncateForNotif(String(extra), 80)
			: labels.body ?? "";
		return { title: labels.title, body };
	}
	return { title: ev.eventType, body: "" };
}

/**
 * 获取事件类型的 UI 标签
 */
export function getEventLabel(eventType: string): string {
	return EVENT_LABELS_UI[eventType] ?? eventType;
}
