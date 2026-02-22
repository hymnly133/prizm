<template>
  <div class="space-y-6">
    <p class="rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2 text-sm text-zinc-400">
      本页可查看与应急管理任务；日常使用推荐使用 Electron 客户端。
    </p>
    <div class="flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold">TODO 列表 (Scope: {{ currentScope }})</h1>
      <div class="flex flex-wrap items-center gap-3">
        <button
          class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          @click="showEdit = true"
        >
          {{ selectedList ? '编辑列表' : '新建列表' }}
        </button>
        <button
          v-if="selectedList"
          class="rounded bg-red-600/80 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
          @click="confirmDeleteList"
        >
          删除列表
        </button>
      </div>
    </div>

    <!-- 列表切换 -->
    <div v-if="todoLists.length > 1" class="flex flex-wrap gap-2">
      <button
        v-for="list in todoLists"
        :key="list.id"
        :class="[
          'rounded px-3 py-1.5 text-sm',
          selectedList?.id === list.id
            ? 'bg-emerald-600/80 text-white'
            : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
        ]"
        @click="selectList(list.id)"
      >
        {{ list.title || '待办' }} ({{ list.items?.length ?? 0 }})
      </button>
    </div>

    <div v-if="loading" class="text-zinc-400">加载中...</div>
    <div v-else-if="error" class="rounded bg-red-950/30 p-4 text-red-400">
      {{ error }}
    </div>

    <div v-else class="space-y-4">
      <div v-if="selectedList" class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
        <h2 class="mb-4 font-medium text-zinc-100">{{ selectedList.title }}</h2>
        <p class="mb-2 text-xs text-zinc-500">更新于 {{ formatDate(selectedList.updatedAt) }}</p>
        <ul class="space-y-2">
          <li
            v-for="item in selectedList.items"
            :key="item.id"
            class="flex items-start gap-2 rounded border border-zinc-600/50 bg-zinc-900/50 px-3 py-2"
          >
            <span class="flex-1">
              <span class="text-zinc-100">{{ item.title }}</span>
              <p v-if="item.description" class="mt-1 text-sm text-zinc-400">
                {{ item.description }}
              </p>
            </span>
            <select
              :value="item.status"
              class="rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
              @change="(e) => setItemStatus(item.id, (e.target as HTMLSelectElement).value)"
            >
              <option value="todo">待办</option>
              <option value="doing">进行中</option>
              <option value="done">已完成</option>
            </select>
            <button
              class="rounded px-2 py-0.5 text-xs text-zinc-400 hover:bg-red-600/30 hover:text-red-400"
              title="删除"
              @click="deleteItem(item.id)"
            >
              ×
            </button>
          </li>
        </ul>
        <p v-if="selectedList.items.length === 0" class="text-zinc-500">暂无 TODO 项</p>
      </div>
      <p v-else class="text-zinc-500">暂无 TODO 列表，点击「新建列表」创建</p>
    </div>

    <!-- Edit Modal -->
    <div
      v-if="showEdit"
      class="fixed inset-0 z-10 flex items-center justify-center bg-black/60"
      @click.self="closeModal"
    >
      <div
        class="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800 p-6"
      >
        <h2 class="mb-4 text-lg font-semibold">
          {{ selectedList ? '编辑 TODO 列表' : '新建 TODO 列表' }}
        </h2>
        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-sm text-zinc-400">列表标题 *</label>
            <input
              v-model="formTitle"
              type="text"
              class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
              placeholder="待办"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm text-zinc-400"
              >TODO 项（每行一个，复杂任务可加「: 描述」）</label
            >
            <textarea
              v-model="formItemsText"
              class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
              rows="8"
              placeholder="任务1&#10;任务2: 需要额外说明时写描述&#10;任务3"
            />
          </div>
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <button class="rounded px-4 py-2 text-zinc-400 hover:bg-zinc-700" @click="closeModal">
            取消
          </button>
          <button
            class="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500"
            @click="saveList"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  getTodoLists,
  createTodoList,
  updateTodoListTitle,
  replaceTodoItems,
  updateTodoItem,
  deleteTodoItem,
  deleteTodoList,
  type TodoList,
  type TodoItem
} from '../api/client'
import { useScope } from '../composables/useScope'

const { currentScope } = useScope()
const todoLists = ref<TodoList[]>([])
const selectedListId = ref<string | null>(null)
const loading = ref(true)
const error = ref('')
const showEdit = ref(false)
const formTitle = ref('')
const formItemsText = ref('')

const selectedList = computed(() => {
  if (!selectedListId.value) return null
  return todoLists.value.find((l) => l.id === selectedListId.value) ?? null
})

function selectList(id: string) {
  selectedListId.value = id
}

function parseItemsText(text: string): Array<Partial<TodoItem> & { title: string }> {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colonIdx = line.indexOf(': ')
      if (colonIdx > 0) {
        return {
          title: line.slice(0, colonIdx).trim(),
          description: line.slice(colonIdx + 2).trim()
        }
      }
      return { title: line }
    })
}

function itemsToText(items: TodoItem[]): string {
  return items
    .map((it) => (it.description ? `${it.title}: ${it.description}` : it.title))
    .join('\n')
}

async function setItemStatus(itemId: string, status: string) {
  if (!['todo', 'doing', 'done'].includes(status) || !selectedListId.value) return
  try {
    await updateTodoItem(itemId, { status }, currentScope.value)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function deleteItem(itemId: string) {
  if (!confirm('确定删除该任务？')) return
  try {
    await deleteTodoItem(itemId, currentScope.value)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function confirmDeleteList() {
  if (!selectedListId.value || !confirm('确定删除整个 TODO 列表？此操作不可恢复。')) return
  try {
    await deleteTodoList(currentScope.value, selectedListId.value)
    selectedListId.value = null
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const lists = await getTodoLists(currentScope.value)
    todoLists.value = lists
    if (
      lists.length > 0 &&
      (!selectedListId.value || !lists.some((l) => l.id === selectedListId.value))
    ) {
      selectedListId.value = lists[0].id
    } else if (lists.length === 0) {
      selectedListId.value = null
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString('zh-CN')
}

function openEdit() {
  formTitle.value = selectedList.value?.title ?? '待办'
  formItemsText.value = selectedList.value ? itemsToText(selectedList.value.items) : ''
}

function closeModal() {
  showEdit.value = false
  formTitle.value = ''
  formItemsText.value = ''
}

async function saveList() {
  const title = formTitle.value.trim()
  if (!title) {
    error.value = '列表标题不能为空'
    return
  }
  const parsed = parseItemsText(formItemsText.value)
  const existing = selectedList.value
  const existingByTitle = new Map(existing?.items.map((it) => [it.title, it]) ?? [])
  const items: TodoItem[] = parsed.map((it) => {
    const ex = existingByTitle.get(it.title)
    return {
      id: ex?.id ?? '',
      title: it.title,
      description: it.description,
      status: (ex?.status ?? 'todo') as 'todo' | 'doing' | 'done'
    }
  })
  const scope = currentScope.value
  try {
    if (!existing) {
      const created = await createTodoList(scope, { title })
      await replaceTodoItems(scope, created.id, items)
      selectedListId.value = created.id
    } else {
      await updateTodoListTitle(scope, existing.id, title)
      await replaceTodoItems(scope, existing.id, items)
    }
    closeModal()
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

onMounted(load)
watch(currentScope, load)
watch(showEdit, (v) => v && openEdit())
</script>
