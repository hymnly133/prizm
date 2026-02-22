import { PrizmClient } from '../client'
import type {
  McpServerConfig,
  McpTool,
  TavilySettings,
  SkillsMPSettings,
  AgentToolsSettings,
  ShellInfo,
  AgentRule,
  RuleLevel,
  CreateAgentRuleInput,
  UpdateAgentRuleInput,
  ServerConfig,
  ServerConfigResponse,
  AgentModelsResponse
} from '../clientTypes'

declare module '../client' {
  interface PrizmClient {
    getServerConfig(): Promise<ServerConfigResponse>
    updateServerConfig(patch: Partial<ServerConfig>): Promise<ServerConfigResponse>
    listMcpServers(): Promise<McpServerConfig[]>
    addMcpServer(config: McpServerConfig): Promise<McpServerConfig>
    updateMcpServer(
      id: string,
      update: Partial<Omit<McpServerConfig, 'id'>>
    ): Promise<McpServerConfig>
    deleteMcpServer(id: string): Promise<void>
    getMcpServerTools(id: string): Promise<{ tools: McpTool[] }>
    getAgentModels(): Promise<AgentModelsResponse>
    getAvailableShells(): Promise<{ shells: ShellInfo[] }>
    getAgentTools(): Promise<AgentToolsSettings>
    updateAgentTools(patch: Partial<AgentToolsSettings>): Promise<AgentToolsSettings>
    updateTavilySettings(
      update: Partial<TavilySettings>
    ): Promise<{ tavily: TavilySettings | null }>
    updateSkillsMPSettings(
      update: Partial<SkillsMPSettings>
    ): Promise<{ skillsmp: SkillsMPSettings | null }>
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
    updateSkill(
      name: string,
      update: { description?: string; body?: string; enabled?: boolean }
    ): Promise<unknown>
    deleteSkill(name: string): Promise<void>
    importSkills(
      source: 'claude-code' | 'github',
      path?: string
    ): Promise<{ imported: number; skills: unknown[] }>
    searchSkillRegistry(
      query: string,
      page?: number
    ): Promise<{
      items: Array<{
        name: string
        description: string
        owner: string
        repo: string
        skillPath: string
        stars?: number
        license?: string
        source: string
        htmlUrl?: string
      }>
      totalCount: number
      query: string
    }>
    getFeaturedSkills(): Promise<{
      skills: Array<{
        name: string
        description: string
        owner: string
        repo: string
        skillPath: string
        license?: string
        source: string
        htmlUrl?: string
        installed?: boolean
      }>
    }>
    getCollectionSkills(
      owner: string,
      repo: string,
      path?: string
    ): Promise<{
      skills: Array<{
        name: string
        description: string
        owner: string
        repo: string
        skillPath: string
        license?: string
        source: string
        htmlUrl?: string
        installed?: boolean
      }>
    }>
    searchSkillKitRegistry(
      query: string,
      limit?: number
    ): Promise<{
      items: Array<{
        name: string
        description: string
        owner: string
        repo: string
        skillPath: string
        license?: string
        source: string
        htmlUrl?: string
        installed?: boolean
        score?: number
      }>
      totalCount: number
      query: string
    }>
    searchSkillsMPRegistry(
      query: string,
      limit?: number,
      page?: number
    ): Promise<{
      items: Array<{
        name: string
        description: string
        owner: string
        repo: string
        skillPath: string
        license?: string
        source: string
        htmlUrl?: string
        installed?: boolean
      }>
      totalCount: number
      query: string
    }>
    previewRegistrySkill(
      owner: string,
      repo: string,
      skillPath: string
    ): Promise<{ name: string; description: string; body: string; license?: string } | null>
    installRegistrySkill(
      owner: string,
      repo: string,
      skillPath: string,
      source?: 'github' | 'curated' | 'skillkit' | 'skillsmp'
    ): Promise<unknown>
    importMcpConfig(
      source: 'cursor' | 'claude-code' | 'vscode',
      path?: string
    ): Promise<{ imported: number; skipped: string[]; servers: unknown[] }>
    discoverMcpConfigs(): Promise<{
      sources: Array<{ source: string; path: string; serverCount: number }>
    }>
    listAgentRules(level: RuleLevel, scope?: string): Promise<{ rules: AgentRule[] }>
    getAgentRule(id: string, level: RuleLevel, scope?: string): Promise<AgentRule>
    createAgentRule(input: CreateAgentRuleInput): Promise<AgentRule>
    updateAgentRule(
      id: string,
      level: RuleLevel,
      scope: string | undefined,
      update: UpdateAgentRuleInput
    ): Promise<AgentRule>
    deleteAgentRule(id: string, level: RuleLevel, scope?: string): Promise<void>
  }
}

PrizmClient.prototype.getServerConfig = async function (this: PrizmClient) {
  return this.request<ServerConfigResponse>('/settings/server-config')
}

PrizmClient.prototype.updateServerConfig = async function (
  this: PrizmClient,
  patch: Partial<ServerConfig>
) {
  return this.request<ServerConfigResponse>('/settings/server-config', {
    method: 'PATCH',
    body: JSON.stringify(patch)
  })
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
  return this.request<AgentModelsResponse>('/settings/agent-models')
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

PrizmClient.prototype.updateSkillsMPSettings = async function (
  this: PrizmClient,
  update: Partial<SkillsMPSettings>
) {
  return this.request<{ skillsmp: SkillsMPSettings | null }>(
    '/settings/agent-tools/builtin/skillsmp',
    {
      method: 'PUT',
      body: JSON.stringify(update)
    }
  )
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

PrizmClient.prototype.updateSkill = async function (
  this: PrizmClient,
  name: string,
  update: { description?: string; body?: string; enabled?: boolean }
) {
  return this.request(`/skills/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify(update)
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

PrizmClient.prototype.searchSkillRegistry = async function (
  this: PrizmClient,
  query: string,
  page?: number
) {
  const params = new URLSearchParams({ q: query })
  if (page) params.set('page', String(page))
  return this.request(`/skills/registry/search?${params.toString()}`)
}

PrizmClient.prototype.getFeaturedSkills = async function (this: PrizmClient) {
  return this.request('/skills/registry/featured')
}

PrizmClient.prototype.getCollectionSkills = async function (
  this: PrizmClient,
  owner: string,
  repo: string,
  path?: string
) {
  const params = new URLSearchParams({ owner, repo })
  if (path) params.set('path', path)
  return this.request(`/skills/registry/collection?${params.toString()}`)
}

PrizmClient.prototype.searchSkillKitRegistry = async function (
  this: PrizmClient,
  query: string,
  limit?: number
) {
  const params = new URLSearchParams({ q: query })
  if (limit != null) params.set('limit', String(limit))
  return this.request(`/skills/registry/skillkit/search?${params.toString()}`)
}

PrizmClient.prototype.searchSkillsMPRegistry = async function (
  this: PrizmClient,
  query: string,
  limit?: number,
  page?: number
) {
  const params = new URLSearchParams({ q: query })
  if (limit != null) params.set('limit', String(limit))
  if (page != null) params.set('page', String(page))
  return this.request(`/skills/registry/skillsmp/search?${params.toString()}`)
}

PrizmClient.prototype.previewRegistrySkill = async function (
  this: PrizmClient,
  owner: string,
  repo: string,
  skillPath: string
) {
  const params = new URLSearchParams({ owner, repo, path: skillPath })
  return this.request(`/skills/registry/preview?${params.toString()}`)
}

PrizmClient.prototype.installRegistrySkill = async function (
  this: PrizmClient,
  owner: string,
  repo: string,
  skillPath: string,
  source?: 'github' | 'curated' | 'skillkit' | 'skillsmp'
) {
  return this.request('/skills/registry/install', {
    method: 'POST',
    body: JSON.stringify({ owner, repo, skillPath, ...(source != null ? { source } : {}) })
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

// ============ Agent Rules ============

PrizmClient.prototype.listAgentRules = async function (
  this: PrizmClient,
  level: RuleLevel,
  scope?: string
) {
  const params = new URLSearchParams({ level })
  if (scope) params.set('scope', scope)
  return this.request<{ rules: AgentRule[] }>(`/agent-rules?${params.toString()}`)
}

PrizmClient.prototype.getAgentRule = async function (
  this: PrizmClient,
  id: string,
  level: RuleLevel,
  scope?: string
) {
  const params = new URLSearchParams({ level })
  if (scope) params.set('scope', scope)
  return this.request<AgentRule>(`/agent-rules/${encodeURIComponent(id)}?${params.toString()}`)
}

PrizmClient.prototype.createAgentRule = async function (
  this: PrizmClient,
  input: CreateAgentRuleInput
) {
  return this.request<AgentRule>('/agent-rules', {
    method: 'POST',
    body: JSON.stringify(input)
  })
}

PrizmClient.prototype.updateAgentRule = async function (
  this: PrizmClient,
  id: string,
  level: RuleLevel,
  scope: string | undefined,
  update: UpdateAgentRuleInput
) {
  const params = new URLSearchParams({ level })
  if (scope) params.set('scope', scope)
  return this.request<AgentRule>(`/agent-rules/${encodeURIComponent(id)}?${params.toString()}`, {
    method: 'PATCH',
    body: JSON.stringify(update)
  })
}

PrizmClient.prototype.deleteAgentRule = async function (
  this: PrizmClient,
  id: string,
  level: RuleLevel,
  scope?: string
) {
  const params = new URLSearchParams({ level })
  if (scope) params.set('scope', scope)
  await this.request<void>(`/agent-rules/${encodeURIComponent(id)}?${params.toString()}`, {
    method: 'DELETE'
  })
}
