/**
 * rulesLoader 单元测试
 * 覆盖：多格式规则发现、解析、合并、token 预算、缓存、.mdc frontmatter
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { loadRules, listDiscoveredRules, clearRulesCache } from './rulesLoader'

let tmpDir: string

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prizm-rules-test-'))
  clearRulesCache()
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  clearRulesCache()
}

// ============ 基础发现 ============

describe('loadRules - 单文件格式', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('无规则文件时返回 null', () => {
    const result = loadRules(tmpDir)
    expect(result).toBeNull()
  })

  it('加载 AGENTS.md', () => {
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# Rules\n- 规则一\n- 规则二')

    const result = loadRules(tmpDir)
    expect(result).not.toBeNull()
    expect(result).toContain('规则一')
    expect(result).toContain('agents-md')
  })

  it('加载 CLAUDE.md', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '使用 TypeScript strict 模式')

    const result = loadRules(tmpDir)
    expect(result).not.toBeNull()
    expect(result).toContain('TypeScript strict')
    expect(result).toContain('claude-code')
  })

  it('加载 CONVENTIONS.md (Aider)', () => {
    fs.writeFileSync(path.join(tmpDir, 'CONVENTIONS.md'), '代码约定内容')

    const result = loadRules(tmpDir)
    expect(result).not.toBeNull()
    expect(result).toContain('代码约定内容')
    expect(result).toContain('aider')
  })

  it('加载 .windsurfrules (Windsurf)', () => {
    fs.writeFileSync(path.join(tmpDir, '.windsurfrules'), 'windsurf 规则')

    const result = loadRules(tmpDir)
    expect(result).not.toBeNull()
    expect(result).toContain('windsurf 规则')
  })

  it('加载 .github/copilot-instructions.md (GitHub Copilot)', () => {
    const dir = path.join(tmpDir, '.github')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'copilot-instructions.md'), 'copilot 指令')

    const result = loadRules(tmpDir)
    expect(result).not.toBeNull()
    expect(result).toContain('copilot 指令')
  })

  it('加载 GEMINI.md 并解析 @import', () => {
    fs.writeFileSync(path.join(tmpDir, 'extra.md'), '导入的内容')
    fs.writeFileSync(path.join(tmpDir, 'GEMINI.md'), '# Gemini Rules\n@extra.md')

    const result = loadRules(tmpDir)
    expect(result).not.toBeNull()
    expect(result).toContain('导入的内容')
  })

  it('GEMINI.md @import 不存在的文件不崩溃', () => {
    fs.writeFileSync(path.join(tmpDir, 'GEMINI.md'), '@nonexistent.md\n正常内容')

    const result = loadRules(tmpDir)
    expect(result).not.toBeNull()
    expect(result).toContain('Not found')
    expect(result).toContain('正常内容')
  })
})

// ============ 目录格式 ============

describe('loadRules - 目录格式', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('加载 .cursor/rules/*.mdc (alwaysApply)', () => {
    const dir = path.join(tmpDir, '.cursor', 'rules')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'ts-rules.mdc'),
      '---\nalwaysApply: true\ndescription: TS 规范\n---\n\n使用 strict 模式'
    )

    const result = loadRules(tmpDir)
    expect(result).not.toBeNull()
    expect(result).toContain('使用 strict 模式')
  })

  it('跳过 alwaysApply=false 且无 globs 的 .mdc', () => {
    const dir = path.join(tmpDir, '.cursor', 'rules')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'conditional.mdc'), '---\nalwaysApply: false\n---\n\n不应加载')

    const result = loadRules(tmpDir)
    expect(result).toBeNull()
  })

  it('加载 .clinerules/*.md', () => {
    const dir = path.join(tmpDir, '.clinerules')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'rule1.md'), 'Cline 规则内容')

    const result = loadRules(tmpDir)
    expect(result).not.toBeNull()
    expect(result).toContain('Cline 规则内容')
  })

  it('加载 .roo/rules/*.md', () => {
    const dir = path.join(tmpDir, '.roo', 'rules')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, '01-base.md'), 'Roo 规则')

    const result = loadRules(tmpDir)
    expect(result).not.toBeNull()
    expect(result).toContain('Roo 规则')
  })
})

// ============ 优先级和合并 ============

describe('loadRules - 优先级合并', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('AGENTS.md 优先级高于 CLAUDE.md', () => {
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), 'AGENTS 规则')
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), 'CLAUDE 规则')

    const result = loadRules(tmpDir)!
    const agentsPos = result.indexOf('AGENTS 规则')
    const claudePos = result.indexOf('CLAUDE 规则')
    // AGENTS 应出现在 CLAUDE 之前
    expect(agentsPos).toBeLessThan(claudePos)
  })

  it('多个来源合并标注来源', () => {
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '规则A')
    fs.writeFileSync(path.join(tmpDir, 'CONVENTIONS.md'), '规则B')

    const result = loadRules(tmpDir)!
    expect(result).toContain('agents-md')
    expect(result).toContain('aider')
  })
})

// ============ Token 预算 ============

describe('loadRules - token 预算', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('超出 token 预算时截断低优先级规则', () => {
    // AGENTS.md ~10 tokens, CLAUDE.md ~10 tokens
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '高优先级规则内容')
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '低优先级规则内容ABC')

    // 给一个只够容纳第一个规则的 token 预算
    // estimateTokens = ceil(chars / 2), "高优先级规则内容" = 8 chars → 4 tokens
    const result = loadRules(tmpDir, 6)
    expect(result).not.toBeNull()
    // 高优先级的 AGENTS.md 应包含
    expect(result).toContain('高优先级规则内容')
    // 低优先级的 CLAUDE.md 被截断
    expect(result).not.toContain('低优先级规则内容ABC')
  })

  it('极小 token 预算（1）不崩溃', () => {
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '内容')
    const result = loadRules(tmpDir, 1)
    expect(result).not.toBeNull()
  })
})

// ============ 缓存 ============

describe('loadRules - 缓存', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('连续调用使用缓存', () => {
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '缓存测试')

    const r1 = loadRules(tmpDir)
    const r2 = loadRules(tmpDir)
    // 结果相同
    expect(r1).toBe(r2)
  })

  it('clearRulesCache 后重新加载', () => {
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '原始内容')
    loadRules(tmpDir)

    // 修改文件并清缓存
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '新内容')
    clearRulesCache()

    const result = loadRules(tmpDir)
    expect(result).toContain('新内容')
  })
})

// ============ listDiscoveredRules ============

describe('listDiscoveredRules', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('返回规则列表含 source/tool/priority/tokens', () => {
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '测试规则')

    const rules = listDiscoveredRules(tmpDir)
    expect(rules.length).toBe(1)
    expect(rules[0].tool).toBe('agents-md')
    expect(rules[0].priority).toBe(1)
    expect(rules[0].tokens).toBeGreaterThan(0)
  })

  it('空项目返回空', () => {
    const rules = listDiscoveredRules(tmpDir)
    expect(rules).toEqual([])
  })
})
