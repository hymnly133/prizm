/**
 * Slash 命令可扩展注册表
 * 开发时注册内置命令；生产时可从配置加载用户自定义命令
 */

export interface SlashCommandRunOptions {
  scope: string
  sessionId?: string
  args: string[]
}

export interface SlashCommandDef {
  name: string
  aliases?: string[]
  description: string
  run(options: SlashCommandRunOptions): Promise<string>
  builtin: boolean
  /** prompt: 注入 LLM 上下文由 LLM 生成回复; action: 直接返回结果（默认 action 兼容旧命令） */
  mode?: 'prompt' | 'action'
  /** 允许的工具列表（兼容 Claude Code allowed-tools） */
  allowedTools?: string[]
}

const registry = new Map<string, SlashCommandDef>()
const aliasToName = new Map<string, string>()

function registerAliases(name: string, aliases: string[]): void {
  for (const a of aliases) {
    aliasToName.set(a.toLowerCase(), name)
  }
}

function unregisterAliases(name: string, def: SlashCommandDef): void {
  if (def.aliases) {
    for (const a of def.aliases) {
      if (aliasToName.get(a.toLowerCase()) === name) aliasToName.delete(a.toLowerCase())
    }
  }
}

export function registerSlashCommand(def: SlashCommandDef): void {
  const name = def.name.toLowerCase()
  const existing = registry.get(name)
  if (existing) unregisterAliases(name, existing)
  registry.set(name, def)
  if (def.aliases?.length) registerAliases(name, def.aliases)
}

export function unregisterSlashCommand(name: string): void {
  const n = name.toLowerCase()
  const def = registry.get(n)
  if (def) {
    unregisterAliases(n, def)
    registry.delete(n)
  }
}

export function getSlashCommand(nameOrAlias: string): SlashCommandDef | null {
  const n = nameOrAlias.toLowerCase()
  const resolved =
    registry.get(n) ?? (aliasToName.has(n) ? registry.get(aliasToName.get(n)!) : null)
  return resolved ?? null
}

export function listSlashCommands(): SlashCommandDef[] {
  return Array.from(registry.values())
}

/** 解析消息首 token 是否为 slash 命令；返回命令名与剩余 args */
export function parseSlashMessage(message: string): { name: string; args: string[] } | null {
  const trimmed = message.trim()
  if (!trimmed.startsWith('/')) return null
  const rest = trimmed.slice(1).trim()
  const idx = rest.search(/\s/)
  const name = idx >= 0 ? rest.slice(0, idx) : rest
  const args = idx >= 0 ? rest.slice(idx).trim().split(/\s+/).filter(Boolean) : []
  return name ? { name: name.toLowerCase(), args } : null
}
