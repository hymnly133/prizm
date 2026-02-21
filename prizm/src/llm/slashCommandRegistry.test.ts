import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerSlashCommand,
  unregisterSlashCommand,
  getSlashCommand,
  listSlashCommands,
  clearNonBuiltinCommands,
  parseSlashMessage,
  type SlashCommandDef
} from './slashCommandRegistry'

function makeDef(overrides: Partial<SlashCommandDef> & { name: string }): SlashCommandDef {
  return {
    description: 'test',
    builtin: false,
    run: async () => 'ok',
    ...overrides
  }
}

beforeEach(() => {
  for (const cmd of listSlashCommands()) {
    unregisterSlashCommand(cmd.name)
  }
})

describe('registerSlashCommand / getSlashCommand', () => {
  it('registers and retrieves a command by name', () => {
    registerSlashCommand(makeDef({ name: 'hello' }))
    expect(getSlashCommand('hello')).not.toBeNull()
    expect(getSlashCommand('hello')!.name).toBe('hello')
  })

  it('name lookup is case-insensitive', () => {
    registerSlashCommand(makeDef({ name: 'Hello' }))
    expect(getSlashCommand('hello')).not.toBeNull()
    expect(getSlashCommand('HELLO')).not.toBeNull()
  })

  it('resolves aliases', () => {
    registerSlashCommand(makeDef({ name: 'notes', aliases: ['便签', 'n'] }))
    expect(getSlashCommand('便签')).not.toBeNull()
    expect(getSlashCommand('n')).not.toBeNull()
    expect(getSlashCommand('便签')!.name).toBe('notes')
  })

  it('returns null for unknown command', () => {
    expect(getSlashCommand('nonexistent')).toBeNull()
  })

  it('overwriting a command replaces old aliases', () => {
    registerSlashCommand(makeDef({ name: 'foo', aliases: ['bar'] }))
    expect(getSlashCommand('bar')).not.toBeNull()

    registerSlashCommand(makeDef({ name: 'foo', aliases: ['baz'] }))
    expect(getSlashCommand('bar')).toBeNull()
    expect(getSlashCommand('baz')).not.toBeNull()
  })
})

describe('unregisterSlashCommand', () => {
  it('removes a command and its aliases', () => {
    registerSlashCommand(makeDef({ name: 'temp', aliases: ['t'] }))
    expect(getSlashCommand('temp')).not.toBeNull()
    expect(getSlashCommand('t')).not.toBeNull()

    unregisterSlashCommand('temp')
    expect(getSlashCommand('temp')).toBeNull()
    expect(getSlashCommand('t')).toBeNull()
  })

  it('is a no-op for unknown command', () => {
    expect(() => unregisterSlashCommand('ghost')).not.toThrow()
  })
})

describe('listSlashCommands', () => {
  it('returns all registered commands', () => {
    registerSlashCommand(makeDef({ name: 'a' }))
    registerSlashCommand(makeDef({ name: 'b' }))
    const names = listSlashCommands().map((c) => c.name)
    expect(names).toContain('a')
    expect(names).toContain('b')
  })
})

describe('clearNonBuiltinCommands', () => {
  it('removes non-builtin commands and keeps builtin ones', () => {
    registerSlashCommand(makeDef({ name: 'builtin-cmd', builtin: true }))
    registerSlashCommand(makeDef({ name: 'custom-cmd', builtin: false, aliases: ['cc'] }))
    expect(listSlashCommands()).toHaveLength(2)

    clearNonBuiltinCommands()
    expect(listSlashCommands()).toHaveLength(1)
    expect(getSlashCommand('builtin-cmd')).not.toBeNull()
    expect(getSlashCommand('custom-cmd')).toBeNull()
    expect(getSlashCommand('cc')).toBeNull()
  })
})

describe('parseSlashMessage', () => {
  it('parses simple /cmd', () => {
    const result = parseSlashMessage('/help')
    expect(result).toEqual({ name: 'help', args: [] })
  })

  it('parses /cmd with args', () => {
    const result = parseSlashMessage('/search hello world')
    expect(result).toEqual({ name: 'search', args: ['hello', 'world'] })
  })

  it('returns null for non-slash message', () => {
    expect(parseSlashMessage('hello')).toBeNull()
    expect(parseSlashMessage('')).toBeNull()
  })

  it('returns null for bare slash', () => {
    expect(parseSlashMessage('/')).toBeNull()
    expect(parseSlashMessage('/  ')).toBeNull()
  })

  it('is case-insensitive for command name', () => {
    const result = parseSlashMessage('/HELP')
    expect(result).toEqual({ name: 'help', args: [] })
  })

  it('handles leading whitespace', () => {
    const result = parseSlashMessage('  /help')
    expect(result).toEqual({ name: 'help', args: [] })
  })

  it('parses bracket format /(cmd)', () => {
    const result = parseSlashMessage('/(help)')
    expect(result).toEqual({ name: 'help', args: [] })
  })

  it('parses bracket format /(cmd args)', () => {
    const result = parseSlashMessage('/(skill list)')
    expect(result).toEqual({ name: 'skill', args: ['list'] })
  })

  it('parses bracket format with multiple args', () => {
    const result = parseSlashMessage('/(skill off my-skill)')
    expect(result).toEqual({ name: 'skill', args: ['off', 'my-skill'] })
  })

  it('handles bracket format with leading whitespace', () => {
    const result = parseSlashMessage('  /(help)')
    expect(result).toEqual({ name: 'help', args: [] })
  })

  it('returns null for empty bracket /()', () => {
    expect(parseSlashMessage('/()')).toBeNull()
  })
})
