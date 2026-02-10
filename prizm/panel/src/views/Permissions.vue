<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">权限管理</h1>
      <button
        type="button"
        class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        @click="showRegister = true"
      >
        注册客户端
      </button>
    </div>

    <p class="text-sm text-zinc-400">
      管理已注册的客户端及 API Key，吊销后该客户端将无法访问 API。
    </p>

    <div v-if="loading" class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <p class="text-zinc-400">加载中...</p>
    </div>

    <div v-else-if="listError" class="rounded-lg border border-red-900/50 bg-red-950/30 p-6">
      <p class="text-red-400">{{ listError }}</p>
    </div>

    <div
      v-else-if="clients.length === 0"
      class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6"
    >
      <p class="text-zinc-400">暂无已注册客户端，点击「注册客户端」创建。</p>
    </div>

    <div v-else class="overflow-hidden rounded-lg border border-zinc-700">
      <table class="w-full">
        <thead class="bg-zinc-800/80">
          <tr>
            <th class="px-4 py-3 text-left text-sm font-medium text-zinc-400">名称</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-zinc-400">Client ID</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-zinc-400">权限 Scope</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-zinc-400">创建时间</th>
            <th class="px-4 py-3 text-right text-sm font-medium text-zinc-400">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-700">
          <tr v-for="c in clients" :key="c.clientId" class="hover:bg-zinc-800/50">
            <td class="px-4 py-3 font-medium">{{ c.name }}</td>
            <td class="px-4 py-3 font-mono text-sm text-zinc-400">{{ c.clientId }}</td>
            <td class="px-4 py-3 text-sm text-zinc-400">
              {{ c.allowedScopes?.join(', ') ?? '-' }}
            </td>
            <td class="px-4 py-3 text-sm text-zinc-400">{{ formatTime(c.createdAt) }}</td>
            <td class="px-4 py-3 text-right">
              <button
                type="button"
                class="text-red-400 hover:text-red-300"
                :disabled="revoking === c.clientId"
                @click="revokeClient(c)"
              >
                {{ revoking === c.clientId ? '吊销中...' : '吊销' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 注册弹窗 -->
    <Teleport to="body">
      <div
        v-if="showRegister"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        @click.self="showRegister = false"
      >
        <div
          class="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-xl"
          @click.stop
        >
          <h2 class="mb-4 text-lg font-semibold">注册新客户端</h2>
          <form class="space-y-4" @submit.prevent="doRegister">
            <div>
              <label class="mb-1 block text-sm text-zinc-400">名称</label>
              <input
                v-model="regName"
                type="text"
                class="w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
                placeholder="例如：Sapphire Next"
                required
              />
            </div>
            <div>
              <label class="mb-1 block text-sm text-zinc-400"
                >Scope（可选，逗号分隔；* 表示全部权限）</label
              >
              <input
                v-model="regScopes"
                type="text"
                class="w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
                placeholder="default 或 default, notes 或 *"
              />
            </div>
            <p v-if="regError" class="text-sm text-red-400">{{ regError }}</p>
            <p
              v-if="newApiKey"
              class="rounded border border-emerald-700 bg-emerald-950/50 p-3 text-sm text-emerald-300"
            >
              <strong>API Key（仅展示一次，请妥善保存）：</strong>
              <code class="mt-1 block break-all font-mono">{{ newApiKey }}</code>
            </p>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="rounded border border-zinc-600 px-4 py-2 text-sm hover:bg-zinc-800"
                @click="closeRegister"
              >
                {{ newApiKey ? '完成' : '取消' }}
              </button>
              <button
                v-if="!newApiKey"
                type="submit"
                class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                :disabled="regLoading"
              >
                {{ regLoading ? '注册中...' : '注册' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getClients, revokeClientById, registerClient, type ClientInfo } from '../api/client'

const loading = ref(true)
const listError = ref('')
const clients = ref<ClientInfo[]>([])
const revoking = ref<string | null>(null)

const showRegister = ref(false)
const regName = ref('')
const regScopes = ref('')
const regError = ref('')
const regLoading = ref(false)
const newApiKey = ref('')

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN')
}

async function loadClients() {
  loading.value = true
  listError.value = ''
  try {
    const res = await getClients()
    clients.value = res.clients ?? []
  } catch (e) {
    listError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function revokeClient(c: ClientInfo) {
  if (!confirm(`确定要吊销客户端「${c.name}」吗？该客户端将无法再访问 API。`)) return
  revoking.value = c.clientId
  try {
    await revokeClientById(c.clientId)
    await loadClients()
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  } finally {
    revoking.value = null
  }
}

async function doRegister() {
  regError.value = ''
  regLoading.value = true
  try {
    const scopes = regScopes.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const result = await registerClient(regName.value.trim(), scopes.length ? scopes : undefined)
    newApiKey.value = result.apiKey
    await loadClients()
  } catch (e) {
    regError.value = e instanceof Error ? e.message : String(e)
  } finally {
    regLoading.value = false
  }
}

function closeRegister() {
  showRegister.value = false
  regName.value = ''
  regScopes.value = ''
  regError.value = ''
  newApiKey.value = ''
}

onMounted(loadClients)
</script>
