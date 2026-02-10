<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">概览</h1>

    <div v-if="loading" class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <p class="text-zinc-400">加载中...</p>
    </div>

    <div v-else-if="error" class="rounded-lg border border-red-900/50 bg-red-950/30 p-6">
      <p class="text-red-400">{{ error }}</p>
    </div>

    <template v-else>
      <div class="grid gap-4 sm:grid-cols-2">
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
          <h2 class="mb-2 text-sm font-medium text-zinc-400">便签数量</h2>
          <p class="text-lg font-semibold text-zinc-100">{{ notesCount }}</p>
          <p class="mt-1 text-xs text-zinc-500">当前 Scope: {{ currentScope }}</p>
        </div>
        <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
          <h2 class="mb-2 text-sm font-medium text-zinc-400">Scope 数量</h2>
          <p class="text-lg font-semibold text-zinc-100">{{ scopesCount }}</p>
        </div>
        <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
          <h2 class="mb-2 text-sm font-medium text-zinc-400">已注册客户端</h2>
          <p class="text-lg font-semibold text-zinc-100">{{ clientsCount }}</p>
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
            管理便签
          </router-link>
          <router-link
            to="/smtc"
            class="rounded bg-zinc-600 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-500"
          >
            媒体控制
          </router-link>
          <router-link
            to="/notify"
            class="rounded bg-zinc-600 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-500"
          >
            发送通知
          </router-link>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { getHealth, getNotes, getClients } from '../api/client'
import { useScope } from '../composables/useScope'

const loading = ref(true)
const error = ref('')
const health = ref<{ status: string } | null>(null)
const notesCount = ref(0)
const scopesCount = ref(0)
const clientsCount = ref(0)
const { currentScope, scopes, loadScopes } = useScope()

async function load() {
  loading.value = true
  error.value = ''
  try {
    await loadScopes()
    const [healthRes, notesRes, clientsRes] = await Promise.all([
      getHealth(),
      getNotes(currentScope.value),
      getClients()
    ])
    health.value = healthRes
    notesCount.value = notesRes.notes?.length ?? 0
    scopesCount.value = scopes.value?.length ?? 0
    clientsCount.value = clientsRes.clients?.length ?? 0
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(currentScope, load)
</script>
