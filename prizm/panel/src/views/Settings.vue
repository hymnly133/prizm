<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Agent 工具配置</h1>
    <p class="text-sm text-zinc-400">
      内置联网搜索与 MCP 服务器，Agent 对话时可调用。Tavily 需 API Key；MCP 支持 headers/env 鉴权。
    </p>

    <!-- 内置工具：Tavily -->
    <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <h2 class="mb-4 text-lg font-medium">Tavily 联网搜索</h2>
      <p class="mb-4 text-sm text-zinc-400">
        为 Agent 提供实时联网搜索能力，需在
        <a
          href="https://tavily.com"
          target="_blank"
          rel="noreferrer"
          class="text-emerald-400 hover:underline"
          >tavily.com</a
        >
        获取 API Key
      </p>
      <div v-if="tavilyLoading" class="text-zinc-400">加载中...</div>
      <form v-else class="space-y-4 max-w-md" @submit.prevent="saveTavily">
        <div>
          <label class="mb-1 block text-sm text-zinc-400">API Key</label>
          <input
            v-model="tavilyApiKeyInput"
            type="password"
            class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
            :placeholder="tavily?.configured ? '已配置，留空不修改' : 'tvly-xxx'"
          />
        </div>
        <div class="flex items-center gap-2">
          <input v-model="tavilyEnabled" type="checkbox" class="rounded border-zinc-600" />
          <label class="text-sm text-zinc-300">启用</label>
        </div>
        <div>
          <label class="mb-1 block text-sm text-zinc-400">最大结果数 (1-20)</label>
          <input
            v-model.number="tavilyMaxResults"
            type="number"
            min="1"
            max="20"
            class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label class="mb-1 block text-sm text-zinc-400">搜索深度</label>
          <select
            v-model="tavilySearchDepth"
            class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
          >
            <option value="basic">basic</option>
            <option value="advanced">advanced</option>
            <option value="fast">fast</option>
            <option value="ultra-fast">ultra-fast</option>
          </select>
        </div>
        <button
          type="submit"
          class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          :disabled="tavilySaving"
        >
          {{ tavilySaving ? '保存中...' : '保存 Tavily 配置' }}
        </button>
      </form>
    </div>

    <!-- Agent LLM 设置 -->
    <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <h2 class="mb-4 text-lg font-medium">Agent LLM 设置</h2>
      <p class="mb-4 text-sm text-zinc-400">文档摘要、对话摘要及默认模型，可在客户端选择覆盖</p>
      <div v-if="agentLoading" class="text-zinc-400">加载中...</div>
      <form v-else class="space-y-4 max-w-md" @submit.prevent="saveAgent">
        <div>
          <label class="mb-1 block text-sm text-zinc-400">默认对话模型</label>
          <select
            v-model="agentDefaultModel"
            class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
          >
            <option value="">默认（跟随 Provider）</option>
            <option v-for="m in agentModels" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <input v-model="docSummaryEnabled" type="checkbox" class="rounded border-zinc-600" />
          <label class="text-sm text-zinc-300">文档记忆</label>
        </div>
        <div v-if="docSummaryEnabled">
          <label class="mb-1 block text-sm text-zinc-400">最小字符数</label>
          <input
            v-model.number="docSummaryMinLen"
            type="number"
            min="100"
            max="10000"
            class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div class="flex items-center gap-2">
          <input v-model="convSummaryEnabled" type="checkbox" class="rounded border-zinc-600" />
          <label class="text-sm text-zinc-300">对话摘要（每 N 轮生成）</label>
        </div>
        <div v-if="convSummaryEnabled">
          <label class="mb-1 block text-sm text-zinc-400">对话摘要间隔</label>
          <input
            v-model.number="convSummaryInterval"
            type="number"
            min="2"
            class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          :disabled="agentSaving"
        >
          {{ agentSaving ? '保存中...' : '保存 Agent LLM 配置' }}
        </button>
      </form>
    </div>

    <!-- MCP 服务器 -->
    <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <h2 class="mb-4 text-lg font-medium">MCP 服务器</h2>
      <p class="mb-4 text-sm text-zinc-400">
        配置外部 MCP 服务器，Agent 对话时可调用其工具。支持 Streamable HTTP、SSE、stdio。
      </p>
      <div v-if="mcpLoading" class="text-zinc-400">加载中...</div>
      <div v-else-if="mcpError" class="text-red-400">{{ mcpError }}</div>
      <div v-else>
        <div class="mb-4 flex gap-2">
          <button
            class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            @click=";(mcpModalOpen = true), (editingMcp = null), void resetMcpForm()"
          >
            添加 MCP 服务器
          </button>
        </div>
        <div
          v-if="mcpServers.length === 0"
          class="rounded border border-dashed border-zinc-600 p-6 text-center text-zinc-500"
        >
          暂无 MCP 服务器
        </div>
        <div v-else class="space-y-3">
          <div
            v-for="s in mcpServers"
            :key="s.id"
            class="flex items-center justify-between rounded border border-zinc-600 bg-zinc-900/50 px-4 py-3"
          >
            <div>
              <span class="font-medium">{{ s.name }}</span>
              <span class="ml-2 font-mono text-xs text-zinc-500">{{ s.id }}</span>
              <span class="ml-2 text-xs text-zinc-500">{{ s.transport }}</span>
              <span
                v-if="s.headers && Object.keys(s.headers).length"
                class="ml-2 text-xs text-amber-400"
                >已配置鉴权</span
              >
              <span
                v-if="s.stdio?.env && Object.keys(s.stdio.env).length"
                class="ml-2 text-xs text-amber-400"
                >已配置 env</span
              >
            </div>
            <div class="flex gap-2">
              <button
                class="text-sm text-emerald-400 hover:text-emerald-300"
                @click="openEditMcp(s)"
              >
                编辑
              </button>
              <button class="text-sm text-red-400 hover:text-red-300" @click="deleteMcp(s.id)">
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- MCP 添加/编辑 Modal（简化版，完整功能建议用 Electron 客户端） -->
    <div
      v-if="mcpModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="mcpModalOpen = false"
    >
      <div
        class="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg border border-zinc-600 bg-zinc-800 p-6"
      >
        <h3 class="mb-4 text-lg font-medium">
          {{ editingMcp ? '编辑 MCP 服务器' : '添加 MCP 服务器' }}
        </h3>
        <p class="mb-4 text-sm text-zinc-400">
          完整配置（含 API Key、环境变量）建议使用 Electron 客户端。此处仅支持基础配置。
        </p>
        <form class="space-y-4" @submit.prevent="saveMcp">
          <div>
            <label class="mb-1 block text-sm text-zinc-400">ID</label>
            <input
              v-model="mcpForm.id"
              class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2"
              placeholder="github"
              :disabled="!!editingMcp"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm text-zinc-400">名称</label>
            <input
              v-model="mcpForm.name"
              class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2"
              placeholder="GitHub"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm text-zinc-400">传输类型</label>
            <select
              v-model="mcpForm.transport"
              class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2"
            >
              <option value="streamable-http">Streamable HTTP</option>
              <option value="sse">SSE</option>
              <option value="stdio">Stdio</option>
            </select>
          </div>
          <div v-if="mcpForm.transport !== 'stdio'">
            <label class="mb-1 block text-sm text-zinc-400">URL</label>
            <input
              v-model="mcpForm.url"
              class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2"
              placeholder="http://127.0.0.1:4127/mcp"
            />
          </div>
          <div v-if="mcpForm.transport === 'stdio'">
            <label class="mb-1 block text-sm text-zinc-400">命令</label>
            <input
              v-model="mcpForm.stdioCommand"
              class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2"
              placeholder="npx"
            />
          </div>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="rounded border border-zinc-600 px-4 py-2 text-sm hover:bg-zinc-700"
              @click="mcpModalOpen = false"
            >
              取消
            </button>
            <button
              type="submit"
              class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  getAgentTools,
  getAgentModels,
  updateAgentTools,
  updateTavilySettings,
  listMcpServers,
  addMcpServer,
  updateMcpServer,
  deleteMcpServer,
  type TavilySettings,
  type AgentToolsSettings
} from '../api/client'

const tavily = ref<TavilySettings | null>(null)
const tavilyLoading = ref(true)
const tavilySaving = ref(false)
const tavilyApiKeyInput = ref('')
const tavilyEnabled = ref(true)
const tavilyMaxResults = ref(5)
const tavilySearchDepth = ref<'basic' | 'advanced' | 'fast' | 'ultra-fast'>('basic')

const mcpServers = ref<NonNullable<AgentToolsSettings['mcpServers']>>([])
const mcpLoading = ref(true)
const mcpError = ref('')
const mcpModalOpen = ref(false)
const editingMcp = ref<NonNullable<AgentToolsSettings['mcpServers']>[0] | null>(null)
const mcpForm = ref({
  id: '',
  name: '',
  transport: 'streamable-http' as const,
  url: '',
  stdioCommand: '',
  enabled: true
})

const agentLoading = ref(true)
const agentSaving = ref(false)
const agentModels = ref<Array<{ id: string; label: string }>>([])
const agentDefaultModel = ref('')
const docSummaryEnabled = ref(true)
const docSummaryMinLen = ref(500)
const convSummaryEnabled = ref(true)
const convSummaryInterval = ref(10)
const convSummaryModel = ref('')

async function loadAgent() {
  agentLoading.value = true
  try {
    const [tools, modelsRes] = await Promise.all([getAgentTools(), getAgentModels()])
    agentModels.value = modelsRes.models ?? []
    agentDefaultModel.value = tools.agent?.defaultModel ?? ''
    docSummaryEnabled.value = tools.agent?.documentSummary?.enabled !== false
    docSummaryMinLen.value = tools.agent?.documentSummary?.minLen ?? 500
    convSummaryEnabled.value = tools.agent?.conversationSummary?.enabled !== false
    convSummaryInterval.value = tools.agent?.conversationSummary?.interval ?? 10
    convSummaryModel.value = tools.agent?.conversationSummary?.model ?? ''
  } finally {
    agentLoading.value = false
  }
}

async function saveAgent() {
  agentSaving.value = true
  try {
    await updateAgentTools({
      agent: {
        defaultModel: agentDefaultModel.value || undefined,
        documentSummary: {
          enabled: docSummaryEnabled.value,
          minLen: docSummaryMinLen.value
        },
        conversationSummary: {
          enabled: convSummaryEnabled.value,
          interval: convSummaryInterval.value,
          model: convSummaryModel.value || undefined
        }
      }
    })
    await loadAgent()
  } finally {
    agentSaving.value = false
  }
}

async function loadTavily() {
  tavilyLoading.value = true
  try {
    const data = await getAgentTools()
    tavily.value = data.builtin?.tavily ?? null
    tavilyEnabled.value = tavily.value?.enabled !== false
    tavilyMaxResults.value = tavily.value?.maxResults ?? 5
    tavilySearchDepth.value =
      (tavily.value?.searchDepth as typeof tavilySearchDepth.value) ?? 'basic'
    tavilyApiKeyInput.value = ''
  } catch {
    tavily.value = null
  } finally {
    tavilyLoading.value = false
  }
}

async function saveTavily() {
  tavilySaving.value = true
  try {
    await updateTavilySettings({
      enabled: tavilyEnabled.value,
      maxResults: tavilyMaxResults.value,
      searchDepth: tavilySearchDepth.value,
      ...(tavilyApiKeyInput.value.trim() && { apiKey: tavilyApiKeyInput.value.trim() })
    })
    tavilyApiKeyInput.value = ''
    await loadTavily()
  } finally {
    tavilySaving.value = false
  }
}

async function loadMcp() {
  mcpLoading.value = true
  mcpError.value = ''
  try {
    mcpServers.value = await listMcpServers()
  } catch (e) {
    mcpError.value = e instanceof Error ? e.message : String(e)
    mcpServers.value = []
  } finally {
    mcpLoading.value = false
  }
}

function resetMcpForm() {
  mcpForm.value = {
    id: '',
    name: '',
    transport: 'streamable-http',
    url: '',
    stdioCommand: '',
    enabled: true
  }
}

function openEditMcp(s: NonNullable<AgentToolsSettings['mcpServers']>[0]) {
  editingMcp.value = s
  mcpForm.value = {
    id: s.id,
    name: s.name,
    transport: s.transport as typeof mcpForm.value.transport,
    url: s.url ?? '',
    stdioCommand: s.stdio?.command ?? '',
    enabled: s.enabled
  }
  mcpModalOpen.value = true
}

async function saveMcp() {
  try {
    if (editingMcp.value) {
      await updateMcpServer(editingMcp.value.id, {
        name: mcpForm.value.name,
        transport: mcpForm.value.transport,
        url: mcpForm.value.transport !== 'stdio' ? mcpForm.value.url : undefined,
        stdio:
          mcpForm.value.transport === 'stdio' ? { command: mcpForm.value.stdioCommand } : undefined,
        enabled: mcpForm.value.enabled
      })
    } else {
      await addMcpServer({
        id: mcpForm.value.id,
        name: mcpForm.value.name,
        transport: mcpForm.value.transport,
        url: mcpForm.value.transport !== 'stdio' ? mcpForm.value.url : undefined,
        stdio:
          mcpForm.value.transport === 'stdio' ? { command: mcpForm.value.stdioCommand } : undefined,
        enabled: mcpForm.value.enabled
      })
    }
    mcpModalOpen.value = false
    await loadMcp()
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

async function deleteMcp(id: string) {
  if (!confirm('确定删除该 MCP 服务器？')) return
  try {
    await deleteMcpServer(id)
    await loadMcp()
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

onMounted(() => {
  loadTavily()
  loadAgent()
  loadMcp()
})
</script>
