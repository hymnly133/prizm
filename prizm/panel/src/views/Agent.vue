<template>
	<div class="space-y-6">
		<div class="flex flex-wrap items-center justify-between gap-4">
			<h1 class="text-2xl font-semibold">
				Agent 会话 (Scope: {{ currentScope }})
			</h1>
			<button
				class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
				@click="createSession"
			>
				新建会话
			</button>
		</div>

		<div v-if="sessionsLoading" class="text-zinc-400">加载会话列表...</div>
		<div
			v-else-if="sessionsError"
			class="rounded bg-red-950/30 p-4 text-red-400"
		>
			{{ sessionsError }}
		</div>

		<div v-else class="flex flex-col gap-6 lg:flex-row">
			<!-- Session list -->
			<div class="w-full shrink-0 lg:w-64">
				<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
					<h2 class="mb-3 text-sm font-medium text-zinc-400">会话列表</h2>
					<div class="max-h-64 space-y-2 overflow-auto">
						<button
							v-for="s in sessions"
							:key="s.id"
							class="w-full rounded px-3 py-2 text-left text-sm transition"
							:class="
								selectedId === s.id
									? 'bg-emerald-900/50 text-emerald-200'
									: 'text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100'
							"
							@click="selectSession(s)"
						>
							{{ s.title || `会话 ${s.id.slice(0, 8)}` }}
						</button>
						<p v-if="sessions.length === 0" class="text-sm text-zinc-500">
							暂无会话
						</p>
					</div>
					<button
						v-if="selectedSession"
						class="mt-2 text-xs text-red-400 hover:text-red-300"
						@click="deleteSession(selectedSession)"
					>
						删除当前会话
					</button>
				</div>
			</div>

			<!-- Chat area -->
			<div class="min-w-0 flex-1">
				<div
					v-if="!selectedId"
					class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-8 text-center text-zinc-500"
				>
					选择或新建一个会话开始对话
				</div>
				<div v-else class="rounded-lg border border-zinc-700 bg-zinc-800/50">
					<div class="max-h-96 space-y-4 overflow-auto p-4">
						<div
							v-for="msg in displayedMessages"
							:key="msg.id"
							class="rounded px-3 py-2"
							:class="
								msg.role === 'user'
									? 'ml-8 bg-emerald-900/30 text-right'
									: 'mr-8 bg-zinc-700/50 text-left'
							"
						>
							<p class="text-xs text-zinc-500">
								{{ msg.role === "user" ? "你" : "Agent" }}
							</p>
							<p class="whitespace-pre-wrap text-zinc-100">{{ msg.content }}</p>
						</div>
						<div
							v-if="streamingContent"
							class="mr-8 rounded bg-zinc-700/50 px-3 py-2 text-left"
						>
							<p class="text-xs text-zinc-500">Agent</p>
							<p class="whitespace-pre-wrap text-zinc-100">
								{{ streamingContent }}▌
							</p>
						</div>
					</div>
					<div class="border-t border-zinc-700 p-4">
						<form class="flex gap-2" @submit.prevent="sendMessage">
							<textarea
								v-model="inputContent"
								class="min-h-[60px] flex-1 resize-none rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
								placeholder="输入消息..."
								rows="2"
								:disabled="sending"
							/>
							<button
								type="submit"
								class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
								:disabled="sending || !inputContent.trim()"
							>
								{{ sending ? "发送中..." : "发送" }}
							</button>
						</form>
						<p v-if="chatError" class="mt-2 text-sm text-red-400">
							{{ chatError }}
						</p>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import {
	listAgentSessions,
	createAgentSession,
	getAgentSession,
	deleteAgentSession,
	sendAgentChat,
	type AgentSession,
} from "../api/client";
import { useScope } from "../composables/useScope";

const { currentScope } = useScope();
const sessions = ref<AgentSession[]>([]);
const sessionsLoading = ref(true);
const sessionsError = ref("");
const selectedId = ref<string | null>(null);
const selectedSession = ref<AgentSession | null>(null);
const inputContent = ref("");
const sending = ref(false);
const chatError = ref("");
const streamingContent = ref("");

const displayedMessages = ref<{ id: string; role: string; content: string }[]>(
	[]
);

async function loadSessions() {
	sessionsLoading.value = true;
	sessionsError.value = "";
	try {
		const res = await listAgentSessions(currentScope.value);
		sessions.value = res.sessions ?? [];
		if (
			selectedId.value &&
			!sessions.value.some((s) => s.id === selectedId.value)
		) {
			selectedId.value = null;
			selectedSession.value = null;
			displayedMessages.value = [];
		}
	} catch (e) {
		sessionsError.value = e instanceof Error ? e.message : String(e);
	} finally {
		sessionsLoading.value = false;
	}
}

async function loadSelectedSession() {
	if (!selectedId.value) return;
	try {
		const res = await getAgentSession(selectedId.value, currentScope.value);
		selectedSession.value = res.session;
		displayedMessages.value = res.session.messages.map((m) => ({
			id: m.id,
			role: m.role,
			content: m.content,
		}));
	} catch (e) {
		chatError.value = e instanceof Error ? e.message : String(e);
	}
}

async function createSession() {
	try {
		const res = await createAgentSession(currentScope.value);
		sessions.value = [res.session, ...sessions.value];
		selectedId.value = res.session.id;
		selectedSession.value = res.session;
		displayedMessages.value = [];
		chatError.value = "";
	} catch (e) {
		sessionsError.value = e instanceof Error ? e.message : String(e);
	}
}

function selectSession(s: AgentSession) {
	selectedId.value = s.id;
	loadSelectedSession();
	chatError.value = "";
}

async function deleteSession(s: AgentSession) {
	if (!confirm("确定删除该会话？")) return;
	try {
		await deleteAgentSession(s.id, currentScope.value);
		await loadSessions();
		if (selectedId.value === s.id) {
			selectedId.value = null;
			selectedSession.value = null;
			displayedMessages.value = [];
		}
	} catch (e) {
		sessionsError.value = e instanceof Error ? e.message : String(e);
	}
}

async function sendMessage() {
	const content = inputContent.value.trim();
	if (!content || !selectedId.value || sending.value) return;

	inputContent.value = "";
	chatError.value = "";
	sending.value = true;
	streamingContent.value = "";

	displayedMessages.value = [
		...displayedMessages.value,
		{ id: `u-${Date.now()}`, role: "user", content },
	];

	try {
		const stream = await sendAgentChat(
			selectedId.value,
			content,
			currentScope.value
		);
		const reader = stream.getReader();
		let full = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value.type === "text" && value.value) {
				full += value.value;
				streamingContent.value = full;
			}
			if (value.type === "done") {
				displayedMessages.value = [
					...displayedMessages.value,
					{ id: `a-${Date.now()}`, role: "assistant", content: full },
				];
				streamingContent.value = "";
				await loadSelectedSession();
			}
			if (value.type === "error") {
				chatError.value = value.value ?? "生成出错";
				streamingContent.value = "";
			}
		}
	} catch (e) {
		chatError.value = e instanceof Error ? e.message : String(e);
		streamingContent.value = "";
	} finally {
		sending.value = false;
	}
}

onMounted(loadSessions);
watch(currentScope, () => {
	loadSessions();
	if (selectedId.value) loadSelectedSession();
});
watch(selectedId, (id) => {
	if (id) loadSelectedSession();
	else {
		selectedSession.value = null;
		displayedMessages.value = [];
	}
});
</script>
