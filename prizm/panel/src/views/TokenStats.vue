<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">Token 统计</h1>
        <p class="mt-1 text-sm text-zinc-400">Scope: {{ currentScope }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <!-- Time Range -->
        <div class="flex rounded-lg border border-zinc-700 bg-zinc-800/50 p-0.5">
          <button
            v-for="r in timeRanges"
            :key="r.key"
            class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            :class="
              activeRange === r.key
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            "
            @click="setRange(r.key)"
          >
            {{ r.label }}
          </button>
        </div>
        <button
          class="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-200"
          @click="refresh"
        >
          刷新
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-4">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div v-for="i in 4" :key="i" class="animate-pulse rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-5">
          <div class="mb-3 h-3 w-16 rounded bg-zinc-700" />
          <div class="h-7 w-24 rounded bg-zinc-700" />
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="rounded-xl border border-red-900/50 bg-red-950/20 p-6">
      <p class="text-red-400">{{ error }}</p>
      <button class="mt-2 text-sm text-red-300 hover:text-red-200" @click="refresh">重试</button>
    </div>

    <!-- Content -->
    <template v-else-if="summary">
      <!-- KPI Cards -->
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="group relative overflow-hidden rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-5 transition hover:border-emerald-600/30">
          <div class="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-600/5 transition-all group-hover:bg-emerald-600/10" />
          <p class="text-xs font-medium tracking-wider text-zinc-500 uppercase">总 Token</p>
          <p class="mt-2 text-2xl font-bold tabular-nums text-zinc-100">{{ fmtNum(summary.totalTokens) }}</p>
          <p class="mt-1 text-xs text-zinc-500">{{ summary.count }} 次调用</p>
        </div>
        <div class="group relative overflow-hidden rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-5 transition hover:border-blue-600/30">
          <div class="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-blue-600/5 transition-all group-hover:bg-blue-600/10" />
          <p class="text-xs font-medium tracking-wider text-zinc-500 uppercase">输入 Token</p>
          <p class="mt-2 text-2xl font-bold tabular-nums text-blue-300">{{ fmtNum(summary.totalInputTokens) }}</p>
          <p class="mt-1 text-xs text-zinc-500">{{ inputPct }}%</p>
        </div>
        <div class="group relative overflow-hidden rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-5 transition hover:border-purple-600/30">
          <div class="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-purple-600/5 transition-all group-hover:bg-purple-600/10" />
          <p class="text-xs font-medium tracking-wider text-zinc-500 uppercase">输出 Token</p>
          <p class="mt-2 text-2xl font-bold tabular-nums text-purple-300">{{ fmtNum(summary.totalOutputTokens) }}</p>
          <p class="mt-1 text-xs text-zinc-500">{{ outputPct }}%</p>
        </div>
        <div class="group relative overflow-hidden rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-5 transition hover:border-amber-600/30">
          <div class="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-amber-600/5 transition-all group-hover:bg-amber-600/10" />
          <p class="text-xs font-medium tracking-wider text-zinc-500 uppercase">平均 Token/次</p>
          <p class="mt-2 text-2xl font-bold tabular-nums text-amber-300">{{ avgTokens }}</p>
          <p class="mt-1 text-xs text-zinc-500">每次 LLM 调用</p>
        </div>
        <div class="group relative overflow-hidden rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-5 transition hover:border-teal-600/30">
          <div class="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-teal-600/5 transition-all group-hover:bg-teal-600/10" />
          <p class="text-xs font-medium tracking-wider text-zinc-500 uppercase">缓存命中</p>
          <p class="mt-2 text-2xl font-bold tabular-nums text-teal-300">{{ fmtNum(summary.totalCachedInputTokens ?? 0) }}</p>
          <p class="mt-1 text-xs text-zinc-500">{{ cachePct }}% 输入命中缓存</p>
        </div>
      </div>

      <!-- Input/Output Ratio Bar -->
      <div class="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-5">
        <h2 class="mb-3 text-sm font-medium text-zinc-400">输入 / 输出占比</h2>
        <div class="flex h-6 overflow-hidden rounded-full bg-zinc-900">
          <div
            class="flex items-center justify-center text-xs font-medium text-white transition-all duration-500"
            :style="{ width: inputPct + '%', backgroundColor: '#3b82f6' }"
          >
            <span v-if="parseFloat(inputPct) > 12">输入 {{ inputPct }}%</span>
          </div>
          <div
            class="flex items-center justify-center text-xs font-medium text-white transition-all duration-500"
            :style="{ width: outputPct + '%', backgroundColor: '#a855f7' }"
          >
            <span v-if="parseFloat(outputPct) > 12">输出 {{ outputPct }}%</span>
          </div>
        </div>
        <div class="mt-2 flex justify-between text-xs text-zinc-500">
          <span class="flex items-center gap-1.5"><span class="inline-block h-2 w-2 rounded-full bg-blue-500" /> 输入 {{ fmtNum(summary.totalInputTokens) }}</span>
          <span v-if="(summary.totalCachedInputTokens ?? 0) > 0" class="flex items-center gap-1.5"><span class="inline-block h-2 w-2 rounded-full bg-teal-500" /> 缓存命中 {{ fmtNum(summary.totalCachedInputTokens ?? 0) }} ({{ cachePct }}%)</span>
          <span class="flex items-center gap-1.5"><span class="inline-block h-2 w-2 rounded-full bg-purple-500" /> 输出 {{ fmtNum(summary.totalOutputTokens) }}</span>
        </div>
      </div>

      <!-- Two columns: Category + Model -->
      <div class="grid gap-4 lg:grid-cols-2">
        <!-- By Category -->
        <div class="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-5">
          <h2 class="mb-4 text-sm font-medium text-zinc-400">按功能类别</h2>
          <div v-if="categoryEntries.length === 0" class="py-4 text-center text-sm text-zinc-500">暂无数据</div>
          <div v-else class="space-y-3">
            <div v-for="entry in categoryEntries" :key="entry.key" class="group">
              <div class="mb-1 flex items-center justify-between text-xs">
                <span class="flex items-center gap-2">
                  <span class="inline-block h-2.5 w-2.5 rounded-sm" :style="{ backgroundColor: entry.color }" />
                  <span class="text-zinc-300">{{ entry.label }}</span>
                </span>
                <span class="tabular-nums text-zinc-500">{{ fmtNum(entry.total) }} <span class="text-zinc-600">({{ entry.count }}次)</span></span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-zinc-900">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :style="{ width: entry.pct + '%', backgroundColor: entry.color }"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- By Model -->
        <div class="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-5">
          <h2 class="mb-4 text-sm font-medium text-zinc-400">按模型分布</h2>
          <div v-if="modelEntries.length === 0" class="py-4 text-center text-sm text-zinc-500">暂无数据</div>
          <div v-else class="space-y-3">
            <div v-for="entry in modelEntries" :key="entry.key" class="group">
              <div class="mb-1 flex items-center justify-between text-xs">
                <span class="flex items-center gap-2">
                  <span class="inline-block h-2.5 w-2.5 rounded-sm" :style="{ backgroundColor: entry.color }" />
                  <span class="text-zinc-300 font-mono">{{ entry.key }}</span>
                </span>
                <span class="tabular-nums text-zinc-500">{{ fmtNum(entry.total) }} <span class="text-zinc-600">({{ entry.count }}次)</span></span>
              </div>
              <div class="flex gap-0.5">
                <div
                  class="h-2 rounded-l-full transition-all duration-500"
                  :style="{ width: entry.inputPct + '%', backgroundColor: '#3b82f6' }"
                  :title="'输入: ' + fmtNum(entry.input)"
                />
                <div
                  class="h-2 rounded-r-full transition-all duration-500"
                  :style="{ width: entry.outputPct + '%', backgroundColor: '#a855f7' }"
                  :title="'输出: ' + fmtNum(entry.output)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- By Scope (if multiple scopes) -->
      <div v-if="scopeEntries.length > 1" class="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-5">
        <h2 class="mb-4 text-sm font-medium text-zinc-400">按 Scope 分布</h2>
        <div class="space-y-3">
          <div v-for="entry in scopeEntries" :key="entry.key">
            <div class="mb-1 flex items-center justify-between text-xs">
              <span class="text-zinc-300">{{ entry.key }}</span>
              <span class="tabular-nums text-zinc-500">{{ fmtNum(entry.total) }} <span class="text-zinc-600">({{ entry.count }}次)</span></span>
            </div>
            <div class="h-2 overflow-hidden rounded-full bg-zinc-900">
              <div
                class="h-full rounded-full bg-emerald-500 transition-all duration-500"
                :style="{ width: entry.pct + '%' }"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Records Table -->
      <div class="rounded-xl border border-zinc-700/50 bg-zinc-800/50">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-700/50 p-5 pb-4">
          <h2 class="text-sm font-medium text-zinc-400">调用记录</h2>
          <div class="flex flex-wrap items-center gap-2">
            <select
              v-model="filterCategory"
              class="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
              @change="refresh"
            >
              <option value="">全部类别</option>
              <option v-for="cat in allCategories" :key="cat.key" :value="cat.key">{{ cat.label }}</option>
            </select>
            <div class="flex items-center rounded-lg border border-zinc-700 bg-zinc-900">
              <button
                class="px-2.5 py-1.5 text-xs text-zinc-400 transition hover:text-zinc-200 disabled:opacity-30"
                :disabled="page <= 1"
                @click="page--; refresh()"
              >
                上一页
              </button>
              <span class="border-x border-zinc-700 px-3 py-1.5 text-xs tabular-nums text-zinc-400">
                {{ page }} / {{ totalPages }}
              </span>
              <button
                class="px-2.5 py-1.5 text-xs text-zinc-400 transition hover:text-zinc-200 disabled:opacity-30"
                :disabled="page >= totalPages"
                @click="page++; refresh()"
              >
                下一页
              </button>
            </div>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="border-b border-zinc-700/50 text-zinc-500">
                <th class="px-5 py-3 font-medium">时间</th>
                <th class="px-5 py-3 font-medium">类别</th>
                <th class="px-5 py-3 font-medium">模型</th>
                <th class="px-5 py-3 font-medium text-right">输入</th>
                <th class="px-5 py-3 font-medium text-right">缓存命中</th>
                <th class="px-5 py-3 font-medium text-right">输出</th>
                <th class="px-5 py-3 font-medium text-right">总计</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="records.length === 0">
                <td colspan="7" class="px-5 py-8 text-center text-zinc-500">暂无记录</td>
              </tr>
              <tr
                v-for="rec in records"
                :key="rec.id"
                class="border-b border-zinc-800/50 transition hover:bg-zinc-800/30"
              >
                <td class="whitespace-nowrap px-5 py-2.5 tabular-nums text-zinc-400">{{ fmtTime(rec.timestamp) }}</td>
                <td class="px-5 py-2.5">
                  <span
                    class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
                    :style="{
                      backgroundColor: getCategoryColor(rec.category) + '18',
                      color: getCategoryColor(rec.category)
                    }"
                  >
                    <span class="inline-block h-1.5 w-1.5 rounded-full" :style="{ backgroundColor: getCategoryColor(rec.category) }" />
                    {{ getCategoryLabel(rec.category) }}
                  </span>
                </td>
                <td class="px-5 py-2.5 font-mono text-zinc-400">{{ rec.model || '-' }}</td>
                <td class="px-5 py-2.5 text-right tabular-nums text-blue-400">{{ fmtNum(rec.inputTokens) }}</td>
                <td class="px-5 py-2.5 text-right tabular-nums text-teal-400">{{ rec.cachedInputTokens ? fmtNum(rec.cachedInputTokens) : '-' }}</td>
                <td class="px-5 py-2.5 text-right tabular-nums text-purple-400">{{ fmtNum(rec.outputTokens) }}</td>
                <td class="px-5 py-2.5 text-right tabular-nums font-medium text-zinc-200">{{ fmtNum(rec.totalTokens) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  getTokenUsage,
  type TokenUsageSummary,
  type TokenUsageRecord
} from '../api/client'
import {
  TOKEN_CATEGORY_LABELS,
  TOKEN_CATEGORY_COLORS,
  TOKEN_CATEGORY_ORDER,
  formatTokenCount,
  type TokenUsageCategory
} from '@prizm/shared'
import { useScope } from '../composables/useScope'

const { currentScope } = useScope()

const loading = ref(true)
const error = ref('')
const summary = ref<TokenUsageSummary | null>(null)
const records = ref<TokenUsageRecord[]>([])
const activeRange = ref<string>('30d')
const filterCategory = ref('')
const page = ref(1)
const PAGE_SIZE = 30

const timeRanges = [
  { key: 'today', label: '今天' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: 'all', label: '全部' }
]

const MODEL_COLORS = ['#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6']

function getTimeRange(): { from?: number; to?: number } {
  const now = Date.now()
  switch (activeRange.value) {
    case 'today': {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      return { from: start.getTime() }
    }
    case '7d':
      return { from: now - 7 * 86400_000 }
    case '30d':
      return { from: now - 30 * 86400_000 }
    default:
      return {}
  }
}

function setRange(key: string) {
  activeRange.value = key
  page.value = 1
  refresh()
}

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const range = getTimeRange()
    const res = await getTokenUsage({
      scope: currentScope.value,
      category: filterCategory.value || undefined,
      from: range.from,
      to: range.to,
      limit: PAGE_SIZE,
      offset: (page.value - 1) * PAGE_SIZE
    })
    summary.value = res.summary
    records.value = res.records
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

const inputPct = computed(() => {
  if (!summary.value || summary.value.totalTokens === 0) return '0'
  return ((summary.value.totalInputTokens / summary.value.totalTokens) * 100).toFixed(1)
})

const outputPct = computed(() => {
  if (!summary.value || summary.value.totalTokens === 0) return '0'
  return ((summary.value.totalOutputTokens / summary.value.totalTokens) * 100).toFixed(1)
})

const avgTokens = computed(() => {
  if (!summary.value || summary.value.count === 0) return '0'
  return fmtNum(Math.round(summary.value.totalTokens / summary.value.count))
})

const cachePct = computed(() => {
  if (!summary.value || summary.value.totalInputTokens === 0) return '0'
  return ((( summary.value.totalCachedInputTokens ?? 0) / summary.value.totalInputTokens) * 100).toFixed(1)
})

const totalPages = computed(() => {
  if (!summary.value || summary.value.count === 0) return 1
  return Math.ceil(summary.value.count / PAGE_SIZE)
})

const categoryEntries = computed(() => {
  if (!summary.value) return []
  const bc = summary.value.byCategory
  const maxTotal = Math.max(...Object.values(bc).map((v) => v.total), 1)
  const ordered = TOKEN_CATEGORY_ORDER.filter((k) => bc[k])
  const rest = Object.keys(bc).filter((k) => !ordered.includes(k as TokenUsageCategory))
  return [...ordered, ...rest].map((key) => {
    const stat = bc[key]
    return {
      key,
      label: TOKEN_CATEGORY_LABELS[key as TokenUsageCategory] ?? key,
      color: TOKEN_CATEGORY_COLORS[key as TokenUsageCategory] ?? '#6b7280',
      total: stat.total,
      input: stat.input,
      output: stat.output,
      count: stat.count,
      pct: ((stat.total / maxTotal) * 100).toFixed(1)
    }
  })
})

const modelEntries = computed(() => {
  if (!summary.value) return []
  const bm = summary.value.byModel
  const entries = Object.entries(bm).sort((a, b) => b[1].total - a[1].total)
  const maxTotal = Math.max(...entries.map(([, v]) => v.total), 1)
  return entries.map(([key, stat], i) => ({
    key,
    color: MODEL_COLORS[i % MODEL_COLORS.length],
    total: stat.total,
    input: stat.input,
    output: stat.output,
    count: stat.count,
    inputPct: ((stat.input / maxTotal) * 100).toFixed(1),
    outputPct: ((stat.output / maxTotal) * 100).toFixed(1)
  }))
})

const scopeEntries = computed(() => {
  if (!summary.value) return []
  const bs = summary.value.byDataScope
  const entries = Object.entries(bs).sort((a, b) => b[1].total - a[1].total)
  const maxTotal = Math.max(...entries.map(([, v]) => v.total), 1)
  return entries.map(([key, stat]) => ({
    key,
    total: stat.total,
    count: stat.count,
    pct: ((stat.total / maxTotal) * 100).toFixed(1)
  }))
})

const allCategories = computed(() =>
  TOKEN_CATEGORY_ORDER.map((k) => ({
    key: k,
    label: TOKEN_CATEGORY_LABELS[k] ?? k
  }))
)

function fmtNum(n: number): string {
  return formatTokenCount(n)
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getCategoryLabel(cat: string): string {
  return TOKEN_CATEGORY_LABELS[cat as TokenUsageCategory] ?? cat
}

function getCategoryColor(cat: string): string {
  return TOKEN_CATEGORY_COLORS[cat as TokenUsageCategory] ?? '#6b7280'
}

onMounted(refresh)
watch(currentScope, () => {
  page.value = 1
  refresh()
})
</script>
