/**
 * skillManager 单元测试
 * 覆盖：SKILL.md 解析、渐进式加载、CRUD、激活/取消/自动激活
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  loadAllSkillMetadata,
  loadSkillFull,
  createSkill,
  updateSkill,
  deleteSkill,
  listSkillResources,
  readSkillResource,
  activateSkill,
  deactivateSkill,
  getActiveSkills,
  autoActivateSkills,
  importSkillsFromDir,
  discoverImportableSkillSources,
  getSkillsDir
} from './skillManager'
import { resetConfig } from '../config'

// ============ 辅助 ============

let tmpDir: string
let origDataDir: string

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prizm-skill-test-'))
  origDataDir = process.env.PRIZM_DATA_DIR ?? ''
  process.env.PRIZM_DATA_DIR = tmpDir
  resetConfig()
}

function teardown() {
  process.env.PRIZM_DATA_DIR = origDataDir
  resetConfig()
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

function writeSkillMd(name: string, frontmatter: string, body: string) {
  const skillDir = path.join(getSkillsDir(), name)
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}`, 'utf-8')
}

// ============ Level 1: 元数据加载 ============

describe('loadAllSkillMetadata', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('目录不存在返回空', () => {
    expect(loadAllSkillMetadata()).toEqual([])
  })

  it('加载多个 skill 的元数据', () => {
    writeSkillMd(
      'code-review',
      'name: code-review\ndescription: 审查代码质量',
      '# 审查步骤\n1. 检查结构'
    )
    writeSkillMd('data-analysis', 'name: data-analysis\ndescription: 分析数据集', '# 分析步骤')

    const skills = loadAllSkillMetadata()
    expect(skills.length).toBe(2)
    const names = skills.map((s) => s.name).sort()
    expect(names).toEqual(['code-review', 'data-analysis'])
  })

  it('跳过缺少 name/description 的 SKILL.md', () => {
    writeSkillMd('bad-skill', 'name: bad-skill', '缺少 description')

    const skills = loadAllSkillMetadata()
    expect(skills.length).toBe(0)
  })

  it('解析 license、compatibility、allowed-tools', () => {
    writeSkillMd(
      'full',
      'name: full\ndescription: 完整 skill\nlicense: Apache-2.0\ncompatibility: Prizm\nallowed-tools: file_read search',
      '内容'
    )

    const skills = loadAllSkillMetadata()
    expect(skills.length).toBe(1)
    expect(skills[0].license).toBe('Apache-2.0')
    expect(skills[0].compatibility).toBe('Prizm')
    expect(skills[0].allowedTools).toEqual(['file_read', 'search'])
  })

  it('解析 metadata 嵌套字段', () => {
    writeSkillMd(
      'with-meta',
      'name: with-meta\ndescription: 带元数据\nmetadata:\n  author: "test-user"\n  version: "1.0"',
      '内容'
    )

    const skills = loadAllSkillMetadata()
    expect(skills.length).toBe(1)
    expect(skills[0].metadata).toEqual({ author: 'test-user', version: '1.0' })
  })

  it('忽略非目录条目', () => {
    const dir = getSkillsDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'not-a-dir.txt'), 'file')
    writeSkillMd('real-skill', 'name: real-skill\ndescription: ok', 'body')

    const skills = loadAllSkillMetadata()
    expect(skills.length).toBe(1)
  })
})

// ============ Level 2: 完整内容加载 ============

describe('loadSkillFull', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('加载 skill 完整内容包含 body', () => {
    writeSkillMd('test', 'name: test\ndescription: 测试', '# 指令\n详细步骤')

    const full = loadSkillFull('test')
    expect(full).not.toBeNull()
    expect(full!.name).toBe('test')
    expect(full!.body).toContain('# 指令')
    expect(full!.body).toContain('详细步骤')
  })

  it('不存在的 skill 返回 null', () => {
    expect(loadSkillFull('nonexistent')).toBeNull()
  })
})

// ============ Level 3: 资源 ============

describe('skill resources', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('列出 scripts/references/assets', () => {
    writeSkillMd('res-skill', 'name: res-skill\ndescription: 有资源', 'body')
    const base = path.join(getSkillsDir(), 'res-skill')
    fs.mkdirSync(path.join(base, 'scripts'), { recursive: true })
    fs.mkdirSync(path.join(base, 'references'), { recursive: true })
    fs.writeFileSync(path.join(base, 'scripts', 'run.sh'), '#!/bin/bash')
    fs.writeFileSync(path.join(base, 'references', 'doc.md'), '# Doc')

    const res = listSkillResources('res-skill')
    expect(res.scripts).toEqual(['run.sh'])
    expect(res.references).toEqual(['doc.md'])
    expect(res.assets).toEqual([])
  })

  it('读取资源文件内容', () => {
    writeSkillMd('read-res', 'name: read-res\ndescription: 读资源', 'body')
    const base = path.join(getSkillsDir(), 'read-res')
    fs.mkdirSync(path.join(base, 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(base, 'scripts', 'test.py'), 'print("hello")')

    const content = readSkillResource('read-res', 'scripts/test.py')
    expect(content).toBe('print("hello")')
  })

  it('路径遍历攻击返回 null', () => {
    writeSkillMd('safe', 'name: safe\ndescription: 安全', 'body')
    const content = readSkillResource('safe', '../../etc/passwd')
    expect(content).toBeNull()
  })

  it('不存在的资源返回 null', () => {
    writeSkillMd('no-res', 'name: no-res\ndescription: 无资源', 'body')
    expect(readSkillResource('no-res', 'scripts/ghost.sh')).toBeNull()
  })
})

// ============ CRUD ============

describe('skill CRUD', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('createSkill 创建目录和 SKILL.md', () => {
    const skill = createSkill({ name: 'my-skill', description: '我的 skill' }, '# 步骤\n1. 做事')

    expect(skill.name).toBe('my-skill')
    expect(skill.enabled).toBe(true)
    expect(fs.existsSync(path.join(getSkillsDir(), 'my-skill', 'SKILL.md'))).toBe(true)
  })

  it('createSkill 重复名称抛出异常', () => {
    createSkill({ name: 'dup', description: '第一个' }, 'body')
    expect(() => createSkill({ name: 'dup', description: '第二个' }, 'body')).toThrow(
      'already exists'
    )
  })

  it('updateSkill 更新描述和 body', () => {
    createSkill({ name: 'upd', description: '原始' }, '旧内容')
    const updated = updateSkill('upd', { description: '新描述', body: '新内容' })

    expect(updated).not.toBeNull()
    expect(updated!.description).toBe('新描述')
    expect(updated!.body).toBe('新内容')

    // 重新加载验证持久化
    const full = loadSkillFull('upd')
    expect(full!.description).toBe('新描述')
    expect(full!.body).toBe('新内容')
  })

  it('updateSkill 不存在的返回 null', () => {
    expect(updateSkill('ghost', { body: '?' })).toBeNull()
  })

  it('deleteSkill 删除目录', () => {
    createSkill({ name: 'del', description: '待删除' }, 'body')
    expect(deleteSkill('del')).toBe(true)
    expect(loadSkillFull('del')).toBeNull()
  })

  it('deleteSkill 不存在返回 false', () => {
    expect(deleteSkill('nope')).toBe(false)
  })
})

// ============ 会话级激活 ============

describe('skill activation', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('手动激活并获取活跃 skills', () => {
    createSkill({ name: 'act-a', description: '可激活 A' }, '指令 A')

    const activation = activateSkill('default', 'sess1', 'act-a')
    expect(activation).not.toBeNull()
    expect(activation!.skillName).toBe('act-a')
    expect(activation!.autoActivated).toBe(false)
    expect(activation!.instructions).toContain('指令 A')

    const active = getActiveSkills('default', 'sess1')
    expect(active.length).toBe(1)
  })

  it('重复激活同一 skill 返回已有激活', () => {
    createSkill({ name: 'act-dup', description: '重复' }, 'body')

    const first = activateSkill('default', 'sess2', 'act-dup')
    const second = activateSkill('default', 'sess2', 'act-dup')
    expect(first!.activatedAt).toBe(second!.activatedAt)

    const active = getActiveSkills('default', 'sess2')
    expect(active.length).toBe(1)
  })

  it('超过 maxActive 时淘汰最早的', () => {
    for (let i = 1; i <= 4; i++) {
      createSkill({ name: `overflow-${i}`, description: `#${i}` }, `body ${i}`)
    }

    activateSkill('default', 'sess3', 'overflow-1', 3)
    activateSkill('default', 'sess3', 'overflow-2', 3)
    activateSkill('default', 'sess3', 'overflow-3', 3)
    activateSkill('default', 'sess3', 'overflow-4', 3)

    const active = getActiveSkills('default', 'sess3')
    expect(active.length).toBe(3)
    // 最早的 overflow-1 应被淘汰
    expect(active.find((a) => a.skillName === 'overflow-1')).toBeUndefined()
    expect(active.find((a) => a.skillName === 'overflow-4')).toBeDefined()
  })

  it('取消激活', () => {
    createSkill({ name: 'deact', description: '待取消' }, 'body')
    activateSkill('default', 'sess4', 'deact')

    expect(deactivateSkill('default', 'sess4', 'deact')).toBe(true)
    expect(getActiveSkills('default', 'sess4')).toEqual([])
  })

  it('取消不存在的激活返回 false', () => {
    expect(deactivateSkill('default', 'no-sess', 'none')).toBe(false)
  })

  it('不同会话的激活独立', () => {
    createSkill({ name: 'iso', description: '隔离测试' }, 'body')

    activateSkill('default', 'sessA', 'iso')
    expect(getActiveSkills('default', 'sessA').length).toBe(1)
    expect(getActiveSkills('default', 'sessB').length).toBe(0)
  })

  it('激活不存在的 skill 返回 null', () => {
    expect(activateSkill('default', 'sess', 'ghost')).toBeNull()
  })
})

// ============ 自动激活 ============

describe('autoActivateSkills', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('根据关键词匹配自动激活', () => {
    // 使用空格分隔的关键词确保 tokenizer 能正确分词
    createSkill(
      { name: 'code-review', description: 'code review quality bugs improvements' },
      'Review steps...'
    )
    createSkill(
      { name: 'data-viz', description: 'data visualization charts dashboard' },
      'Visualization steps...'
    )

    // 消息包含 code review quality 等关键词 → 匹配 code-review skill
    const activated = autoActivateSkills('default', 'auto1', 'please review the code quality')
    const names = activated.map((a) => a.skillName)
    expect(names).toContain('code-review')
    expect(activated.every((a) => a.autoActivated)).toBe(true)
  })

  it('无 skill 时返回空', () => {
    const result = autoActivateSkills('default', 'auto2', '随便说点什么')
    expect(result).toEqual([])
  })

  it('已激活的 skill 不会重复自动激活', () => {
    createSkill({ name: 'unique', description: '唯一 skill 用于测试唯一激活' }, 'body')
    activateSkill('default', 'auto3', 'unique')

    const result = autoActivateSkills('default', 'auto3', '唯一 skill 测试唯一激活')
    expect(result.length).toBe(0)
  })

  it('消息太短不触发', () => {
    createSkill({ name: 'short', description: '测试短消息' }, 'body')
    const result = autoActivateSkills('default', 'auto4', 'a')
    expect(result).toEqual([])
  })
})

// ============ 导入 ============

describe('importSkillsFromDir', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('从外部目录导入 skills', () => {
    const srcDir = path.join(tmpDir, 'external-skills')
    const skillDir = path.join(srcDir, 'imported-skill')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: imported-skill\ndescription: 导入的 skill\n---\n\n导入内容'
    )

    const imported = importSkillsFromDir(srcDir, 'claude-code')
    expect(imported.length).toBe(1)
    expect(imported[0].name).toBe('imported-skill')
    expect(imported[0].source).toBe('claude-code')

    // 验证已复制到目标目录
    const full = loadSkillFull('imported-skill')
    expect(full).not.toBeNull()
    expect(full!.body).toContain('导入内容')
  })

  it('跳过已存在的同名 skill', () => {
    createSkill({ name: 'existing', description: '已有' }, 'old body')

    const srcDir = path.join(tmpDir, 'dup-src')
    const skillDir = path.join(srcDir, 'existing')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: existing\ndescription: 新的\n---\n\n新 body'
    )

    const imported = importSkillsFromDir(srcDir, 'claude-code')
    expect(imported.length).toBe(0)

    // 原有内容未被覆盖
    const full = loadSkillFull('existing')
    expect(full!.body).toBe('old body')
  })

  it('不存在的源目录返回空', () => {
    expect(importSkillsFromDir('/nope', 'claude-code')).toEqual([])
  })
})
