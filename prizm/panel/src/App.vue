<template>
  <div class="min-h-screen bg-zinc-900 text-zinc-100">
    <nav class="border-b border-zinc-700 bg-zinc-800/50 px-4 py-3">
      <div class="mx-auto flex max-w-4xl flex-wrap items-center gap-4">
        <router-link to="/" class="text-lg font-semibold text-emerald-400">
          Prizm Dashboard
        </router-link>
        <div class="flex flex-1 flex-wrap gap-4">
          <router-link
            v-for="item in navItems"
            :key="item.path"
            :to="item.path"
            class="text-zinc-400 transition hover:text-zinc-100"
            active-class="text-emerald-400"
          >
            {{ item.label }}
          </router-link>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm text-zinc-500">Scope:</span>
          <select
            :value="currentScope"
            class="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
            @change="onScopeChange"
          >
            <option v-for="s in scopes" :key="s" :value="s">{{ s }}</option>
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

const navItems = [
  { path: '/', label: '概览' },
  { path: '/permissions', label: '权限管理' },
  { path: '/notes', label: '便签' },
  { path: '/notify', label: '通知' }
]

const { currentScope, scopes, setScope, loadScopes } = useScope()
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
