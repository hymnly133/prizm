<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Agent 工具配置</h1>
    <p class="text-sm text-zinc-400">
      内置联网搜索与 MCP 服务器，Agent 对话时可调用。Tavily 需 API Key；MCP 支持 headers/env 鉴权。
    </p>

    <!-- 服务端配置 -->
    <details class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <summary class="cursor-pointer text-lg font-medium">服务端配置</summary>
      <p class="mt-2 mb-4 text-sm text-zinc-400">
        端口、鉴权、Embedding、Agent 上下文、LLM API Key 等；与环境变量等价。修改端口/主机后需重启服务端。
      </p>
      <div v-if="serverConfigLoading" class="text-zinc-400">加载中...</div>
      <form v-else class="space-y-4 max-w-2xl" @submit.prevent="saveServerConfig">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="mb-1 block text-sm text-zinc-400">端口</label>
            <input
              v-model.number="serverConfigPatch.server.port"
              type="number"
              class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
              placeholder="4127"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm text-zinc-400">监听地址</label>
            <input
              v-model="serverConfigPatch.server.host"
              class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
              placeholder="127.0.0.1"
            />
          </div>
        </div>
        <div class="flex items-center gap-2">
          <input v-model="serverConfigPatch.server.authDisabled" type="checkbox" class="rounded border-zinc-600" />
          <label class="text-sm text-zinc-300">关闭鉴权（开发用）</label>
        </div>
        <div>
          <label class="mb-1 block text-sm text-zinc-400">MCP 默认 Scope</label>
          <input
            v-model="serverConfigPatch.server.mcpScope"
            class="w-full max-w-xs rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
            placeholder="online"
          />
        </div>
        <div class="border-t border-zinc-600 pt-4">
          <h3 class="mb-2 text-sm font-medium text-zinc-300">Embedding</h3>
          <div class="flex items-center gap-2">
            <input v-model="serverConfigPatch.embedding.enabled" type="checkbox" class="rounded border-zinc-600" />
            <label class="text-sm text-zinc-300">启用</label>
          </div>
          <input
            v-model="serverConfigPatch.embedding.model"
            class="mt-2 w-full max-w-md rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
            placeholder="TaylorAI/bge-micro-v2"
          />
        </div>
        <div>
          <label class="mb-1 block text-sm text-zinc-400">Agent Scope 上下文最大字符数</label>
          <input
            v-model.number="serverConfigPatch.agent.scopeContextMaxChars"
            type="number"
            min="500"
            max="12000"
            class="w-full max-w-xs rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
            placeholder="2200"
          />
        </div>
        <div class="border-t border-zinc-600 pt-4">
          <h3 class="mb-2 text-sm font-medium text-zinc-300">LLM 配置（多配置可切换）</h3>
          <p class="mb-3 text-xs text-zinc-500">添加 OpenAI 兼容 / Anthropic / Google，至少配置一个 API Key。可设默认配置。</p>
          <div class="space-y-3">
            <div
              v-for="(c, i) in serverConfigPatch.llm.configs"
              :key="c.id"
              class="rounded border border-zinc-600 bg-zinc-900/50 p-3"
            >
              <div class="mb-2 flex items-center justify-between">
                <label class="flex items-center gap-2 text-sm text-zinc-400">
                  <input v-model="serverConfigPatch.llm.defaultConfigId" type="radio" :value="c.id" />
                  默认
                </label>
                <button type="button" class="text-sm text-red-400 hover:text-red-300" @click="removeLlmConfig(i)">删除</button>
              </div>
              <div class="grid gap-2">
                <div>
                  <label class="mb-0.5 block text-xs text-zinc-500">名称</label>
                  <input v-model="c.name" class="w-full rounded border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-zinc-100" placeholder="例如：OpenAI" />
                </div>
                <div>
                  <label class="mb-0.5 block text-xs text-zinc-500">类型</label>
                  <select v-model="c.type" class="w-full rounded border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-zinc-100">
                    <option value="openai_compatible">OpenAI 兼容</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                  </select>
                </div>
                <div>
                  <label class="mb-0.5 block text-xs text-zinc-500">API Key</label>
                  <input
                    v-model="(c as { apiKey?: string }).apiKey"
                    type="password"
                    class="w-full rounded border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-zinc-100"
                    :placeholder="configuredLlmMap[c.id] ? '已配置，输入新值覆盖' : 'API Key'"
                  />
                </div>
                <div v-if="c.type === 'openai_compatible'">
                  <label class="mb-0.5 block text-xs text-zinc-500">Base URL</label>
                  <input v-model="c.baseUrl" class="w-full rounded border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-zinc-100" placeholder="https://api.openai.com/v1" />
                </div>
                <div>
                  <label class="mb-0.5 block text-xs text-zinc-500">默认模型</label>
                  <input v-model="c.defaultModel" class="w-full rounded border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-zinc-100" placeholder="gpt-4o-mini" />
                </div>
              </div>
            </div>
            <button
              type="button"
              class="rounded border border-dashed border-zinc-600 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-300"
              @click="addLlmConfig"
            >
              添加 LLM 配置
            </button>
          </div>
        </div>
        <div>
          <label class="mb-1 block text-sm text-zinc-400">SkillKit API 地址</label>
          <input
            v-model="serverConfigPatch.skills.skillKitApiUrl"
            class="w-full max-w-md rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
            placeholder="https://skillkit.sh/api"
          />
        </div>
        <div>
          <label class="mb-1 block text-sm text-zinc-400">GitHub Token（可选）</label>
          <input
            v-model="serverConfigPatch.skills.githubToken"
            type="password"
            class="w-full max-w-md rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
            :placeholder="serverConfig?.skills?.configured ? '已配置' : 'ghp_...'"
          />
        </div>
        <button
          type="submit"
          class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          :disabled="serverConfigSaving"
        >
          {{ serverConfigSaving ? '保存中...' : '保存服务端配置' }}
        </button>
      </form>
    </details>

    <!-- 内置工具：Tavily -->
    <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <h2 class="mb-4 text-lg font-medium">Tavily 联网搜索</h2>
      <p class="mb-4 text-sm text-zinc-400">
        为 Agent 提供实时联网搜索能力，需在
        <a
          href="https://tavily.com"
          target="_blank"
          rel="noreferrer"
          class="text-emerald-400 hover:underline"
          >tavily.com</a
        >
        获取 API Key
      </p>
      <div v-if="tavilyLoading" class="text-zinc-400">加载中...</div>
      <form v-else class="space-y-4 max-w-md" @submit.prevent="saveTavily">
        <div>
          <label class="mb-1 block text-sm text-zinc-400">API Key</label>
          <input
            v-model="tavilyApiKeyInput"
            type="password"
            class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
            :placeholder="tavily?.configured ? '已配置，留空不修改' : 'tvly-xxx'"
          />
        </div>
        <div class="flex items-center gap-2">
          <input v-model="tavilyEnabled" type="checkbox" class="rounded border-zinc-600" />
          <label class="text-sm text-zinc-300">启用</label>
        </div>
        <div>
          <label class="mb-1 block text-sm text-zinc-400">最大结果数 (1-20)</label>
          <input
            v-model.number="tavilyMaxResults"
            type="number"
            min="1"
            max="20"
            class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label class="mb-1 block text-sm text-zinc-400">搜索深度</label>
          <select
            v-model="tavilySearchDepth"
            class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
          >
            <option value="basic">basic</option>
            <option value="advanced">advanced</option>
            <option value="fast">fast</option>
            <option value="ultra-fast">ultra-fast</option>
          </select>
        </div>
        <button
          type="submit"
          class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          :disabled="tavilySaving"
        >
          {{ tavilySaving ? '保存中...' : '保存 Tavily 配置' }}
        </button>
      </form>
    </div>

    <!-- Agent LLM 设置 -->
    <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <h2 class="mb-4 text-lg font-medium">Agent LLM 设置</h2>
      <p class="mb-4 text-sm text-zinc-400">文档摘要、对话摘要及默认模型，可在客户端选择覆盖</p>
      <div v-if="agentLoading" class="text-zinc-400">加载中...</div>
      <form v-else class="space-y-4 max-w-md" @submit.prevent="saveAgent">
        <div>
          <label class="mb-1 block text-sm text-zinc-400">默认对话模型</label>
          <select
            v-model="agentDefaultModel"
            class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
          >
            <option value="">默认（跟随 Provider）</option>
            <option v-for="m in agentModels" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <input v-model="docSummaryEnabled" type="checkbox" class="rounded border-zinc-600" />
          <label class="text-sm text-zinc-300">文档记忆</label>
        </div>
        <div v-if="docSummaryEnabled">
          <label class="mb-1 block text-sm text-zinc-400">最小字符数</label>
          <input
            v-model.number="docSummaryMinLen"
            type="number"
            min="100"
            max="10000"
            class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div class="flex items-center gap-2">
          <input v-model="convSummaryEnabled" type="checkbox" class="rounded border-zinc-600" />
          <label class="text-sm text-zinc-300">对话摘要（每 N 轮生成）</label>
        </div>
        <div v-if="convSummaryEnabled">
          <label class="mb-1 block text-sm text-zinc-400">对话摘要间隔</label>
          <input
            v-model.number="convSummaryInterval"
            type="number"
            min="2"
            class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          :disabled="agentSaving"
        >
          {{ agentSaving ? '保存中...' : '保存 Agent LLM 配置' }}
        </button>
      </form>
    </div>

    <!-- MCP 服务器 -->
    <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <h2 class="mb-4 text-lg font-medium">MCP 服务器</h2>
      <p class="mb-4 text-sm text-zinc-400">
        配置外部 MCP 服务器，Agent 对话时可调用其工具。支持 Streamable HTTP、SSE、stdio。
      </p>
      <div v-if="mcpLoading" class="text-zinc-400">加载中...</div>
      <div v-else-if="mcpError" class="text-red-400">{{ mcpError }}</div>
      <div v-else>
        <div class="mb-4 flex gap-2">
          <button
            class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            @click=";(mcpModalOpen = true), (editingMcp = null), void resetMcpForm()"
          >
            添加 MCP 服务器
          </button>
        </div>
        <div
          v-if="mcpServers.length === 0"
          class="rounded border border-dashed border-zinc-600 p-6 text-center text-zinc-500"
        >
          暂无 MCP 服务器
        </div>
        <div v-else class="space-y-3">
          <div
            v-for="s in mcpServers"
            :key="s.id"
            class="flex items-center justify-between rounded border border-zinc-600 bg-zinc-900/50 px-4 py-3"
          >
            <div>
              <span class="font-medium">{{ s.name }}</span>
              <span class="ml-2 font-mono text-xs text-zinc-500">{{ s.id }}</span>
              <span class="ml-2 text-xs text-zinc-500">{{ s.transport }}</span>
              <span
                v-if="s.headers && Object.keys(s.headers).length"
                class="ml-2 text-xs text-amber-400"
                >已配置鉴权</span
              >
              <span
                v-if="s.stdio?.env && Object.keys(s.stdio.env).length"
                class="ml-2 text-xs text-amber-400"
                >已配置 env</span
              >
            </div>
            <div class="flex gap-2">
              <button
                class="text-sm text-emerald-400 hover:text-emerald-300"
                @click="openEditMcp(s)"
              >
                编辑
              </button>
              <button class="text-sm text-red-400 hover:text-red-300" @click="deleteMcp(s.id)">
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Embedding 模型状态 -->
    <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <h2 class="mb-4 text-lg font-medium">Embedding 模型状态</h2>
      <p class="mb-4 text-sm text-zinc-400">本地向量模型运行状态；完整配置在「服务端配置」中。</p>
      <div v-if="embeddingLoading" class="text-zinc-400">加载中...</div>
      <div v-else-if="embeddingError" class="text-red-400">{{ embeddingError }}</div>
      <div v-else-if="embeddingStatus" class="space-y-3">
        <div class="flex flex-wrap items-center gap-4">
          <span class="text-zinc-300">状态</span>
          <span
            :class="
              embeddingStatus.state === 'ready'
                ? 'text-emerald-400'
                : embeddingStatus.state === 'loading'
                  ? 'text-amber-400'
                  : 'text-zinc-500'
            "
          >
            {{ embeddingStatus.state }}
          </span>
          <span class="text-zinc-500">|</span>
          <span class="text-zinc-300">模型</span>
          <span class="font-mono text-sm text-zinc-200">{{ embeddingStatus.modelName }}</span>
          <span class="text-zinc-500">|</span>
          <span class="text-zinc-300">维度</span>
          <span class="text-zinc-200">{{ embeddingStatus.dimension }}</span>
          <span class="text-zinc-500">|</span>
          <span class="text-zinc-300">启用</span>
          <span class="text-zinc-200">{{ embeddingStatus.enabled ? '是' : '否' }}</span>
        </div>
        <div v-if="embeddingStatus.stats" class="text-xs text-zinc-500">
          调用 {{ embeddingStatus.stats.totalCalls }} 次，错误 {{ embeddingStatus.stats.totalErrors }}，字符 {{ embeddingStatus.stats.totalCharsProcessed ?? 0 }}，P95 延迟 {{ embeddingStatus.stats.p95LatencyMs ?? 0 }}ms
        </div>
        <button
          type="button"
          class="rounded bg-zinc-600 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-500 disabled:opacity-50"
          :disabled="embeddingReloading"
          @click="reloadEmbedding"
        >
          {{ embeddingReloading ? '重载中...' : '重载模型' }}
        </button>
      </div>
    </div>

    <!-- Skills -->
    <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <h2 class="mb-4 text-lg font-medium">Skills</h2>
      <p class="mb-4 text-sm text-zinc-400">已安装的 Agent Skills；安装/发现建议使用 Electron 客户端。</p>
      <div v-if="skillsLoading" class="text-zinc-400">加载中...</div>
      <div v-else-if="skillsError" class="text-red-400">{{ skillsError }}</div>
      <div v-else-if="skillsList.length === 0" class="text-zinc-500">暂无 Skill</div>
      <div v-else class="space-y-2">
        <div
          v-for="s in skillsList"
          :key="s.name"
          class="flex items-center justify-between rounded border border-zinc-600 bg-zinc-900/50 px-4 py-2"
        >
          <div>
            <span class="font-medium text-zinc-200">{{ s.name }}</span>
            <span v-if="s.description" class="ml-2 text-sm text-zinc-500">{{ s.description }}</span>
          </div>
          <label class="flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              :checked="s.enabled !== false"
              class="rounded border-zinc-600"
              @change="toggleSkill(s)"
            />
            启用
          </label>
        </div>
      </div>
    </div>

    <!-- Agent 规则 -->
    <div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <h2 class="mb-4 text-lg font-medium">Agent 规则</h2>
      <p class="mb-4 text-sm text-zinc-400">用户级与 Scope 级规则；新建/编辑建议使用 Electron 客户端。</p>
      <div class="mb-3 flex items-center gap-2">
        <span class="text-sm text-zinc-500">Scope（仅影响 Scope 级规则列表）：</span>
        <select
          v-model="rulesScope"
          class="rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
        >
          <option v-for="sc in rulesScopes" :key="sc" :value="sc">{{ sc }}</option>
        </select>
      </div>
      <div v-if="rulesLoading" class="text-zinc-400">加载中...</div>
      <div v-else-if="rulesError" class="text-red-400">{{ rulesError }}</div>
      <div v-else class="space-y-4">
        <div>
          <h3 class="mb-2 text-sm font-medium text-zinc-400">用户级</h3>
          <div v-if="userRules.length === 0" class="text-zinc-500 text-sm">暂无</div>
          <div v-else class="space-y-2">
            <div
              v-for="r in userRules"
              :key="r.id"
              class="flex items-center justify-between rounded border border-zinc-600 bg-zinc-900/50 px-4 py-2"
            >
              <span class="font-medium text-zinc-200">{{ r.title }}</span>
              <label class="flex items-center gap-2 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  :checked="r.enabled"
                  class="rounded border-zinc-600"
                  @change="toggleRule(r, 'user')"
                />
                启用
              </label>
            </div>
          </div>
        </div>
        <div>
          <h3 class="mb-2 text-sm font-medium text-zinc-400">Scope 级</h3>
          <div v-if="scopeRules.length === 0" class="text-zinc-500 text-sm">暂无</div>
          <div v-else class="space-y-2">
            <div
              v-for="r in scopeRules"
              :key="r.id"
              class="flex items-center justify-between rounded border border-zinc-600 bg-zinc-900/50 px-4 py-2"
            >
              <span class="font-medium text-zinc-200">{{ r.title }}</span>
              <label class="flex items-center gap-2 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  :checked="r.enabled"
                  class="rounded border-zinc-600"
                  @change="toggleRule(r, 'scope')"
                />
                启用
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- MCP 添加/编辑 Modal（简化版，完整功能建议用 Electron 客户端） -->
    <div
      v-if="mcpModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="mcpModalOpen = false"
    >
      <div
        class="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg border border-zinc-600 bg-zinc-800 p-6"
      >
        <h3 class="mb-4 text-lg font-medium">
          {{ editingMcp ? '编辑 MCP 服务器' : '添加 MCP 服务器' }}
        </h3>
        <p class="mb-4 text-sm text-zinc-400">
          完整配置（含 API Key、环境变量）建议使用 Electron 客户端。此处仅支持基础配置。
        </p>
        <form class="space-y-4" @submit.prevent="saveMcp">
          <div>
            <label class="mb-1 block text-sm text-zinc-400">ID</label>
            <input
              v-model="mcpForm.id"
              class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2"
              placeholder="github"
              :disabled="!!editingMcp"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm text-zinc-400">名称</label>
            <input
              v-model="mcpForm.name"
              class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2"
              placeholder="GitHub"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm text-zinc-400">传输类型</label>
            <select
              v-model="mcpForm.transport"
              class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2"
            >
              <option value="streamable-http">Streamable HTTP</option>
              <option value="sse">SSE</option>
              <option value="stdio">Stdio</option>
            </select>
          </div>
          <div v-if="mcpForm.transport !== 'stdio'">
            <label class="mb-1 block text-sm text-zinc-400">URL</label>
            <input
              v-model="mcpForm.url"
              class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2"
              placeholder="http://127.0.0.1:4127/mcp"
            />
          </div>
          <div v-if="mcpForm.transport === 'stdio'">
            <label class="mb-1 block text-sm text-zinc-400">命令</label>
            <input
              v-model="mcpForm.stdioCommand"
              class="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2"
              placeholder="npx"
            />
          </div>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="rounded border border-zinc-600 px-4 py-2 text-sm hover:bg-zinc-700"
              @click="mcpModalOpen = false"
            >
              取消
            </button>
            <button
              type="submit"
              class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  getAgentTools,
  getAgentModels,
  updateAgentTools,
  updateTavilySettings,
  getServerConfig,
  updateServerConfig,
  listMcpServers,
  addMcpServer,
  updateMcpServer,
  deleteMcpServer,
  getEmbeddingStatus,
  postEmbeddingReload,
  getSkills,
  patchSkill,
  getAgentRules,
  patchAgentRule,
  getScopes,
  type TavilySettings,
  type AgentToolsSettings,
  type ServerConfigResponse,
  type EmbeddingStatus,
  type SkillMeta,
  type AgentRule
} from '../api/client'

const serverConfig = ref<ServerConfigResponse | null>(null)
const serverConfigLoading = ref(true)
const serverConfigSaving = ref(false)
const serverConfigPatch = ref<Partial<ServerConfigResponse> & {
  server: Record<string, unknown>
  embedding: Record<string, unknown>
  agent: Record<string, unknown>
  llm: { defaultConfigId?: string; configs: Array<{ id: string; name: string; type: string; apiKey?: string; baseUrl?: string; defaultModel?: string }> }
  skills: Record<string, unknown>
}>({
  server: {},
  embedding: {},
  agent: {},
  llm: { configs: [] },
  skills: {}
})

async function loadServerConfigData() {
  serverConfigLoading.value = true
  try {
    serverConfig.value = await getServerConfig()
    serverConfigPatch.value = {
      server: { ...serverConfig.value.server },
      embedding: { ...serverConfig.value.embedding },
      agent: { ...serverConfig.value.agent },
      llm: serverConfig.value.llm ? { defaultConfigId: serverConfig.value.llm.defaultConfigId, configs: [...(serverConfig.value.llm.configs ?? [])] } : { configs: [] },
      skills: { ...serverConfig.value.skills }
    }
  } finally {
    serverConfigLoading.value = false
  }
}

async function saveServerConfig() {
  serverConfigSaving.value = true
  try {
    await updateServerConfig(serverConfigPatch.value)
    await loadServerConfigData()
  } finally {
    serverConfigSaving.value = false
  }
}

const tavily = ref<TavilySettings | null>(null)
const tavilyLoading = ref(true)
const tavilySaving = ref(false)
const tavilyApiKeyInput = ref('')
const tavilyEnabled = ref(true)
const tavilyMaxResults = ref(5)
const tavilySearchDepth = ref<'basic' | 'advanced' | 'fast' | 'ultra-fast'>('basic')

const mcpServers = ref<NonNullable<AgentToolsSettings['mcpServers']>>([])
const mcpLoading = ref(true)
const mcpError = ref('')
const mcpModalOpen = ref(false)
const editingMcp = ref<NonNullable<AgentToolsSettings['mcpServers']>[0] | null>(null)
const mcpForm = ref({
  id: '',
  name: '',
  transport: 'streamable-http' as const,
  url: '',
  stdioCommand: '',
  enabled: true
})

const embeddingStatus = ref<EmbeddingStatus | null>(null)
const embeddingLoading = ref(true)
const embeddingError = ref('')
const embeddingReloading = ref(false)

const skillsList = ref<SkillMeta[]>([])
const skillsLoading = ref(true)
const skillsError = ref('')

const userRules = ref<AgentRule[]>([])
const scopeRules = ref<AgentRule[]>([])
const rulesScopes = ref<string[]>(['default'])
const rulesScope = ref('default')
const rulesLoading = ref(true)
const rulesError = ref('')

const agentLoading = ref(true)
const agentSaving = ref(false)
const agentModels = ref<Array<{ id: string; label: string }>>([])
const agentDefaultModel = ref('')
const docSummaryEnabled = ref(true)
const docSummaryMinLen = ref(500)
const convSummaryEnabled = ref(true)
const convSummaryInterval = ref(10)
const convSummaryModel = ref('')

const configuredLlmMap = computed(() => {
  const m: Record<string, boolean> = {}
  serverConfig.value?.llm?.configs?.forEach((c: { id: string; configured?: boolean }) => {
    m[c.id] = !!c.configured
  })
  return m
})

function genLlmConfigId() {
  return `llm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function addLlmConfig() {
  const configs = [...(serverConfigPatch.value.llm?.configs ?? [])]
  configs.push({ id: genLlmConfigId(), name: '新配置', type: 'openai_compatible' })
  if (!serverConfigPatch.value.llm) serverConfigPatch.value.llm = { configs: [] }
  serverConfigPatch.value.llm.configs = configs
  if (!serverConfigPatch.value.llm.defaultConfigId) serverConfigPatch.value.llm.defaultConfigId = configs[configs.length - 1]!.id
}

function removeLlmConfig(index: number) {
  const configs = serverConfigPatch.value.llm?.configs ?? []
  const next = configs.filter((_, i) => i !== index)
  const removedId = configs[index]?.id
  serverConfigPatch.value.llm = { ...serverConfigPatch.value.llm, configs: next, defaultConfigId: serverConfigPatch.value.llm?.defaultConfigId === removedId ? next[0]?.id : serverConfigPatch.value.llm?.defaultConfigId }
}

async function loadAgent() {
  agentLoading.value = true
  try {
    const [tools, modelsRes] = await Promise.all([getAgentTools(), getAgentModels()])
    agentModels.value = (modelsRes.models ?? []).map((m) => ({ id: `${m.configId}:${m.modelId}`, label: m.label }))
    agentDefaultModel.value = tools.agent?.defaultModel ?? ''
    docSummaryEnabled.value = tools.agent?.documentSummary?.enabled !== false
    docSummaryMinLen.value = tools.agent?.documentSummary?.minLen ?? 500
    convSummaryEnabled.value = tools.agent?.conversationSummary?.enabled !== false
    convSummaryInterval.value = tools.agent?.conversationSummary?.interval ?? 10
    convSummaryModel.value = tools.agent?.conversationSummary?.model ?? ''
  } finally {
    agentLoading.value = false
  }
}

async function saveAgent() {
  agentSaving.value = true
  try {
    await updateAgentTools({
      agent: {
        defaultModel: agentDefaultModel.value || undefined,
        documentSummary: {
          enabled: docSummaryEnabled.value,
          minLen: docSummaryMinLen.value
        },
        conversationSummary: {
          enabled: convSummaryEnabled.value,
          interval: convSummaryInterval.value,
          model: convSummaryModel.value || undefined
        }
      }
    })
    await loadAgent()
  } finally {
    agentSaving.value = false
  }
}

async function loadTavily() {
  tavilyLoading.value = true
  try {
    const data = await getAgentTools()
    tavily.value = data.builtin?.tavily ?? null
    tavilyEnabled.value = tavily.value?.enabled !== false
    tavilyMaxResults.value = tavily.value?.maxResults ?? 5
    tavilySearchDepth.value =
      (tavily.value?.searchDepth as typeof tavilySearchDepth.value) ?? 'basic'
    tavilyApiKeyInput.value = ''
  } catch {
    tavily.value = null
  } finally {
    tavilyLoading.value = false
  }
}

async function saveTavily() {
  tavilySaving.value = true
  try {
    await updateTavilySettings({
      enabled: tavilyEnabled.value,
      maxResults: tavilyMaxResults.value,
      searchDepth: tavilySearchDepth.value,
      ...(tavilyApiKeyInput.value.trim() && { apiKey: tavilyApiKeyInput.value.trim() })
    })
    tavilyApiKeyInput.value = ''
    await loadTavily()
  } finally {
    tavilySaving.value = false
  }
}

async function loadMcp() {
  mcpLoading.value = true
  mcpError.value = ''
  try {
    mcpServers.value = await listMcpServers()
  } catch (e) {
    mcpError.value = e instanceof Error ? e.message : String(e)
    mcpServers.value = []
  } finally {
    mcpLoading.value = false
  }
}

function resetMcpForm() {
  mcpForm.value = {
    id: '',
    name: '',
    transport: 'streamable-http',
    url: '',
    stdioCommand: '',
    enabled: true
  }
}

function openEditMcp(s: NonNullable<AgentToolsSettings['mcpServers']>[0]) {
  editingMcp.value = s
  mcpForm.value = {
    id: s.id,
    name: s.name,
    transport: s.transport as typeof mcpForm.value.transport,
    url: s.url ?? '',
    stdioCommand: s.stdio?.command ?? '',
    enabled: s.enabled
  }
  mcpModalOpen.value = true
}

async function saveMcp() {
  try {
    if (editingMcp.value) {
      await updateMcpServer(editingMcp.value.id, {
        name: mcpForm.value.name,
        transport: mcpForm.value.transport,
        url: mcpForm.value.transport !== 'stdio' ? mcpForm.value.url : undefined,
        stdio:
          mcpForm.value.transport === 'stdio' ? { command: mcpForm.value.stdioCommand } : undefined,
        enabled: mcpForm.value.enabled
      })
    } else {
      await addMcpServer({
        id: mcpForm.value.id,
        name: mcpForm.value.name,
        transport: mcpForm.value.transport,
        url: mcpForm.value.transport !== 'stdio' ? mcpForm.value.url : undefined,
        stdio:
          mcpForm.value.transport === 'stdio' ? { command: mcpForm.value.stdioCommand } : undefined,
        enabled: mcpForm.value.enabled
      })
    }
    mcpModalOpen.value = false
    await loadMcp()
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

async function deleteMcp(id: string) {
  if (!confirm('确定删除该 MCP 服务器？')) return
  try {
    await deleteMcpServer(id)
    await loadMcp()
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

async function loadEmbedding() {
  embeddingLoading.value = true
  embeddingError.value = ''
  try {
    embeddingStatus.value = await getEmbeddingStatus()
  } catch (e) {
    embeddingError.value = e instanceof Error ? e.message : String(e)
    embeddingStatus.value = null
  } finally {
    embeddingLoading.value = false
  }
}

async function reloadEmbedding() {
  embeddingReloading.value = true
  try {
    await postEmbeddingReload()
    await loadEmbedding()
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  } finally {
    embeddingReloading.value = false
  }
}

async function loadSkills() {
  skillsLoading.value = true
  skillsError.value = ''
  try {
    skillsList.value = await getSkills()
  } catch (e) {
    skillsError.value = e instanceof Error ? e.message : String(e)
    skillsList.value = []
  } finally {
    skillsLoading.value = false
  }
}

async function toggleSkill(s: SkillMeta) {
  const next = s.enabled !== false ? false : true
  try {
    await patchSkill(s.name, { enabled: next })
    await loadSkills()
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

async function loadRulesScopes() {
  try {
    const r = await getScopes()
    rulesScopes.value = r.scopes?.length ? r.scopes : ['default']
    if (!rulesScopes.value.includes(rulesScope.value)) rulesScope.value = rulesScopes.value[0]
  } catch {
    rulesScopes.value = ['default']
  }
}

async function loadAgentRules() {
  rulesLoading.value = true
  rulesError.value = ''
  try {
    const [user, scope] = await Promise.all([
      getAgentRules('user'),
      getAgentRules('scope', rulesScope.value)
    ])
    userRules.value = user
    scopeRules.value = scope
  } catch (e) {
    rulesError.value = e instanceof Error ? e.message : String(e)
    userRules.value = []
    scopeRules.value = []
  } finally {
    rulesLoading.value = false
  }
}

async function toggleRule(r: AgentRule, level: 'user' | 'scope') {
  const next = !r.enabled
  try {
    await patchAgentRule(r.id, { enabled: next }, level, level === 'scope' ? rulesScope.value : undefined)
    await loadAgentRules()
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

watch(rulesScope, () => {
  if (rulesScopes.value.length) loadAgentRules()
})

onMounted(() => {
  loadServerConfigData()
  loadTavily()
  loadAgent()
  loadMcp()
  loadEmbedding()
  loadSkills()
  loadRulesScopes().then(() => loadAgentRules())
})
</script>
