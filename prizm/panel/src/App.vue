<template>
  <div class="min-h-screen bg-zinc-900 text-zinc-100">
    <nav class="border-b border-zinc-700 bg-zinc-800/50 px-4 py-3">
      <div class="mx-auto flex max-w-4xl flex-wrap items-center gap-4">
        <router-link to="/" class="flex flex-col items-baseline gap-0.5">
          <span class="text-lg font-semibold text-emerald-400">Prizm 控制台</span>
          <span class="text-xs font-normal text-zinc-500">全面数据呈现与系统配置</span>
        </router-link>
        <div class="flex flex-1 flex-wrap items-center gap-4">
          <template v-for="(item, i) in navData" :key="item.path">
            <span v-if="i > 0" class="text-zinc-600">|</span>
            <router-link
              :to="item.path"
              class="text-zinc-400 transition hover:text-zinc-100"
              active-class="text-emerald-400"
            >
              {{ item.label }}
            </router-link>
          </template>
          <span class="ml-2 text-zinc-600">|</span>
          <template v-for="(item, i) in navSystem" :key="item.path">
            <span v-if="i > 0" class="text-zinc-600">|</span>
            <router-link
              :to="item.path"
              class="text-zinc-400 transition hover:text-zinc-100"
              active-class="text-emerald-400"
            >
              {{ item.label }}
            </router-link>
          </template>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm text-zinc-500">Scope:</span>
          <select
            :value="currentScope"
            class="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
            :title="scopeDescriptions[currentScope]?.description"
            @change="onScopeChange"
          >
            <option
              v-for="s in scopes"
              :key="s"
              :value="s"
              :title="scopeDescriptions[s]?.description"
            >
              {{ getScopeLabel(s) }} ({{ s }})
            </option>
          </select>
          <input
            v-model="newScopeInput"
            type="text"
            class="w-24 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
            placeholder="新建 scope"
            @keyup.enter="addNewScope"
          />
        </div>
      </div>
    </nav>
    <main class="mx-auto max-w-4xl px-4 py-8">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useScope } from './composables/useScope'

const navData = [
  { path: '/', label: '概览' },
  { path: '/notes', label: '便签' },
  { path: '/todo', label: '任务' },
  { path: '/documents', label: '文档' },
  { path: '/clipboard', label: '剪贴板' },
  { path: '/agent', label: 'Agent' },
  { path: '/token-stats', label: 'Token 统计' }
]
const navSystem = [
  { path: '/permissions', label: '权限管理' },
  { path: '/audit', label: '审计' },
  { path: '/settings', label: '设置' },
  { path: '/notify', label: '通知' }
]
const navItems = [...navData, ...navSystem]

const { currentScope, scopes, scopeDescriptions, getScopeLabel, setScope, loadScopes } = useScope()
const newScopeInput = ref('')

function onScopeChange(e: Event) {
  const target = e.target as HTMLSelectElement
  if (target.value) setScope(target.value)
}

function addNewScope() {
  const name = newScopeInput.value.trim()
  if (!name) return
  setScope(name)
  newScopeInput.value = ''
}

onMounted(loadScopes)
</script>
