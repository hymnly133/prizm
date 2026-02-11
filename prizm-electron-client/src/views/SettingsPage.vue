<template>
	<section class="page settings-page">
		<div class="settings-section">
			<h2>服务器配置</h2>
			<div class="form-group">
				<label>服务器地址</label>
				<input v-model="form.host" type="text" placeholder="127.0.0.1" />
			</div>
			<div class="form-group">
				<label>端口</label>
				<input v-model="form.port" type="number" placeholder="4127" />
				<p class="form-hint">默认端口: 4127</p>
			</div>
			<div class="form-group">
				<label>客户端名称</label>
				<input
					v-model="form.clientName"
					type="text"
					placeholder="Prizm Electron Client"
				/>
			</div>
			<div class="form-group">
				<label>请求的 Scopes (逗号分隔)</label>
				<input
					v-model="form.scopesText"
					type="text"
					placeholder="default, online"
				/>
				<p class="form-hint">例如: default, online（online 为实时上下文）</p>
			</div>
			<div class="form-group">
				<label>接收通知的事件</label>
				<p class="form-hint">勾选后，对应事件发生时将弹出应用内通知</p>
				<div class="notify-events-grid">
					<label v-for="ev in EVENT_TYPES" :key="ev">
						<input type="checkbox" :value="ev" v-model="form.notifyEvents" />
						{{ getEventLabel(ev) }}
					</label>
				</div>
			</div>
			<div class="config-actions">
				<button
					class="btn-secondary"
					@click="testConnection"
					:disabled="testing"
				>
					{{ testing ? "测试中..." : "测试连接" }}
				</button>
				<button class="btn-secondary" @click="saveConfig">保存配置</button>
				<button
					class="btn-primary"
					@click="registerClient"
					:disabled="registering"
				>
					{{ registering ? "注册中..." : "注册客户端" }}
				</button>
			</div>
		</div>

		<div class="settings-section">
			<h2>快捷操作</h2>
			<div class="config-actions">
				<button
					class="btn-secondary"
					@click="reconnect"
					:disabled="reconnecting"
				>
					{{ reconnecting ? "重新连接中..." : "重新连接" }}
				</button>
				<button class="btn-secondary" @click="openDashboard">打开仪表板</button>
			</div>
		</div>

		<div class="settings-section logs-section">
			<h2>日志</h2>
			<div class="logs">
				<template v-if="logs.length === 0">
					<div class="log-placeholder">等待连接...</div>
				</template>
				<div
					v-for="(log, i) in logs"
					:key="i"
					class="log-item"
					:class="log.type"
				>
					<span class="log-time">[{{ log.timestamp }}]</span>
					<span class="log-msg">{{ log.message }}</span>
				</div>
			</div>
		</div>
	</section>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted } from "vue";
import { EVENT_TYPES, getEventLabel, buildServerUrl } from "@prizm/client-core";
import {
	config,
	loadConfig,
	saveConfig as saveConfigApi,
	testConnection as testConnectionApi,
	registerClient as registerClientApi,
	initializePrizm,
} from "../composables/usePrizm";
import { logs, addLog } from "../composables/useLogs";
import type { PrizmConfig, EventType } from "@prizm/client-core";

const testing = ref(false);
const registering = ref(false);
const reconnecting = ref(false);

const form = reactive({
	host: "127.0.0.1",
	port: "4127",
	clientName: "Prizm Electron Client",
	scopesText: "default, online",
	notifyEvents: ["notification"] as string[],
});

watch(
	config,
	(c) => {
		if (c) {
			form.host = c.server.host;
			form.port = c.server.port;
			form.clientName = c.client.name;
			form.scopesText = c.client.requested_scopes.join(", ");
			form.notifyEvents = [...(c.notify_events ?? ["notification"])];
		}
	},
	{ immediate: true }
);

async function saveConfig() {
	const scopes = form.scopesText
		? form.scopesText
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: ["default", "online"];
	const base = config.value ?? {
		server: { host: "", port: "", is_dev: "true" },
		client: {
			name: "",
			auto_register: "true",
			requested_scopes: ["default", "online"],
		},
		api_key: "",
		tray: {
			enabled: "true",
			minimize_to_tray: "true",
			show_notification: "true",
		},
		notify_events: ["notification"],
	};
	const cfg: PrizmConfig = { ...base };
	cfg.server = { ...cfg.server, host: form.host, port: form.port };
	cfg.client = {
		...cfg.client,
		name: form.clientName,
		requested_scopes: scopes,
	};
	cfg.notify_events = form.notifyEvents as EventType[];
	const ok = await saveConfigApi(cfg);
	if (ok) {
		config.value = cfg;
		addLog("配置已保存", "success");
	}
}

async function testConnection() {
	const serverUrl = buildServerUrl(form.host.trim(), form.port.trim());
	if (!form.host.trim() || !form.port.trim()) {
		addLog("请填写服务器地址和端口", "error");
		return;
	}
	testing.value = true;
	const success = await testConnectionApi(serverUrl);
	testing.value = false;
	addLog(
		success ? "服务器连接成功" : "无法连接到服务器",
		success ? "success" : "error"
	);
}

async function registerClient() {
	const serverUrl = buildServerUrl(form.host.trim(), form.port.trim());
	if (!form.host.trim() || !form.port.trim()) {
		addLog("请填写服务器地址和端口", "error");
		return;
	}
	if (!form.clientName.trim()) {
		addLog("请填写客户端名称", "error");
		return;
	}
	const scopes = form.scopesText
		? form.scopesText
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: ["default", "online"];
	registering.value = true;
	const apiKey = await registerClientApi(
		serverUrl,
		form.clientName.trim(),
		scopes
	);
	registering.value = false;
	if (apiKey) {
		const cfg = await loadConfig();
		if (cfg) {
			config.value = cfg;
			addLog("注册成功，正在重新加载...", "success");
			window.location.reload();
		}
	}
}

async function reconnect() {
	const c = config.value;
	if (!c) {
		addLog("没有配置可用的服务器", "error");
		return;
	}
	reconnecting.value = true;
	try {
		await initializePrizm(c, {
			onLog: addLog,
			onNotify: (p) => addLog(`通知: ${p.title}`, "info"),
		});
	} finally {
		reconnecting.value = false;
	}
}

async function openDashboard() {
	const c = config.value;
	if (!c) {
		addLog("没有配置可用的服务器", "error");
		return;
	}
	try {
		await window.prizm.openDashboard(
			buildServerUrl(c.server.host, c.server.port)
		);
		addLog("已打开仪表板", "success");
	} catch (e) {
		addLog(`打开仪表板失败: ${String(e)}`, "error");
	}
}

onMounted(() => {
	if (!config.value) {
		form.host = "127.0.0.1";
		form.port = "4127";
		form.clientName = "Prizm Electron Client";
		form.scopesText = "default, online";
		form.notifyEvents = ["notification"];
	}
});
</script>

<style scoped>
.page {
	display: flex;
	flex: 1;
	flex-direction: column;
	overflow: hidden;
	padding: 16px;
}
.settings-page {
	overflow-y: auto;
}
.settings-section {
	margin-bottom: 24px;
}
.settings-section h2 {
	font-size: 15px;
	font-weight: 600;
	margin-bottom: 12px;
	color: var(--text);
}
.form-group {
	margin-bottom: 14px;
}
.form-group label {
	display: block;
	font-size: 13px;
	font-weight: 500;
	color: var(--text);
	margin-bottom: 6px;
}
.form-group input {
	width: 100%;
	padding: 10px 12px;
	border: 1px solid var(--border);
	border-radius: var(--radius-sm);
	font-size: 14px;
	font-family: inherit;
}
.form-group input:focus {
	outline: none;
	border-color: var(--accent);
	box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.1);
}
.form-hint {
	font-size: 12px;
	color: var(--text-muted);
	margin-top: 4px;
}
.notify-events-grid {
	display: grid;
	grid-template-columns: repeat(2, 1fr);
	gap: 8px 16px;
	margin-top: 8px;
}
.notify-events-grid label {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 13px;
	cursor: pointer;
}
.notify-events-grid input[type="checkbox"] {
	width: 16px;
	height: 16px;
}
.config-actions {
	display: flex;
	gap: 10px;
	margin-top: 16px;
	flex-wrap: wrap;
}
.btn-secondary {
	background: #f3f4f6;
	color: var(--text);
	padding: 10px 16px;
	border-radius: var(--radius-sm);
	border: none;
	font-size: 14px;
	font-weight: 500;
	cursor: pointer;
}
.btn-secondary:hover:not(:disabled) {
	background: #e5e7eb;
}
.btn-secondary:disabled {
	opacity: 0.6;
	cursor: not-allowed;
}
.btn-primary {
	background: var(--accent);
	color: white;
	padding: 10px 16px;
	border-radius: var(--radius-sm);
	border: none;
	font-size: 14px;
	font-weight: 600;
	cursor: pointer;
}
.btn-primary:hover:not(:disabled) {
	background: var(--accent-hover);
}
.btn-primary:disabled {
	opacity: 0.6;
	cursor: not-allowed;
}
.logs-section {
	margin-top: 24px;
}
.logs-section h2 {
	font-size: 15px;
	font-weight: 600;
	margin-bottom: 10px;
	color: var(--text);
}
.logs {
	background: #1e293b;
	border-radius: var(--radius);
	padding: 12px;
	max-height: 160px;
	overflow-y: auto;
	font-family: "Consolas", "Monaco", monospace;
	font-size: 12px;
	color: #e2e8f0;
}
.log-placeholder {
	color: #64748b;
}
.log-item {
	padding: 4px 0;
}
.log-item.info {
	color: #93c5fd;
}
.log-item.success {
	color: #86efac;
}
.log-item.error {
	color: #fca5a5;
}
.log-item.warning {
	color: #fcd34d;
}
.log-time {
	color: #64748b;
	margin-right: 8px;
}
</style>
