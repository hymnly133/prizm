<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold">审计与资源锁</h1>
      <p class="mt-1 text-sm text-zinc-500">
        Agent 操作审计日志与当前 Scope 下的资源锁；强制释放可用于异常断开会话后的清理。
      </p>
    </div>

    <div class="flex items-center gap-2">
      <span class="text-sm text-zinc-500">Scope:</span>
      <select
        :value="currentScope"
        class="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-sm text-zinc-100"
        @change="onScopeChange"
      >
        <option v-for="s in scopes" :key="s" :value="s">{{ s }}</option>
      </select>
    </div>

    <!-- 资源锁 -->
    <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <h2 class="mb-3 text-lg font-medium text-zinc-200">当前资源锁</h2>
      <div v-if="locksLoading" class="text-zinc-400">加载中...</div>
      <div v-else-if="locksError" class="text-red-400">{{ locksError }}</div>
      <div v-else-if="locks.length === 0" class="text-zinc-500">当前 Scope 无活跃锁</div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-zinc-600 text-left text-zinc-400">
              <th class="pb-2 pr-4">资源类型</th>
              <th class="pb-2 pr-4">资源 ID</th>
              <th class="pb-2 pr-4">会话 ID</th>
              <th class="pb-2 pr-4">获取时间</th>
              <th class="pb-2 pr-4">TTL</th>
              <th class="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="lock in locks"
              :key="lock.id"
              class="border-b border-zinc-700/50 text-zinc-300"
            >
              <td class="py-2 pr-4">{{ lock.resourceType }}</td>
              <td class="py-2 pr-4 font-mono text-xs">{{ lock.resourceId.slice(0, 12) }}…</td>
              <td class="py-2 pr-4 font-mono text-xs">{{ lock.sessionId.slice(0, 8) }}…</td>
              <td class="py-2 pr-4">{{ formatTime(lock.acquiredAt) }}</td>
              <td class="py-2 pr-4">{{ Math.round(lock.ttlMs / 1000) }}s</td>
              <td class="py-2">
                <button
                  class="text-red-400 hover:text-red-300"
                  @click="forceRelease(lock)"
                >
                  强制释放
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 审计日志 -->
    <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <h2 class="mb-3 text-lg font-medium text-zinc-200">审计日志</h2>
      <div class="mb-4 flex flex-wrap gap-3">
        <select
          v-model="auditResourceType"
          class="rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
        >
          <option value="">全部类型</option>
          <option value="document">document</option>
          <option value="todo_list">todo_list</option>
          <option value="note">note</option>
          <option value="memory">memory</option>
          <option value="session">session</option>
        </select>
        <input
          v-model="auditSessionId"
          type="text"
          class="w-40 rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 placeholder-zinc-500"
          placeholder="会话 ID"
        />
        <select
          v-model="auditLimit"
          class="rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
        >
          <option :value="50">50 条</option>
          <option :value="100">100 条</option>
          <option :value="200">200 条</option>
        </select>
        <button
          class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-500"
          @click="loadAudit"
        >
          查询
        </button>
      </div>
      <div v-if="auditLoading" class="text-zinc-400">加载中...</div>
      <div v-else-if="auditError" class="text-red-400">{{ auditError }}</div>
      <div v-else-if="auditEntries.length === 0" class="text-zinc-500">暂无审计记录</div>
      <div v-else class="max-h-96 overflow-auto">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-zinc-800">
            <tr class="border-b border-zinc-600 text-left text-zinc-400">
              <th class="pb-2 pr-2">时间</th>
              <th class="pb-2 pr-2">操作者</th>
              <th class="pb-2 pr-2">工具/动作</th>
              <th class="pb-2 pr-2">资源</th>
              <th class="pb-2 pr-2">结果</th>
              <th class="pb-2">详情</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="e in auditEntries"
              :key="e.id"
              class="border-b border-zinc-700/50 text-zinc-300"
            >
              <td class="whitespace-nowrap py-1 pr-2 text-xs">{{ formatTime(e.timestamp) }}</td>
              <td class="py-1 pr-2">
                <span class="text-zinc-500">{{ e.actorType }}</span>
                <span v-if="e.sessionId" class="ml-1 font-mono text-xs">{{ e.sessionId.slice(0, 6) }}…</span>
              </td>
              <td class="py-1 pr-2">{{ e.toolName }} / {{ e.action }}</td>
              <td class="py-1 pr-2">
                <span v-if="e.resourceType" class="text-zinc-400">{{ e.resourceType }}</span>
                <span v-if="e.resourceId" class="ml-1 font-mono text-xs">{{ e.resourceId.slice(0, 8) }}…</span>
              </td>
              <td class="py-1 pr-2">
                <span
                  :class="
                    e.result === 'success'
                      ? 'text-emerald-400'
                      : e.result === 'error'
                        ? 'text-red-400'
                        : 'text-amber-400'
                  "
                >
                  {{ e.result }}
                </span>
              </td>
              <td class="max-w-xs truncate py-1 text-xs text-zinc-500" :title="e.detail ?? e.errorMessage">
                {{ e.detail ?? e.errorMessage ?? '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { getAudit, getLocks, forceReleaseLock, type AuditEntry, type ResourceLock } from '../api/client'
import { useScope } from '../composables/useScope'

const { currentScope, scopes, loadScopes, setScope } = useScope()

const locks = ref<ResourceLock[]>([])
const locksLoading = ref(false)
const locksError = ref('')

const auditEntries = ref<AuditEntry[]>([])
const auditLoading = ref(false)
const auditError = ref('')
const auditResourceType = ref('')
const auditSessionId = ref('')
const auditLimit = ref(100)

function formatTime(ms: number) {
  const d = new Date(ms)
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function onScopeChange(e: Event) {
  const target = e.target as HTMLSelectElement
  if (target.value) setScope(target.value)
}

async function loadLocks() {
  locksLoading.value = true
  locksError.value = ''
  try {
    locks.value = await getLocks(currentScope.value)
  } catch (e) {
    locksError.value = e instanceof Error ? e.message : String(e)
    locks.value = []
  } finally {
    locksLoading.value = false
  }
}

async function forceRelease(lock: ResourceLock) {
  if (!confirm(`确定强制释放 ${lock.resourceType}/${lock.resourceId}？`)) return
  try {
    await forceReleaseLock(lock.resourceType, lock.resourceId, currentScope.value)
    await loadLocks()
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

async function loadAudit() {
  auditLoading.value = true
  auditError.value = ''
  try {
    const res = await getAudit({
      scope: currentScope.value,
      resourceType: auditResourceType.value || undefined,
      sessionId: auditSessionId.value.trim() || undefined,
      limit: auditLimit.value
    })
    auditEntries.value = res.entries ?? []
  } catch (e) {
    auditError.value = e instanceof Error ? e.message : String(e)
    auditEntries.value = []
  } finally {
    auditLoading.value = false
  }
}

onMounted(() => {
  loadScopes()
  loadLocks()
  loadAudit()
})
watch(currentScope, () => {
  loadLocks()
  loadAudit()
})
</script>
