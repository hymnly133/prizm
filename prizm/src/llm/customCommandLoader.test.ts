/**
 * customCommandLoader 单元测试
 * 覆盖：frontmatter 解析、模板变量替换、CRUD 操作、导入
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  replaceTemplateVariables,
  loadAllCustomCommands,
  getCustomCommand,
  saveCustomCommand,
  deleteCustomCommand,
  importCommandsFromDir,
  discoverImportableSources,
  getCommandsDir,
  type CustomCommandConfig
} from './customCommandLoader'
import { resetConfig } from '../config'

// ============ 模板变量替换（纯函数，无 I/O） ============

describe('replaceTemplateVariables', () => {
  it('替换 $ARGUMENTS 为所有参数', () => {
    const result = replaceTemplateVariables('请审查: $ARGUMENTS', ['hello', 'world'])
    expect(result).toBe('请审查: hello world')
  })

  it('替换 {{args}} 为所有参数', () => {
    const result = replaceTemplateVariables('输入: {{args}}', ['foo', 'bar'])
    expect(result).toBe('输入: foo bar')
  })

  it('替换位置参数 $1, $2', () => {
    const result = replaceTemplateVariables('文件: $1, 语言: $2', ['main.ts', 'typescript'])
    expect(result).toBe('文件: main.ts, 语言: typescript')
  })

  it('清理未替换的位置参数', () => {
    const result = replaceTemplateVariables('$1 $2 $3', ['only-one'])
    expect(result).toBe('only-one  ')
  })

  it('同时替换 $ARGUMENTS 和位置参数', () => {
    const result = replaceTemplateVariables('全部=$ARGUMENTS 第一个=$1', ['a', 'b'])
    expect(result).toBe('全部=a b 第一个=a')
  })

  it('空参数数组时 $ARGUMENTS 替换为空', () => {
    const result = replaceTemplateVariables('内容: $ARGUMENTS', [])
    expect(result).toBe('内容: ')
  })

  it('多次出现的变量全部替换', () => {
    const result = replaceTemplateVariables('$1 和 $1', ['x'])
    expect(result).toBe('x 和 x')
  })

  it('不含变量的模板原样返回', () => {
    const result = replaceTemplateVariables('纯文本内容', ['arg'])
    expect(result).toBe('纯文本内容')
  })
})

// ============ 文件 I/O 操作（使用临时目录） ============

describe('customCommandLoader CRUD', () => {
  let tmpDir: string
  let origDataDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prizm-cmd-test-'))
    origDataDir = process.env.PRIZM_DATA_DIR ?? ''
    process.env.PRIZM_DATA_DIR = tmpDir
    resetConfig()
  })

  afterEach(() => {
    process.env.PRIZM_DATA_DIR = origDataDir
    resetConfig()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('命令目录不存在时 loadAll 返回空数组', () => {
    const result = loadAllCustomCommands()
    expect(result).toEqual([])
  })

  it('saveCustomCommand 创建文件，getCustomCommand 读回', () => {
    const cmd: CustomCommandConfig = {
      id: 'review-code',
      name: '代码审查',
      description: '审查代码质量',
      mode: 'prompt',
      aliases: ['审查', 'review'],
      allowedTools: ['prizm_file_read', 'prizm_search'],
      content: '请审查以下代码:\n$ARGUMENTS',
      source: 'prizm',
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    saveCustomCommand(cmd)

    // 文件应存在
    const filePath = path.join(getCommandsDir(), 'review-code.md')
    expect(fs.existsSync(filePath)).toBe(true)

    // 读回
    const loaded = getCustomCommand('review-code')
    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe('review-code')
    expect(loaded!.name).toBe('代码审查')
    expect(loaded!.description).toBe('审查代码质量')
    expect(loaded!.mode).toBe('prompt')
    expect(loaded!.aliases).toEqual(['审查', 'review'])
    expect(loaded!.allowedTools).toEqual(['prizm_file_read', 'prizm_search'])
    expect(loaded!.content).toContain('请审查以下代码')
  })

  it('不存在的命令返回 null', () => {
    const result = getCustomCommand('nonexistent')
    expect(result).toBeNull()
  })

  it('saveCustomCommand 纯内容（无 frontmatter）', () => {
    const cmd: CustomCommandConfig = {
      id: 'simple',
      name: 'simple',
      mode: 'prompt',
      content: '简单命令内容',
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    saveCustomCommand(cmd)
    const raw = fs.readFileSync(path.join(getCommandsDir(), 'simple.md'), 'utf-8')
    // name === id 且无其它元数据，不生成 frontmatter
    expect(raw.startsWith('---')).toBe(false)
    expect(raw.trim()).toBe('简单命令内容')
  })

  it('saveCustomCommand 带 action mode 生成 frontmatter', () => {
    const cmd: CustomCommandConfig = {
      id: 'quick',
      name: 'quick',
      mode: 'action',
      content: '快捷操作',
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    saveCustomCommand(cmd)
    const raw = fs.readFileSync(path.join(getCommandsDir(), 'quick.md'), 'utf-8')
    expect(raw.startsWith('---')).toBe(true)
    expect(raw).toContain('mode: action')
  })

  it('deleteCustomCommand 删除已有文件', () => {
    const cmd: CustomCommandConfig = {
      id: 'to-delete',
      name: 'to-delete',
      mode: 'prompt',
      content: 'will be deleted',
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    saveCustomCommand(cmd)
    expect(getCustomCommand('to-delete')).not.toBeNull()

    const result = deleteCustomCommand('to-delete')
    expect(result).toBe(true)
    expect(getCustomCommand('to-delete')).toBeNull()
  })

  it('deleteCustomCommand 不存在的返回 false', () => {
    const result = deleteCustomCommand('ghost')
    expect(result).toBe(false)
  })

  it('loadAllCustomCommands 加载多个命令', () => {
    for (const id of ['cmd-a', 'cmd-b', 'cmd-c']) {
      saveCustomCommand({
        id,
        name: id,
        mode: 'prompt',
        content: `content of ${id}`,
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
    }

    const all = loadAllCustomCommands()
    expect(all.length).toBe(3)
    const ids = all.map((c) => c.id).sort()
    expect(ids).toEqual(['cmd-a', 'cmd-b', 'cmd-c'])
  })

  it('disabled 命令也会被加载（enabled=false）', () => {
    saveCustomCommand({
      id: 'disabled-cmd',
      name: 'disabled-cmd',
      mode: 'prompt',
      content: 'off',
      enabled: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const cmd = getCustomCommand('disabled-cmd')
    expect(cmd).not.toBeNull()
    expect(cmd!.enabled).toBe(false)
  })
})

// ============ 导入功能 ============

describe('importCommandsFromDir', () => {
  let tmpDir: string
  let srcDir: string
  let origDataDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prizm-import-test-'))
    srcDir = path.join(tmpDir, 'source')
    fs.mkdirSync(srcDir, { recursive: true })
    origDataDir = process.env.PRIZM_DATA_DIR ?? ''
    process.env.PRIZM_DATA_DIR = path.join(tmpDir, 'data')
    resetConfig()
  })

  afterEach(() => {
    process.env.PRIZM_DATA_DIR = origDataDir
    resetConfig()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('从 Cursor 格式目录导入（纯 Markdown，无 frontmatter）', () => {
    fs.writeFileSync(path.join(srcDir, 'gen-tests.md'), '为以下代码生成测试:\n$ARGUMENTS')

    const imported = importCommandsFromDir(srcDir, 'cursor')
    expect(imported.length).toBe(1)
    expect(imported[0].id).toBe('gen-tests')
    expect(imported[0].source).toBe('cursor')
    expect(imported[0].mode).toBe('prompt')
    expect(imported[0].content).toContain('$ARGUMENTS')

    // 验证已写入目标目录
    const loaded = loadAllCustomCommands()
    expect(loaded.length).toBe(1)
  })

  it('从 Claude Code 格式目录导入（带 frontmatter）', () => {
    fs.writeFileSync(
      path.join(srcDir, 'explain.md'),
      `---
name: explain-code
description: 解释代码功能
allowed-tools: file_read search
---

请解释以下代码的功能:
$ARGUMENTS`
    )

    const imported = importCommandsFromDir(srcDir, 'claude-code')
    expect(imported.length).toBe(1)
    expect(imported[0].name).toBe('explain-code')
    expect(imported[0].description).toBe('解释代码功能')
    expect(imported[0].allowedTools).toEqual(['file_read', 'search'])
    expect(imported[0].source).toBe('claude-code')
  })

  it('不存在的目录返回空数组', () => {
    const result = importCommandsFromDir('/nonexistent/path', 'cursor')
    expect(result).toEqual([])
  })

  it('忽略非 .md 文件', () => {
    fs.writeFileSync(path.join(srcDir, 'readme.txt'), 'not a command')
    fs.writeFileSync(path.join(srcDir, 'valid.md'), 'a command')

    const imported = importCommandsFromDir(srcDir, 'cursor')
    expect(imported.length).toBe(1)
    expect(imported[0].id).toBe('valid')
  })
})

// ============ 发现功能 ============

describe('discoverImportableSources', () => {
  let tmpDir: string
  let cwdSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prizm-discover-test-'))
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
  })

  afterEach(() => {
    cwdSpy.mockRestore()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('发现 .cursor/commands/ 目录', () => {
    const cursorDir = path.join(tmpDir, '.cursor', 'commands')
    fs.mkdirSync(cursorDir, { recursive: true })
    fs.writeFileSync(path.join(cursorDir, 'test.md'), 'test')

    const sources = discoverImportableSources(tmpDir)
    const cursor = sources.find((s) => s.source === 'cursor')
    expect(cursor).toBeDefined()
    expect(cursor!.count).toBe(1)
  })

  it('发现 .claude/commands/ 目录', () => {
    const claudeDir = path.join(tmpDir, '.claude', 'commands')
    fs.mkdirSync(claudeDir, { recursive: true })
    fs.writeFileSync(path.join(claudeDir, 'a.md'), 'a')
    fs.writeFileSync(path.join(claudeDir, 'b.md'), 'b')

    const sources = discoverImportableSources(tmpDir)
    const claude = sources.find((s) => s.source === 'claude-code')
    expect(claude).toBeDefined()
    expect(claude!.count).toBe(2)
  })

  it('目录不存在时返回空', () => {
    const sources = discoverImportableSources(path.join(tmpDir, 'nonexistent'))
    expect(sources).toEqual([])
  })
})

// ============ Frontmatter 边界情况 ============

describe('frontmatter 解析边界', () => {
  let tmpDir: string
  let origDataDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prizm-fm-test-'))
    origDataDir = process.env.PRIZM_DATA_DIR ?? ''
    process.env.PRIZM_DATA_DIR = tmpDir
    resetConfig()
  })

  afterEach(() => {
    process.env.PRIZM_DATA_DIR = origDataDir
    resetConfig()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('未闭合的 frontmatter 当作纯内容', () => {
    const dir = getCommandsDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'broken.md'), '---\nname: test\n没有关闭的 frontmatter')

    const cmd = getCustomCommand('broken')
    expect(cmd).not.toBeNull()
    // body 包含整个内容（含未闭合的 ---）
    expect(cmd!.content).toContain('没有关闭的 frontmatter')
  })

  it('数组值 aliases 正确解析', () => {
    const dir = getCommandsDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'with-aliases.md'),
      '---\naliases: [审查, review, check]\n---\n\n内容'
    )

    const cmd = getCustomCommand('with-aliases')
    expect(cmd).not.toBeNull()
    expect(cmd!.aliases).toEqual(['审查', 'review', 'check'])
  })

  it('boolean 值正确解析', () => {
    const dir = getCommandsDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'bool-test.md'), '---\nenabled: false\n---\n\n内容')

    const cmd = getCustomCommand('bool-test')
    expect(cmd).not.toBeNull()
    expect(cmd!.enabled).toBe(false)
  })
})
