<template>
	<div class="notification-panel">
		<TransitionGroup name="notif">
			<div
				v-for="item in items"
				:key="item.id"
				class="notification-item"
				role="alert"
				aria-live="polite"
				@click="remove(item.id)"
			>
				<div class="notification-item__content">
					<div class="notification-item__title">
						<MdPreview
							:model-value="item.title || '通知'"
							:editor-id="'notif-title-' + item.id"
						/>
					</div>
					<div v-if="item.body" class="notification-item__body">
						<MdPreview
							:model-value="item.body"
							:editor-id="'notif-body-' + item.id"
						/>
					</div>
					<div class="notification-item__meta">
						{{ formatTime(item.createdAt) }}
						<span v-if="item.source" class="notification-item__source">
							· {{ item.source }}</span
						>
					</div>
				</div>
				<button
					class="notification-item__close"
					type="button"
					aria-label="关闭"
					@click.stop="remove(item.id)"
				>
					×
				</button>
			</div>
		</TransitionGroup>
	</div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { MdPreview } from "md-editor-v3";
import "md-editor-v3/lib/preview.css";

interface NotifItem {
	id: string;
	title: string;
	body?: string;
	source?: string;
	createdAt: number;
}

const AUTO_DISMISS_MS = 8000;
const MAX_VISIBLE = 12;

function formatTime(ts: number): string {
	const d = new Date(ts);
	const now = new Date();
	const isToday =
		d.getDate() === now.getDate() &&
		d.getMonth() === now.getMonth() &&
		d.getFullYear() === now.getFullYear();
	if (isToday) {
		return d.toLocaleTimeString("zh-CN", {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	}
	return d.toLocaleString("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

const items = ref<NotifItem[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function nextId() {
	return "notif-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
}

function remove(id: string) {
	const t = timers.get(id);
	if (t) {
		clearTimeout(t);
		timers.delete(id);
	}
	items.value = items.value.filter((x) => x.id !== id);
}

// 从有通知变为空时隐藏窗口，避免透明区域阻挡鼠标（初始空不计入）
watch(
	() => items.value.length,
	(len, prevLen) => {
		if (prevLen !== undefined && prevLen > 0 && len === 0) {
			window.notificationApi?.notifyPanelEmpty?.();
		}
	}
);

function show(payload: {
	title?: string;
	body?: string;
	source?: string;
	[key: string]: unknown;
}) {
	console.log("[Notify App] show() 被调用", payload);
	const item: NotifItem = {
		id: nextId(),
		title: payload.title || "通知",
		body: payload.body,
		source: payload.source as string | undefined,
		createdAt: Date.now(),
	};
	items.value = [...items.value, item];

	if (items.value.length > MAX_VISIBLE) {
		const oldest = items.value[0];
		remove(oldest.id);
	}

	const timer = setTimeout(() => {
		timers.delete(item.id);
		remove(item.id);
	}, AUTO_DISMISS_MS);
	timers.set(item.id, timer);
}

onMounted(() => {
	console.log(
		"[Notify App] onMounted, notificationApi 存在?",
		!!window.notificationApi
	);
	window.notificationApi?.onNotification?.(show);
	// 通知主进程：Vue 已挂载，可接收通知（此时再 flush 队列）
	console.log("[Notify App] 调用 notifyReady");
	window.notificationApi?.notifyReady?.();
});
</script>

<style scoped>
.notification-panel {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 8px;
	padding: 12px;
	min-width: 320px;
	height: 100vh;
	overflow-y: auto;
	overflow-x: hidden;
}
.notification-item {
	display: flex;
	align-items: flex-start;
	gap: 12px;
	min-width: 280px;
	max-width: 380px;
	padding: 12px 14px;
	background: var(--bg-elevated, #ffffff);
	border: 1px solid var(--bg-elevated-border, rgba(0, 0, 0, 0.08));
	border-radius: 14px;
	box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12), 0 0 1px rgba(0, 0, 0, 0.08);
	cursor: pointer;
	transition: box-shadow 0.2s ease;
}
.notification-item:hover {
	box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14), 0 0 1px rgba(0, 0, 0, 0.08);
}
.notification-item__content {
	flex: 1;
	min-width: 0;
}
.notification-item__title {
	font-size: 14px;
	font-weight: 600;
	color: var(--text, #1f2937);
	line-height: 1.35;
}
.notification-item__title :deep(.md-editor-preview-wrapper) {
	padding: 0;
	font-size: 14px;
}
.notification-item__body {
	font-size: 13px;
	color: var(--text-muted, #6b7280);
	margin-top: 4px;
	line-height: 1.45;
	max-height: 8em;
	overflow-y: auto;
	word-break: break-word;
}
.notification-item__body :deep(.md-editor-preview-wrapper) {
	padding: 0;
	font-size: 13px;
}
.notification-item__meta {
	font-size: 11px;
	color: var(--text-muted, #6b7280);
	opacity: 0.8;
	margin-top: 6px;
}
.notification-item__close {
	flex-shrink: 0;
	width: 24px;
	height: 24px;
	display: flex;
	align-items: center;
	justify-content: center;
	border: none;
	background: transparent;
	color: var(--text-muted, #6b7280);
	font-size: 20px;
	line-height: 1;
	cursor: pointer;
	border-radius: 6px;
}
.notification-item__close:hover {
	color: var(--text, #1f2937);
	background: rgba(0, 0, 0, 0.06);
}
.notif-enter-active,
.notif-leave-active {
	transition: opacity 0.25s, transform 0.25s;
}
.notif-enter-from {
	opacity: 0;
	transform: translateX(20px);
}
.notif-leave-to {
	opacity: 0;
	transform: translateX(12px) scale(0.98);
}
</style>
