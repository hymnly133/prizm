<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold">Agent 会话 (Scope: {{ currentScope }})</h1>
      <button
        class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        @click="createSession"
      >
        新建会话
      </button>
    </div>

    <!-- 调试/管理面板 -->
    <div class="rounded-lg border border-amber-900/50 bg-amber-950/20">
      <button
        class="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-medium text-amber-200 hover:bg-amber-900/30"
        @click="debugPanelOpen = !debugPanelOpen"
      >
        <span>调试 / 管理</span>
        <span class="text-amber-500">{{ debugPanelOpen ? '▼' : '▶' }}</span>
      </button>
      <div v-if="debugPanelOpen" class="border-t border-amber-900/50 p-4 space-y-4">
        <!-- Scope 上下文预览 -->
        <div>
          <h3 class="mb-2 text-xs font-medium text-amber-300">Scope 上下文预览</h3>
          <div v-if="scopeContextLoading" class="text-zinc-500 text-sm">加载中...</div>
          <pre
            v-else-if="scopeContextSummary"
            class="max-h-40 overflow-auto rounded bg-zinc-900/80 p-3 text-xs text-zinc-300 whitespace-pre-wrap"
            >{{ scopeContextSummary }}</pre
          >
          <p v-else class="text-zinc-500 text-sm">当前 scope 无便签/待办/文档数据</p>
          <button
            class="mt-1 text-xs text-amber-400 hover:text-amber-300"
            @click="loadScopeContext"
          >
            刷新
          </button>
        </div>
        <!-- 发送选项 -->
        <div class="flex items-center gap-4">
          <label class="flex items-center gap-2 text-sm text-zinc-300">
            <input v-model="includeScopeContext" type="checkbox" class="rounded border-zinc-600" />
            发送时注入 Scope 上下文
          </label>
        </div>
        <!-- 导出会话 JSON -->
        <div v-if="selectedSession">
          <button
            class="rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            @click="copySessionJson"
          >
            复制会话 JSON
          </button>
        </div>
      </div>
    </div>

    <div v-if="sessionsLoading" class="text-zinc-400">加载会话列表...</div>
    <div v-else-if="sessionsError" class="rounded bg-red-950/30 p-4 text-red-400">
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
              {{ s.llmSummary?.trim() || `会话 ${s.id.slice(0, 8)}` }}
            </button>
            <p v-if="sessions.length === 0" class="text-sm text-zinc-500">暂无会话</p>
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
                  : msg.role === 'command_result'
                  ? 'mr-8 border-l-4 border-amber-500 bg-amber-950/30 text-left'
                  : 'mr-8 bg-zinc-700/50 text-left'
              "
            >
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs text-zinc-500">
                  {{
                    msg.role === 'user'
                      ? '你'
                      : msg.role === 'command_result'
                      ? '命令结果'
                      : 'Agent'
                  }}
                </p>
                <div
                  v-if="msg.model || msg.usage"
                  class="flex items-center gap-2 text-xs text-zinc-500"
                >
                  <span v-if="msg.model">{{ msg.model }}</span>
                  <span v-if="msg.usage?.totalTokens">· {{ msg.usage.totalTokens }} tokens</span>
                  <button
                    v-if="msg.reasoning"
                    class="text-amber-400 hover:text-amber-300"
                    @click="msgShowReasoning = msgShowReasoning === msg.id ? null : msg.id"
                  >
                    {{ msgShowReasoning === msg.id ? '隐藏思考' : '显示思考' }}
                  </button>
                </div>
              </div>
              <p class="whitespace-pre-wrap text-zinc-100">{{ msg.content }}</p>
              <div
                v-if="msg.reasoning && msgShowReasoning === msg.id"
                class="mt-2 rounded bg-zinc-800/80 p-2 text-xs text-amber-200/90 whitespace-pre-wrap"
              >
                {{ msg.reasoning }}
              </div>
            </div>
            <div v-if="streamingContent" class="mr-8 rounded bg-zinc-700/50 px-3 py-2 text-left">
              <p class="text-xs text-zinc-500">Agent</p>
              <p class="whitespace-pre-wrap text-zinc-100">{{ streamingContent }}▌</p>
            </div>
          </div>
          <div class="border-t border-zinc-700 p-4">
            <p class="mb-1 text-xs text-zinc-500">
              输入 <code class="rounded bg-zinc-700 px-1">@</code> 引用便签/文档/待办，输入
              <code class="rounded bg-zinc-700 px-1">/</code> 执行命令（如 /notes、/todos、/help）
            </p>
            <form class="flex flex-col gap-2" @submit.prevent="sendMessage">
              <div class="relative flex gap-2">
                <div class="relative flex-1">
                  <textarea
                    ref="inputRef"
                    v-model="inputContent"
                    class="min-h-[60px] w-full resize-none rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    placeholder="输入消息..."
                    rows="2"
                    :disabled="sending"
                    @input="onInputForAt"
                    @keydown.down="
                      (e) => {
                        if (atDropdownVisible) {
                          e.preventDefault()
                          atSelectNext()
                        } else if (slashDropdownVisible) {
                          e.preventDefault()
                          slashSelectNext()
                        }
                      }
                    "
                    @keydown.up="
                      (e) => {
                        if (atDropdownVisible) {
                          e.preventDefault()
                          atSelectPrev()
                        } else if (slashDropdownVisible) {
                          e.preventDefault()
                          slashSelectPrev()
                        }
                      }
                    "
                    @keydown.enter="
                      (e) => {
                        if (atDropdownVisible || slashDropdownVisible) {
                          e.preventDefault()
                          atSelectConfirm()
                        }
                      }
                    "
                  />
                  <div
                    v-if="atDropdownVisible && atCandidates.length > 0"
                    class="absolute left-0 top-full z-10 mt-1 max-h-48 w-full overflow-auto rounded border border-zinc-600 bg-zinc-800 py-1 shadow-lg"
                  >
                    <button
                      v-for="(item, i) in atCandidates"
                      :key="item.kind + ':' + item.id"
                      type="button"
                      class="w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-700"
                      :class="{ 'bg-emerald-900/50': atSelectedIndex === i }"
                      @click="atPick(item, i)"
                    >
                      <span class="text-zinc-400"
                        >@{{ item.kind === 'document' ? 'doc' : item.kind }}:{{
                          item.id.slice(0, 8)
                        }}</span
                      >
                      {{ item.title.slice(0, 40) }}{{ item.title.length > 40 ? '…' : '' }}
                    </button>
                  </div>
                  <div
                    v-else-if="slashDropdownVisible && slashCandidates.length > 0"
                    class="absolute left-0 top-full z-10 mt-1 max-h-48 w-full overflow-auto rounded border border-zinc-600 bg-zinc-800 py-1 shadow-lg"
                  >
                    <button
                      v-for="(cmd, i) in slashCandidates"
                      :key="cmd.name"
                      type="button"
                      class="w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-700"
                      :class="{ 'bg-emerald-900/50': slashSelectedIndex === i }"
                      @click="slashPick(cmd, i)"
                    >
                      <span class="font-medium">/{{ cmd.name }}</span>
                      <span class="text-zinc-400"> {{ cmd.description }}</span>
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                  :disabled="sending || !inputContent.trim()"
                >
                  {{ sending ? '发送中...' : '发送' }}
                </button>
              </div>
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
import { ref, onMounted, watch } from 'vue'
import {
  listAgentSessions,
  createAgentSession,
  getAgentSession,
  deleteAgentSession,
  sendAgentChat,
  getAgentScopeContext,
  getAgentScopeItems,
  getAgentSlashCommands,
  type AgentSession,
  type ScopeRefItem,
  type SlashCommandItem
} from '../api/client'
import { useScope } from '../composables/useScope'

const { currentScope } = useScope()
const inputRef = ref<HTMLTextAreaElement | null>(null)
const scopeItems = ref<ScopeRefItem[]>([])
const slashCommands = ref<SlashCommandItem[]>([])
const atDropdownVisible = ref(false)
const atCandidates = ref<ScopeRefItem[]>([])
const atSelectedIndex = ref(0)
const atReplaceStart = ref(0)
const atReplaceEnd = ref(0)
const slashDropdownVisible = ref(false)
const slashCandidates = ref<SlashCommandItem[]>([])
const slashSelectedIndex = ref(0)
const slashReplaceStart = ref(0)
const slashReplaceEnd = ref(0)
const sessions = ref<AgentSession[]>([])
const sessionsLoading = ref(true)
const sessionsError = ref('')
const selectedId = ref<string | null>(null)
const selectedSession = ref<AgentSession | null>(null)
const inputContent = ref('')
const sending = ref(false)
const chatError = ref('')
const streamingContent = ref('')

interface DisplayMessage {
  id: string
  role: string
  content: string
  model?: string
  usage?: { totalTokens?: number; totalInputTokens?: number; totalOutputTokens?: number }
  reasoning?: string
}
const displayedMessages = ref<DisplayMessage[]>([])
const debugPanelOpen = ref(false)
const scopeContextSummary = ref('')
const scopeContextLoading = ref(false)
const includeScopeContext = ref(true)
const msgShowReasoning = ref<string | null>(null)

async function loadSessions() {
  sessionsLoading.value = true
  sessionsError.value = ''
  try {
    const res = await listAgentSessions(currentScope.value)
    sessions.value = res.sessions ?? []
    if (selectedId.value && !sessions.value.some((s) => s.id === selectedId.value)) {
      selectedId.value = null
      selectedSession.value = null
      displayedMessages.value = []
    }
  } catch (e) {
    sessionsError.value = e instanceof Error ? e.message : String(e)
  } finally {
    sessionsLoading.value = false
  }
}

async function loadScopeContext() {
  scopeContextLoading.value = true
  try {
    const res = await getAgentScopeContext(currentScope.value)
    scopeContextSummary.value = res.summary || ''
  } catch {
    scopeContextSummary.value = ''
  } finally {
    scopeContextLoading.value = false
  }
}

async function loadScopeItems() {
  try {
    const res = await getAgentScopeItems(currentScope.value)
    scopeItems.value = res.items ?? []
  } catch {
    scopeItems.value = []
  }
}

async function loadSlashCommands() {
  try {
    const res = await getAgentSlashCommands(currentScope.value)
    slashCommands.value = res.commands ?? []
  } catch {
    slashCommands.value = []
  }
}

function onInputForAt() {
  const s = inputContent.value
  const pos = inputRef.value?.selectionStart ?? s.length

  const trimmed = s.trimStart()
  if (trimmed.startsWith('/')) {
    atDropdownVisible.value = false
    const after = trimmed.slice(1)
    const spaceIdx = after.search(/\s/)
    const query = (spaceIdx >= 0 ? after.slice(0, spaceIdx) : after).toLowerCase()
    slashReplaceStart.value = 0
    slashReplaceEnd.value = s.length
    const filtered = query
      ? slashCommands.value.filter(
          (c) =>
            c.name.toLowerCase().includes(query) ||
            c.aliases.some((a) => a.toLowerCase().includes(query)) ||
            c.description.toLowerCase().includes(query)
        )
      : [...slashCommands.value]
    slashCandidates.value = filtered.slice(0, 15)
    slashSelectedIndex.value = 0
    slashDropdownVisible.value = slashCandidates.value.length > 0
    return
  }

  slashDropdownVisible.value = false
  const lastAt = s.lastIndexOf('@', pos - 1)
  if (lastAt < 0) {
    atDropdownVisible.value = false
    return
  }
  const query = s
    .slice(lastAt + 1, pos)
    .toLowerCase()
    .trim()
  atReplaceStart.value = lastAt
  atReplaceEnd.value = pos
  const kindKey = (k: string) => (k === 'document' ? 'doc' : k)
  const filtered = query
    ? scopeItems.value.filter(
        (item) =>
          kindKey(item.kind).includes(query) ||
          item.title.toLowerCase().includes(query) ||
          item.id.toLowerCase().includes(query)
      )
    : [...scopeItems.value]
  atCandidates.value = filtered.slice(0, 20)
  atSelectedIndex.value = 0
  atDropdownVisible.value = atCandidates.value.length > 0
}

function atPick(item: ScopeRefItem, _i: number) {
  const key = item.kind === 'document' ? 'doc' : item.kind
  const replacement = `@${key}:${item.id}`
  inputContent.value =
    inputContent.value.slice(0, atReplaceStart.value) +
    replacement +
    inputContent.value.slice(atReplaceEnd.value)
  atDropdownVisible.value = false
  inputRef.value?.focus()
}

function atSelectNext() {
  if (!atDropdownVisible.value || atCandidates.value.length === 0) return
  atSelectedIndex.value = (atSelectedIndex.value + 1) % atCandidates.value.length
}

function atSelectPrev() {
  if (!atDropdownVisible.value || atCandidates.value.length === 0) return
  atSelectedIndex.value =
    (atSelectedIndex.value - 1 + atCandidates.value.length) % atCandidates.value.length
}

function atSelectConfirm() {
  if (atDropdownVisible.value && atCandidates.value.length > 0) {
    atPick(atCandidates.value[atSelectedIndex.value], atSelectedIndex.value)
    atDropdownVisible.value = false
  } else if (slashDropdownVisible.value && slashCandidates.value.length > 0) {
    slashPick(slashCandidates.value[slashSelectedIndex.value], slashSelectedIndex.value)
    slashDropdownVisible.value = false
  }
}

function slashPick(cmd: SlashCommandItem, _i: number) {
  const replacement = `/${cmd.name} `
  inputContent.value =
    inputContent.value.slice(0, slashReplaceStart.value) +
    replacement +
    inputContent.value.slice(slashReplaceEnd.value)
  slashDropdownVisible.value = false
  inputRef.value?.focus()
}

function slashSelectNext() {
  if (!slashDropdownVisible.value || slashCandidates.value.length === 0) return
  slashSelectedIndex.value = (slashSelectedIndex.value + 1) % slashCandidates.value.length
}

function slashSelectPrev() {
  if (!slashDropdownVisible.value || slashCandidates.value.length === 0) return
  slashSelectedIndex.value =
    (slashSelectedIndex.value - 1 + slashCandidates.value.length) % slashCandidates.value.length
}

async function loadSelectedSession() {
  if (!selectedId.value) return
  try {
    const res = await getAgentSession(selectedId.value, currentScope.value)
    selectedSession.value = res.session
    displayedMessages.value = res.session.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      model: m.model,
      usage: m.usage,
      reasoning: m.reasoning
    }))
  } catch (e) {
    chatError.value = e instanceof Error ? e.message : String(e)
  }
}

async function createSession() {
  try {
    const res = await createAgentSession(currentScope.value)
    sessions.value = [res.session, ...sessions.value]
    selectedId.value = res.session.id
    selectedSession.value = res.session
    displayedMessages.value = []
    chatError.value = ''
  } catch (e) {
    sessionsError.value = e instanceof Error ? e.message : String(e)
  }
}

function selectSession(s: AgentSession) {
  selectedId.value = s.id
  loadSelectedSession()
  chatError.value = ''
}

async function deleteSession(s: AgentSession) {
  if (!confirm('确定删除该会话？')) return
  try {
    await deleteAgentSession(s.id, currentScope.value)
    await loadSessions()
    if (selectedId.value === s.id) {
      selectedId.value = null
      selectedSession.value = null
      displayedMessages.value = []
    }
  } catch (e) {
    sessionsError.value = e instanceof Error ? e.message : String(e)
  }
}

async function sendMessage() {
  const content = inputContent.value.trim()
  if (!content || !selectedId.value || sending.value) return

  inputContent.value = ''
  chatError.value = ''
  sending.value = true
  streamingContent.value = ''

  displayedMessages.value = [
    ...displayedMessages.value,
    { id: `u-${Date.now()}`, role: 'user', content }
  ]

  try {
    const stream = await sendAgentChat(selectedId.value, content, currentScope.value, {
      includeScopeContext: includeScopeContext.value
    })
    const reader = stream.getReader()
    let full = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.type === 'text' && value.value) {
        full += value.value
        streamingContent.value = full
      }
      if (value.type === 'command_result' && value.value) {
        displayedMessages.value = [
          ...displayedMessages.value,
          { id: `cmd-${Date.now()}`, role: 'command_result', content: value.value }
        ]
        streamingContent.value = ''
      }
      if (value.type === 'done') {
        if (full) {
          displayedMessages.value = [
            ...displayedMessages.value,
            { id: `a-${Date.now()}`, role: 'assistant', content: full }
          ]
        }
        streamingContent.value = ''
        await loadSelectedSession()
      }
      if (value.type === 'error') {
        chatError.value = value.value ?? '生成出错'
        streamingContent.value = ''
      }
    }
  } catch (e) {
    chatError.value = e instanceof Error ? e.message : String(e)
    streamingContent.value = ''
  } finally {
    sending.value = false
  }
}

async function copySessionJson() {
  if (!selectedSession.value) return
  try {
    const json = JSON.stringify(selectedSession.value, null, 2)
    await navigator.clipboard.writeText(json)
    alert('已复制到剪贴板')
  } catch (e) {
    alert('复制失败: ' + (e instanceof Error ? e.message : String(e)))
  }
}

onMounted(() => {
  loadSessions()
  loadScopeContext()
  loadScopeItems()
  loadSlashCommands()
})
watch(currentScope, () => {
  loadSessions()
  loadScopeContext()
  loadScopeItems()
  loadSlashCommands()
  if (selectedId.value) loadSelectedSession()
})
watch(selectedId, (id) => {
  if (id) loadSelectedSession()
  else {
    selectedSession.value = null
    displayedMessages.value = []
  }
})
</script>
