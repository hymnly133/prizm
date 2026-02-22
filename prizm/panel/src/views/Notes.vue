<template>
  <div class="space-y-6">
    <p class="rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2 text-sm text-zinc-400">
      本页可查看与应急管理便签；日常编辑推荐使用 Electron 客户端。
    </p>
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">便签 (Scope: {{ currentScope }})</h1>
      <button
        class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        @click="showCreate = true"
      >
        新建便签
      </button>
    </div>

    <div v-if="loading" class="text-zinc-400">加载中...</div>
    <div v-else-if="error" class="rounded bg-red-950/30 p-4 text-red-400">
      {{ error }}
    </div>

    <div v-else class="space-y-4">
      <div
        v-for="note in notes"
        :key="note.id"
        class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <p class="whitespace-pre-wrap text-zinc-100">
              {{ note.content || '(无内容)' }}
            </p>
            <p class="mt-2 text-xs text-zinc-500">更新于 {{ formatDate(note.updatedAt) }}</p>
          </div>
          <div class="flex gap-2">
            <button
              class="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
              @click="editNote(note)"
            >
              编辑
            </button>
            <button
              class="rounded px-2 py-1 text-sm text-red-400 hover:bg-red-950/30"
              @click="confirmDelete(note)"
            >
              删除
            </button>
          </div>
        </div>
      </div>
      <p v-if="notes.length === 0" class="text-zinc-500">暂无便签</p>
    </div>

    <!-- Create/Edit Modal -->
    <div
      v-if="showCreate || editing"
      class="fixed inset-0 z-10 flex items-center justify-center bg-black/60"
      @click.self="closeModal"
    >
      <div class="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-800 p-6">
        <h2 class="mb-4 text-lg font-semibold">
          {{ editing ? '编辑便签' : '新建便签' }}
        </h2>
        <textarea
          v-model="formContent"
          class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
          rows="5"
          placeholder="便签内容..."
        />
        <div class="mt-4 flex justify-end gap-2">
          <button class="rounded px-4 py-2 text-zinc-400 hover:bg-zinc-700" @click="closeModal">
            取消
          </button>
          <button
            class="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500"
            @click="saveNote"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import {
  getNotes,
  createNote,
  updateNote,
  deleteNote,
  type StickyNote,
  type CreateNotePayload
} from '../api/client'
import { useScope } from '../composables/useScope'

const { currentScope } = useScope()
const notes = ref<StickyNote[]>([])
const loading = ref(true)
const error = ref('')
const showCreate = ref(false)
const editing = ref<StickyNote | null>(null)
const formContent = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await getNotes(currentScope.value)
    notes.value = res.notes ?? []
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString('zh-CN')
}

function editNote(note: StickyNote) {
  editing.value = note
  formContent.value = note.content
}

function closeModal() {
  showCreate.value = false
  editing.value = null
  formContent.value = ''
}

async function saveNote() {
  const content = formContent.value.trim()
  const scope = currentScope.value
  try {
    if (editing.value) {
      await updateNote(editing.value.id, { content }, scope)
    } else {
      await createNote({ content } as CreateNotePayload, scope)
    }
    closeModal()
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function confirmDelete(note: StickyNote) {
  if (!confirm('确定删除这条便签？')) return
  try {
    await deleteNote(note.id, currentScope.value)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

onMounted(load)
watch(currentScope, load)
</script>
