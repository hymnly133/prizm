<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">发送通知</h1>

    <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <p class="mb-4 text-zinc-400">发送通知信号，下游实现将展示具体通知。默认在控制台打印。</p>
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-sm text-zinc-400">标题</label>
          <input
            v-model="title"
            type="text"
            class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
            placeholder="通知标题"
          />
        </div>
        <div>
          <label class="mb-1 block text-sm text-zinc-400">内容（可选）</label>
          <textarea
            v-model="body"
            class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
            rows="3"
            placeholder="通知内容"
          />
        </div>
        <button
          class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          :disabled="!title.trim()"
          @click="send"
        >
          发送
        </button>
        <p v-if="sent" class="text-emerald-400">已发送</p>
        <p v-else-if="sendError" class="text-red-400">{{ sendError }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { sendNotify } from '../api/client'

const title = ref('')
const body = ref('')
const sent = ref(false)
const sendError = ref('')

async function send() {
  if (!title.value.trim()) return
  sent.value = false
  sendError.value = ''
  try {
    await sendNotify(title.value.trim(), body.value.trim() || undefined)
    sent.value = true
  } catch (e) {
    sendError.value = e instanceof Error ? e.message : String(e)
  }
}
</script>
