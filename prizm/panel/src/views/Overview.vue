<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold">系统概览</h1>
      <p class="mt-1 text-sm text-zinc-500">
        本控制台用于查看全量数据与配置；日常使用推荐使用 Electron 客户端进行便签、文档、Agent 等操作。
      </p>
    </div>

    <div v-if="loading" class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <p class="text-zinc-400">加载中...</p>
    </div>

    <div v-else-if="error" class="rounded-lg border border-red-900/50 bg-red-950/30 p-6">
      <p class="text-red-400">{{ error }}</p>
    </div>

    <template v-else>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
          <h2 class="mb-2 text-sm font-medium text-zinc-400">服务状态</h2>
          <p
            class="text-lg font-semibold"
            :class="health?.status === 'ok' ? 'text-emerald-400' : 'text-red-400'"
          >
            {{ health?.status === 'ok' ? '正常运行' : '异常' }}
          </p>
        </div>
        <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
          <h2 class="mb-2 text-sm font-medium text-zinc-400">便签</h2>
          <p class="text-lg font-semibold text-zinc-100">{{ notesCount }}</p>
          <p class="mt-1 text-xs text-zinc-500">Scope: {{ currentScope }}</p>
        </div>
        <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
          <h2 class="mb-2 text-sm font-medium text-zinc-400">TODO</h2>
          <p class="text-lg font-semibold text-zinc-100">{{ todoItemsCount }}</p>
        </div>
        <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
          <h2 class="mb-2 text-sm font-medium text-zinc-400">文档</h2>
          <p class="text-lg font-semibold text-zinc-100">
            {{ documentsCount }}
          </p>
        </div>
        <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
          <h2 class="mb-2 text-sm font-medium text-zinc-400">Agent 会话</h2>
          <p class="text-lg font-semibold text-zinc-100">
            {{ agentSessionsCount }}
          </p>
        </div>
        <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
          <h2 class="mb-2 text-sm font-medium text-zinc-400">Scope 数量</h2>
          <p class="text-lg font-semibold text-zinc-100">{{ scopesCount }}</p>
        </div>
        <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
          <h2 class="mb-2 text-sm font-medium text-zinc-400">已注册客户端</h2>
          <p class="text-lg font-semibold text-zinc-100">{{ clientsCount }}</p>
        </div>
        <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
          <h2 class="mb-2 text-sm font-medium text-zinc-400">Token 用量</h2>
          <p class="text-lg font-semibold text-zinc-100">{{ tokenTotalDisplay }}</p>
          <p class="mt-1 text-xs text-zinc-500">{{ tokenCallsDisplay }} 次 LLM 调用</p>
        </div>
      </div>

      <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
        <h2 class="mb-2 text-sm font-medium text-zinc-400">快速入口</h2>
        <div class="flex flex-wrap gap-3">
          <router-link
            to="/permissions"
            class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            权限管理
          </router-link>
          <router-link
            to="/notes"
            class="rounded bg-zinc-600 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-500"
          >
            便签
          </router-link>
          <router-link
            to="/todo"
            class="rounded bg-zinc-600 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-500"
          >
            TODO
          </router-link>
          <router-link
            to="/documents"
            class="rounded bg-zinc-600 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-500"
          >
            文档
          </router-link>
          <router-link
            to="/agent"
            class="rounded bg-zinc-600 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-500"
          >
            Agent
          </router-link>
          <router-link
            to="/token-stats"
            class="rounded bg-zinc-600 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-500"
          >
            Token 统计
          </router-link>
          <router-link
            to="/audit"
            class="rounded bg-zinc-600 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-500"
          >
            审计
          </router-link>
          <router-link
            to="/notify"
            class="rounded bg-zinc-600 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-500"
          >
            通知
          </router-link>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import {
  getHealth,
  getNotes,
  getClients,
  getTodoLists,
  getDocuments,
  listAgentSessions,
  getTokenUsage
} from '../api/client'
import type { TodoList } from '@prizm/shared'
import { formatTokenCount } from '@prizm/shared'
import { useScope } from '../composables/useScope'

const loading = ref(true)
const error = ref('')
const health = ref<{ status: string } | null>(null)
const notesCount = ref(0)
const todoItemsCount = ref(0)
const documentsCount = ref(0)
const agentSessionsCount = ref(0)
const scopesCount = ref(0)
const clientsCount = ref(0)
const tokenTotalDisplay = ref('0')
const tokenCallsDisplay = ref('0')
const { currentScope, scopes, loadScopes } = useScope()

async function load() {
  loading.value = true
  error.value = ''
  try {
    await loadScopes()
    const scope = currentScope.value
    const [healthRes, notesRes, clientsRes, todoRes, docsRes, sessionsRes, tokenRes] =
      await Promise.all([
        getHealth(),
        getNotes(scope),
        getClients(),
        getTodoLists(scope).catch(() => []),
        getDocuments(scope).catch(() => ({ documents: [] })),
        listAgentSessions(scope).catch(() => ({ sessions: [] })),
        getTokenUsage({ scope, limit: 0 }).catch(() => ({
          records: [],
          summary: { totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0, count: 0, byCategory: {}, byDataScope: {}, byModel: {} }
        }))
      ])
    health.value = healthRes
    notesCount.value = notesRes.notes?.length ?? 0
    todoItemsCount.value = (todoRes as TodoList[]).reduce((n, l) => n + (l.items?.length ?? 0), 0)
    documentsCount.value = docsRes.documents?.length ?? 0
    agentSessionsCount.value = sessionsRes.sessions?.length ?? 0
    scopesCount.value = scopes.value?.length ?? 0
    clientsCount.value = clientsRes.clients?.length ?? 0
    tokenTotalDisplay.value = formatTokenCount(tokenRes.summary.totalTokens)
    tokenCallsDisplay.value = String(tokenRes.summary.count)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(currentScope, load)
</script>
