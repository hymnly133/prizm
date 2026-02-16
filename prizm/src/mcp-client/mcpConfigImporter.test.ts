/**
 * mcpConfigImporter 单元测试
 * 覆盖：Cursor/Claude Code/VS Code 格式导入转换、发现
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { importMcpConfigFromFile, discoverMcpConfigFiles } from './mcpConfigImporter'

let tmpDir: string

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prizm-mcp-test-'))
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

// ============ stdio 导入 ============

describe('importMcpConfigFromFile - stdio', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('Cursor 格式 stdio 服务器', () => {
    const config = {
      mcpServers: {
        'my-server': {
          command: 'npx',
          args: ['-y', '@my/mcp-server'],
          env: { API_KEY: 'test-key' }
        }
      }
    }
    const filePath = path.join(tmpDir, 'mcp.json')
    fs.writeFileSync(filePath, JSON.stringify(config))

    const result = importMcpConfigFromFile(filePath)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('my-server')
    expect(result[0].name).toBe('my-server')
    expect(result[0].transport).toBe('stdio')
    expect(result[0].stdio?.command).toBe('npx')
    expect(result[0].stdio?.args).toEqual(['-y', '@my/mcp-server'])
    expect(result[0].stdio?.env).toEqual({ API_KEY: 'test-key' })
    expect(result[0].enabled).toBe(true)
  })

  it('Claude Code 格式 stdio', () => {
    const config = {
      mcpServers: {
        filesystem: {
          command: 'mcp-server-filesystem',
          args: ['/home/user/projects']
        }
      }
    }
    const filePath = path.join(tmpDir, '.mcp.json')
    fs.writeFileSync(filePath, JSON.stringify(config))

    const result = importMcpConfigFromFile(filePath)
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('filesystem')
    expect(result[0].transport).toBe('stdio')
    expect(result[0].stdio?.command).toBe('mcp-server-filesystem')
  })

  it('多个 stdio 服务器', () => {
    const config = {
      mcpServers: {
        server1: { command: 'cmd1', args: ['--arg1'] },
        server2: { command: 'cmd2' },
        server3: { command: 'cmd3', args: ['a', 'b'], env: { X: '1' } }
      }
    }
    const filePath = path.join(tmpDir, 'multi.json')
    fs.writeFileSync(filePath, JSON.stringify(config))

    const result = importMcpConfigFromFile(filePath)
    expect(result.length).toBe(3)
    expect(result.map((r) => r.name).sort()).toEqual(['server1', 'server2', 'server3'])
  })
})

// ============ HTTP/SSE 导入 ============

describe('importMcpConfigFromFile - http/sse', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('URL 服务器默认为 streamable-http', () => {
    const config = {
      mcpServers: {
        remote: {
          url: 'https://api.example.com/mcp',
          headers: { Authorization: 'Bearer token123' }
        }
      }
    }
    const filePath = path.join(tmpDir, 'http.json')
    fs.writeFileSync(filePath, JSON.stringify(config))

    const result = importMcpConfigFromFile(filePath)
    expect(result.length).toBe(1)
    expect(result[0].transport).toBe('streamable-http')
    expect(result[0].url).toBe('https://api.example.com/mcp')
    expect(result[0].headers).toEqual({ Authorization: 'Bearer token123' })
  })

  it('VS Code 格式 type=sse', () => {
    const config = {
      mcpServers: {
        'sse-server': {
          type: 'sse',
          url: 'https://sse.example.com/events'
        }
      }
    }
    const filePath = path.join(tmpDir, 'vscode-mcp.json')
    fs.writeFileSync(filePath, JSON.stringify(config))

    const result = importMcpConfigFromFile(filePath)
    expect(result.length).toBe(1)
    expect(result[0].transport).toBe('sse')
    expect(result[0].url).toBe('https://sse.example.com/events')
  })

  it('混合 stdio + http 服务器', () => {
    const config = {
      mcpServers: {
        local: { command: 'mcp-local', args: [] },
        remote: { url: 'https://remote.com/mcp' }
      }
    }
    const filePath = path.join(tmpDir, 'mixed.json')
    fs.writeFileSync(filePath, JSON.stringify(config))

    const result = importMcpConfigFromFile(filePath)
    expect(result.length).toBe(2)
    const local = result.find((r) => r.name === 'local')!
    const remote = result.find((r) => r.name === 'remote')!
    expect(local.transport).toBe('stdio')
    expect(remote.transport).toBe('streamable-http')
  })
})

// ============ 边界和错误 ============

describe('importMcpConfigFromFile - 边界', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('文件不存在抛出异常', () => {
    expect(() => importMcpConfigFromFile('/nonexistent/mcp.json')).toThrow('File not found')
  })

  it('无效 JSON 抛出异常', () => {
    const filePath = path.join(tmpDir, 'bad.json')
    fs.writeFileSync(filePath, '{ not valid json }')

    expect(() => importMcpConfigFromFile(filePath)).toThrow('Failed to parse')
  })

  it('空 mcpServers 返回空数组', () => {
    const filePath = path.join(tmpDir, 'empty.json')
    fs.writeFileSync(filePath, JSON.stringify({ mcpServers: {} }))

    const result = importMcpConfigFromFile(filePath)
    expect(result).toEqual([])
  })

  it('无 mcpServers 字段返回空', () => {
    const filePath = path.join(tmpDir, 'no-key.json')
    fs.writeFileSync(filePath, JSON.stringify({ other: 'data' }))

    const result = importMcpConfigFromFile(filePath)
    expect(result).toEqual([])
  })

  it('无 command 和 url 的条目被跳过', () => {
    const config = {
      mcpServers: {
        valid: { command: 'test' },
        invalid: { description: 'no command or url' }
      }
    }
    const filePath = path.join(tmpDir, 'partial.json')
    fs.writeFileSync(filePath, JSON.stringify(config))

    const result = importMcpConfigFromFile(filePath)
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('valid')
  })

  it('ID 规范化：特殊字符替换为连字符并小写', () => {
    const config = {
      mcpServers: {
        'My Server (v2)': { command: 'test' }
      }
    }
    const filePath = path.join(tmpDir, 'special.json')
    fs.writeFileSync(filePath, JSON.stringify(config))

    const result = importMcpConfigFromFile(filePath)
    expect(result[0].id).toBe('my-server--v2-')
    expect(result[0].name).toBe('My Server (v2)')
  })

  it('args 非数组时不崩溃', () => {
    const config = {
      mcpServers: {
        test: { command: 'cmd', args: 'not-an-array' }
      }
    }
    const filePath = path.join(tmpDir, 'bad-args.json')
    fs.writeFileSync(filePath, JSON.stringify(config))

    const result = importMcpConfigFromFile(filePath)
    expect(result.length).toBe(1)
    expect(result[0].stdio?.args).toBeUndefined()
  })
})

// ============ 发现功能 ============

describe('discoverMcpConfigFiles', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('发现 .cursor/mcp.json', () => {
    const dir = path.join(tmpDir, '.cursor')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'mcp.json'),
      JSON.stringify({ mcpServers: { s1: { command: 'x' } } })
    )

    const results = discoverMcpConfigFiles(tmpDir)
    // 过滤仅项目级结果（排除用户级 ~/.cursor/mcp.json）
    const projectCursor = results.find((r) => r.source === 'cursor' && r.path.startsWith(tmpDir))
    expect(projectCursor).toBeDefined()
    expect(projectCursor!.serverCount).toBe(1)
  })

  it('发现 .mcp.json (Claude Code)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { a: { command: 'a' }, b: { command: 'b' } } })
    )

    const results = discoverMcpConfigFiles(tmpDir)
    const claude = results.find((r) => r.source === 'claude-code')
    expect(claude).toBeDefined()
    expect(claude!.serverCount).toBe(2)
  })

  it('发现 .vscode/mcp.json', () => {
    const dir = path.join(tmpDir, '.vscode')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'mcp.json'),
      JSON.stringify({ mcpServers: { vs: { type: 'stdio', command: 'x' } } })
    )

    const results = discoverMcpConfigFiles(tmpDir)
    const vscode = results.find((r) => r.source === 'vscode')
    expect(vscode).toBeDefined()
    expect(vscode!.serverCount).toBe(1)
  })

  it('空项目返回空', () => {
    const results = discoverMcpConfigFiles(tmpDir)
    // 可能包含用户级 (~/.cursor/mcp.json)，但不包含项目级
    const projectLevel = results.filter((r) => r.path.startsWith(tmpDir))
    expect(projectLevel).toEqual([])
  })

  it('空 mcpServers 不计入', () => {
    fs.writeFileSync(path.join(tmpDir, '.mcp.json'), JSON.stringify({ mcpServers: {} }))

    const results = discoverMcpConfigFiles(tmpDir)
    const claude = results.find((r) => r.source === 'claude-code' && r.path.startsWith(tmpDir))
    expect(claude).toBeUndefined()
  })

  it('无效 JSON 文件不崩溃', () => {
    fs.writeFileSync(path.join(tmpDir, '.mcp.json'), '{ broken json')

    const results = discoverMcpConfigFiles(tmpDir)
    const claude = results.find((r) => r.source === 'claude-code' && r.path.startsWith(tmpDir))
    expect(claude).toBeUndefined()
  })
})
