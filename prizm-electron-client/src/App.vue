<template>
	<div class="app-shell">
		<header class="app-header">
			<div class="app-brand">
				<span
					class="status-dot"
					:class="{
						connected: status === 'connected',
						disconnected: status === 'disconnected',
						error: status === 'error',
					}"
				/>
				<h1>Prizm</h1>
			</div>
			<nav class="app-nav">
				<button
					class="nav-btn"
					:class="{ active: activePage === 'work' }"
					@click="activePage = 'work'"
				>
					工作
				</button>
				<button
					class="nav-btn"
					:class="{ active: activePage === 'settings' }"
					@click="activePage = 'settings'"
				>
					设置
				</button>
				<button
					class="nav-btn"
					:class="{ active: activePage === 'test' }"
					@click="activePage = 'test'"
				>
					测试
				</button>
			</nav>
		</header>

		<main class="app-main">
			<WorkPage v-show="activePage === 'work'" />
			<SettingsPage v-show="activePage === 'settings'" />
			<TestPage v-show="activePage === 'test'" />
		</main>
	</div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import WorkPage from "./views/WorkPage.vue";
import SettingsPage from "./views/SettingsPage.vue";
import TestPage from "./views/TestPage.vue";
import {
	status,
	config,
	loadConfig,
	initializePrizm,
	lastSyncEvent,
	manager,
} from "./composables/usePrizm";
import { addLog } from "./composables/useLogs";
import type { NotificationPayload } from "@prizm/client-core";

const activePage = ref<"work" | "settings" | "test">("work");

let unsubscribeClipboard: (() => void) | null = null;

onMounted(async () => {
	addLog("Prizm Electron 通知客户端启动", "info");
	unsubscribeClipboard = window.prizm.onClipboardItemAdded(() => {
		lastSyncEvent.value = "clipboard:itemAdded";
	});
	const cfg = await loadConfig();
	if (!cfg) {
		addLog("请先配置服务器并注册客户端", "warning");
		activePage.value = "settings";
		return;
	}
	if (!cfg.api_key?.length) {
		addLog("需要注册客户端获取 API Key", "warning");
		activePage.value = "settings";
		return;
	}
	await initializePrizm(cfg, {
		onLog: addLog,
		onNotify: (p: NotificationPayload) => addLog(`通知: ${p.title}`, "info"),
	});
});

onBeforeUnmount(() => {
	unsubscribeClipboard?.();
	unsubscribeClipboard = null;
	manager.value?.disconnect();
	manager.value = null;
});
</script>

<style scoped>
.app-shell {
	display: flex;
	flex-direction: column;
	height: 100vh;
}
.app-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 12px 16px;
	background: var(--bg-elevated);
	border-bottom: 1px solid var(--border);
	flex-shrink: 0;
}
.app-brand {
	display: flex;
	align-items: center;
	gap: 10px;
}
.app-brand h1 {
	font-size: 20px;
	font-weight: 700;
	color: var(--text);
	letter-spacing: -0.02em;
}
.app-nav {
	display: flex;
	gap: 4px;
}
.nav-btn {
	padding: 6px 14px;
	border: none;
	border-radius: var(--radius-sm);
	font-size: 13px;
	font-weight: 500;
	cursor: pointer;
	background: transparent;
	color: var(--text-muted);
	transition: all 0.15s;
}
.nav-btn:hover {
	background: #f3f4f6;
	color: var(--text);
}
.nav-btn.active {
	background: var(--accent);
	color: white;
}
.status-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	flex-shrink: 0;
}
.status-dot.connected {
	background: var(--success);
	box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.3);
}
.status-dot.disconnected {
	background: var(--warning);
}
.status-dot.error {
	background: var(--error);
}
.app-main {
	flex: 1;
	overflow: hidden;
	display: flex;
	flex-direction: column;
}
</style>
