import { PrizmClient } from '../client'
import type {
  McpServerConfig,
  McpTool,
  TavilySettings,
  AgentToolsSettings,
  AvailableModel,
  ShellInfo
} from '../clientTypes'

declare module '../client' {
  interface PrizmClient {
    listMcpServers(): Promise<McpServerConfig[]>
    addMcpServer(config: McpServerConfig): Promise<McpServerConfig>
    updateMcpServer(
      id: string,
      update: Partial<Omit<McpServerConfig, 'id'>>
    ): Promise<McpServerConfig>
    deleteMcpServer(id: string): Promise<void>
    getMcpServerTools(id: string): Promise<{ tools: McpTool[] }>
    getAgentModels(): Promise<{ provider: string; models: AvailableModel[] }>
    getAvailableShells(): Promise<{ shells: ShellInfo[] }>
    getAgentTools(): Promise<AgentToolsSettings>
    updateAgentTools(patch: Partial<AgentToolsSettings>): Promise<AgentToolsSettings>
    updateTavilySettings(
      update: Partial<TavilySettings>
    ): Promise<{ tavily: TavilySettings | null }>
    listCustomCommands(): Promise<{ commands: unknown[] }>
    createCustomCommand(cmd: {
      id: string
      name?: string
      description?: string
      mode?: 'prompt' | 'action'
      content: string
      aliases?: string[]
    }): Promise<unknown>
    updateCustomCommand(id: string, update: Record<string, unknown>): Promise<unknown>
    deleteCustomCommand(id: string): Promise<void>
    importCommands(
      source: 'cursor' | 'claude-code',
      path?: string
    ): Promise<{ imported: number; commands: unknown[] }>
    listSkills(): Promise<{ skills: unknown[] }>
    getSkill(name: string): Promise<unknown>
    createSkill(skill: {
      name: string
      description: string
      body: string
      license?: string
      metadata?: Record<string, string>
    }): Promise<unknown>
    deleteSkill(name: string): Promise<void>
    importSkills(
      source: 'claude-code' | 'github',
      path?: string
    ): Promise<{ imported: number; skills: unknown[] }>
    importMcpConfig(
      source: 'cursor' | 'claude-code' | 'vscode',
      path?: string
    ): Promise<{ imported: number; skipped: string[]; servers: unknown[] }>
    discoverMcpConfigs(): Promise<{
      sources: Array<{ source: string; path: string; serverCount: number }>
    }>
  }
}

PrizmClient.prototype.listMcpServers = async function (this: PrizmClient) {
  const data = await this.request<{ mcpServers: McpServerConfig[] }>('/mcp/servers')
  return data.mcpServers ?? []
}

PrizmClient.prototype.addMcpServer = async function (this: PrizmClient, config: McpServerConfig) {
  return this.request<McpServerConfig>('/mcp/servers', {
    method: 'POST',
    body: JSON.stringify(config)
  })
}

PrizmClient.prototype.updateMcpServer = async function (
  this: PrizmClient,
  id: string,
  update: Partial<Omit<McpServerConfig, 'id'>>
) {
  return this.request<McpServerConfig>(`/mcp/servers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(update)
  })
}

PrizmClient.prototype.deleteMcpServer = async function (this: PrizmClient, id: string) {
  await this.request<void>(`/mcp/servers/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
}

PrizmClient.prototype.getMcpServerTools = async function (this: PrizmClient, id: string) {
  return this.request<{ tools: McpTool[] }>(`/mcp/servers/${encodeURIComponent(id)}/tools`)
}

PrizmClient.prototype.getAgentModels = async function (this: PrizmClient) {
  return this.request<{ provider: string; models: AvailableModel[] }>('/settings/agent-models')
}

PrizmClient.prototype.getAvailableShells = async function (this: PrizmClient) {
  return this.request<{ shells: ShellInfo[] }>('/settings/available-shells')
}

PrizmClient.prototype.getAgentTools = async function (this: PrizmClient) {
  return this.request<AgentToolsSettings>('/settings/agent-tools')
}

PrizmClient.prototype.updateAgentTools = async function (
  this: PrizmClient,
  patch: Partial<AgentToolsSettings>
) {
  return this.request<AgentToolsSettings>('/settings/agent-tools', {
    method: 'PATCH',
    body: JSON.stringify(patch)
  })
}

PrizmClient.prototype.updateTavilySettings = async function (
  this: PrizmClient,
  update: Partial<TavilySettings>
) {
  return this.request<{ tavily: TavilySettings | null }>('/settings/agent-tools/builtin/tavily', {
    method: 'PUT',
    body: JSON.stringify(update)
  })
}

PrizmClient.prototype.listCustomCommands = async function (this: PrizmClient) {
  return this.request<{ commands: unknown[] }>('/commands')
}

PrizmClient.prototype.createCustomCommand = async function (
  this: PrizmClient,
  cmd: {
    id: string
    name?: string
    description?: string
    mode?: 'prompt' | 'action'
    content: string
    aliases?: string[]
  }
) {
  return this.request('/commands', {
    method: 'POST',
    body: JSON.stringify(cmd)
  })
}

PrizmClient.prototype.updateCustomCommand = async function (
  this: PrizmClient,
  id: string,
  update: Record<string, unknown>
) {
  return this.request(`/commands/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(update)
  })
}

PrizmClient.prototype.deleteCustomCommand = async function (this: PrizmClient, id: string) {
  await this.request<void>(`/commands/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
}

PrizmClient.prototype.importCommands = async function (
  this: PrizmClient,
  source: 'cursor' | 'claude-code',
  path?: string
) {
  return this.request('/commands/import', {
    method: 'POST',
    body: JSON.stringify({ source, path })
  })
}

PrizmClient.prototype.listSkills = async function (this: PrizmClient) {
  return this.request<{ skills: unknown[] }>('/skills')
}

PrizmClient.prototype.getSkill = async function (this: PrizmClient, name: string) {
  return this.request(`/skills/${encodeURIComponent(name)}`)
}

PrizmClient.prototype.createSkill = async function (
  this: PrizmClient,
  skill: {
    name: string
    description: string
    body: string
    license?: string
    metadata?: Record<string, string>
  }
) {
  return this.request('/skills', {
    method: 'POST',
    body: JSON.stringify(skill)
  })
}

PrizmClient.prototype.deleteSkill = async function (this: PrizmClient, name: string) {
  await this.request<void>(`/skills/${encodeURIComponent(name)}`, {
    method: 'DELETE'
  })
}

PrizmClient.prototype.importSkills = async function (
  this: PrizmClient,
  source: 'claude-code' | 'github',
  path?: string
) {
  return this.request('/skills/import', {
    method: 'POST',
    body: JSON.stringify({ source, path })
  })
}

PrizmClient.prototype.importMcpConfig = async function (
  this: PrizmClient,
  source: 'cursor' | 'claude-code' | 'vscode',
  path?: string
) {
  return this.request('/mcp/import', {
    method: 'POST',
    body: JSON.stringify({ source, path })
  })
}

PrizmClient.prototype.discoverMcpConfigs = async function (this: PrizmClient) {
  return this.request('/mcp/discover')
}
