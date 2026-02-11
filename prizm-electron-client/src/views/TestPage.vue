<template>
	<section class="page settings-page">
		<div class="settings-section">
			<h2>本地通知测试</h2>
			<p class="form-hint">直接弹出应用内通知窗口，无需服务器</p>
			<div class="test-row">
				<input
					v-model="localNotif.title"
					type="text"
					placeholder="标题"
					class="test-input"
				/>
				<input
					v-model="localNotif.body"
					type="text"
					placeholder="内容（可选）"
					class="test-input"
				/>
				<button
					class="btn-primary"
					@click="sendLocalNotif"
					:disabled="!localNotif.title.trim()"
				>
					发送本地通知
				</button>
			</div>
		</div>

		<div class="settings-section">
			<h2>服务器通知测试</h2>
			<p class="form-hint">
				通过 POST /notify 发送，会经 WebSocket 推送给已连接的客户端
			</p>
			<div class="test-row">
				<input
					v-model="serverNotif.title"
					type="text"
					placeholder="标题"
					class="test-input"
				/>
				<input
					v-model="serverNotif.body"
					type="text"
					placeholder="内容（可选）"
					class="test-input"
				/>
				<button
					class="btn-primary"
					@click="sendServerNotif"
					:disabled="!serverNotif.title.trim() || !manager"
				>
					发送服务器通知
				</button>
			</div>
			<p
				v-if="serverNotifResult"
				class="form-hint"
				:class="serverNotifResult.ok ? 'text-success' : 'text-error'"
			>
				{{ serverNotifResult.msg }}
			</p>
		</div>

		<div class="settings-section">
			<h2>模拟数据</h2>
			<p class="form-hint">
				通过 API 创建数据，触发 WebSocket 同步，各 Tab 会自动刷新
			</p>
			<div class="test-actions">
				<div class="test-action">
					<input
						v-model="mockNote"
						type="text"
						placeholder="便签内容"
						class="test-input"
					/>
					<button
						class="btn-secondary"
						@click="mockCreateNote"
						:disabled="!mockNote.trim() || !manager"
					>
						创建便签
					</button>
				</div>
				<div class="test-action">
					<input
						v-model="mockTask"
						type="text"
						placeholder="任务标题"
						class="test-input"
					/>
					<button
						class="btn-secondary"
						@click="mockCreateTask"
						:disabled="!mockTask.trim() || !manager"
					>
						创建任务
					</button>
				</div>
				<div class="test-action">
					<input
						v-model="mockClipboard"
						type="text"
						placeholder="剪贴板内容"
						class="test-input"
					/>
					<button
						class="btn-secondary"
						@click="mockAddClipboard"
						:disabled="!mockClipboard.trim() || !manager"
					>
						添加剪贴板
					</button>
				</div>
			</div>
			<p
				v-if="mockResult"
				class="form-hint"
				:class="mockResult.ok ? 'text-success' : 'text-error'"
			>
				{{ mockResult.msg }}
			</p>
		</div>

		<div class="settings-section">
			<h2>手动刷新</h2>
			<p class="form-hint">强制触发各 Tab 列表刷新（用于测试数据同步）</p>
			<div class="config-actions">
				<button class="btn-secondary" @click="triggerRefresh('note:created')">
					刷新便签
				</button>
				<button class="btn-secondary" @click="triggerRefresh('task:created')">
					刷新任务
				</button>
				<button
					class="btn-secondary"
					@click="triggerRefresh('clipboard:itemAdded')"
				>
					刷新剪贴板
				</button>
			</div>
		</div>
	</section>
</template>

<script setup lang="ts">
import { ref, reactive } from "vue";
import { manager, lastSyncEvent } from "../composables/usePrizm";
import { addLog } from "../composables/useLogs";

const localNotif = reactive({
	title: "测试通知",
	body: "支持 **Markdown** 渲染",
});
const serverNotif = reactive({ title: "服务器通知", body: "来自 WebSocket" });
const serverNotifResult = ref<{ ok: boolean; msg: string } | null>(null);
const mockNote = ref("测试便签内容");
const mockTask = ref("测试任务");
const mockClipboard = ref("测试剪贴板内容");
const mockResult = ref<{ ok: boolean; msg: string } | null>(null);

function sendLocalNotif() {
	if (!localNotif.title.trim()) return;
	window.prizm.showNotification({
		title: localNotif.title.trim(),
		body: localNotif.body.trim() || undefined,
	});
	addLog("已发送本地通知", "success");
}

async function sendServerNotif() {
	if (!serverNotif.title.trim() || !manager.value) return;
	serverNotifResult.value = null;
	try {
		const http = manager.value.getHttpClient();
		await http.sendNotify(
			serverNotif.title.trim(),
			serverNotif.body.trim() || undefined
		);
		serverNotifResult.value = {
			ok: true,
			msg: "已发送，若已连接 WebSocket 将收到通知",
		};
		addLog("已发送服务器通知", "success");
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		serverNotifResult.value = { ok: false, msg };
		addLog(`服务器通知失败: ${msg}`, "error");
	}
}

async function mockCreateNote() {
	if (!mockNote.value.trim() || !manager.value) return;
	mockResult.value = null;
	try {
		const http = manager.value.getHttpClient();
		await http.createNote({ content: mockNote.value.trim() });
		lastSyncEvent.value = "note:created";
		mockResult.value = { ok: true, msg: "已创建便签，便签 Tab 将刷新" };
		addLog("已创建测试便签", "success");
	} catch (e) {
		mockResult.value = {
			ok: false,
			msg: e instanceof Error ? e.message : String(e),
		};
		addLog(`创建便签失败: ${String(e)}`, "error");
	}
}

async function mockCreateTask() {
	if (!mockTask.value.trim() || !manager.value) return;
	mockResult.value = null;
	try {
		const http = manager.value.getHttpClient();
		await http.createTask({
			title: mockTask.value.trim(),
			description: "",
			status: "todo",
			priority: "medium",
			dueAt: undefined,
			noteId: undefined,
		});
		lastSyncEvent.value = "task:created";
		mockResult.value = { ok: true, msg: "已创建任务，任务 Tab 将刷新" };
		addLog("已创建测试任务", "success");
	} catch (e) {
		mockResult.value = {
			ok: false,
			msg: e instanceof Error ? e.message : String(e),
		};
		addLog(`创建任务失败: ${String(e)}`, "error");
	}
}

async function mockAddClipboard() {
	if (!mockClipboard.value.trim() || !manager.value) return;
	mockResult.value = null;
	try {
		const http = manager.value.getHttpClient();
		await http.addClipboardItem({
			type: "text",
			content: mockClipboard.value.trim(),
			createdAt: Date.now(),
		});
		lastSyncEvent.value = "clipboard:itemAdded";
		mockResult.value = { ok: true, msg: "已添加剪贴板项，剪贴板 Tab 将刷新" };
		addLog("已添加测试剪贴板", "success");
	} catch (e) {
		mockResult.value = {
			ok: false,
			msg: e instanceof Error ? e.message : String(e),
		};
		addLog(`添加剪贴板失败: ${String(e)}`, "error");
	}
}

function triggerRefresh(eventType: string) {
	lastSyncEvent.value = eventType;
	addLog(`已触发刷新: ${eventType}`, "info");
}
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
	margin-bottom: 8px;
	color: var(--text);
}
.form-hint {
	font-size: 12px;
	color: var(--text-muted);
	margin-bottom: 10px;
}
.text-success {
	color: var(--success);
}
.text-error {
	color: var(--error);
}
.test-row {
	display: flex;
	gap: 8px;
	margin-bottom: 8px;
	flex-wrap: wrap;
}
.test-action {
	display: flex;
	gap: 8px;
	margin-bottom: 8px;
	align-items: center;
}
.test-actions {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.test-input {
	flex: 1;
	min-width: 120px;
	padding: 8px 12px;
	border: 1px solid var(--border);
	border-radius: var(--radius-sm);
	font-size: 14px;
	font-family: inherit;
}
.test-input:focus {
	outline: none;
	border-color: var(--accent);
}
.config-actions {
	display: flex;
	gap: 10px;
	margin-top: 8px;
	flex-wrap: wrap;
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
</style>
