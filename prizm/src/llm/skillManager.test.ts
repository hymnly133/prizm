/**
 * skillManager 单元测试
 * 覆盖：SKILL.md 解析、渐进式加载、CRUD、getSkillsToInject、导入发现
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
  getSkillFileTree,
  getSkillsToInject,
  getSkillsMetadataForDiscovery,
  importSkillsFromDir,
  discoverImportableSkillSources,
  getSkillsDir,
  getInstalledRegistryKeys
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

// ============ getSkillFileTree ============

describe('getSkillFileTree', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('不存在的 skill 返回 null', () => {
    expect(getSkillFileTree('nope')).toBeNull()
  })

  it('仅 SKILL.md 时返回根级 SKILL.md', () => {
    writeSkillMd('minimal', 'name: minimal\ndescription: 最小', 'body')
    const tree = getSkillFileTree('minimal')
    expect(tree).toEqual({ 'SKILL.md': 'file' })
  })

  it('含 scripts/references/assets 时返回完整树', () => {
    writeSkillMd('tree-skill', 'name: tree-skill\ndescription: 树', 'body')
    const base = path.join(getSkillsDir(), 'tree-skill')
    fs.mkdirSync(path.join(base, 'scripts'), { recursive: true })
    fs.mkdirSync(path.join(base, 'references'), { recursive: true })
    fs.writeFileSync(path.join(base, 'scripts', 'run.sh'), '')
    fs.writeFileSync(path.join(base, 'references', 'doc.md'), '')
    const tree = getSkillFileTree('tree-skill')
    expect(tree).toHaveProperty('SKILL.md', 'file')
    expect(tree).toHaveProperty('scripts')
    expect((tree as Record<string, unknown>).scripts).toEqual({ 'run.sh': 'file' })
    expect(tree).toHaveProperty('references')
    expect((tree as Record<string, unknown>).references).toEqual({ 'doc.md': 'file' })
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

  it('createSkill 带 origin 时持久化并可通过 getInstalledRegistryKeys 查出', () => {
    const origin = {
      source: 'github' as const,
      owner: 'foo',
      repo: 'bar',
      skillPath: 'skills/code-review'
    }
    createSkill(
      { name: 'from-registry', description: '从 registry 安装' },
      'body',
      'github',
      origin
    )
    const meta = loadAllSkillMetadata()
    const withOrigin = meta.find((s) => s.name === 'from-registry')
    expect(withOrigin?.origin).toEqual(origin)
    const keys = getInstalledRegistryKeys()
    expect(keys.has('github:foo/bar:skills/code-review')).toBe(true)
  })

  it('getInstalledRegistryKeys 不含无 origin 的 skill', () => {
    createSkill({ name: 'no-origin', description: '无 origin' }, 'body')
    const keys = getInstalledRegistryKeys()
    expect(keys.has('github:any/any:any')).toBe(false)
    const meta = loadAllSkillMetadata()
    expect(meta.some((s) => s.name === 'no-origin')).toBe(true)
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

// ============ getSkillsToInject ============

describe('getSkillsToInject', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('allowedSkills 为空时返回所有已启用 skill', () => {
    createSkill({ name: 'a', description: 'A' }, 'body A')
    createSkill({ name: 'b', description: 'B' }, 'body B')

    const result = getSkillsToInject('default', undefined)
    expect(result.length).toBe(2)
    expect(result.map((x) => x.name).sort()).toEqual(['a', 'b'])
    expect(result.find((x) => x.name === 'a')!.instructions).toBe('body A')
  })

  it('allowedSkills 为空数组时返回所有已启用 skill', () => {
    createSkill({ name: 'only', description: 'Only' }, 'content')
    expect(getSkillsToInject('default', [])).toHaveLength(1)
  })

  it('allowedSkills 非空时只返回名单内且已启用的 skill', () => {
    createSkill({ name: 'in', description: 'In' }, 'body in')
    createSkill({ name: 'out', description: 'Out' }, 'body out')

    const result = getSkillsToInject('default', ['in'])
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('in')
    expect(result[0].instructions).toBe('body in')
  })

  it('名单外的 skill 不返回', () => {
    createSkill({ name: 'enabled', description: 'E' }, 'body')
    expect(getSkillsToInject('default', ['other'])).toEqual([])
  })

  it('仅返回已启用的 skill（enabled 由 loadAllSkillMetadata 提供）', () => {
    createSkill({ name: 'one', description: 'One' }, 'body')
    const result = getSkillsToInject('default', ['one'])
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('one')
  })
})

// ============ getSkillsMetadataForDiscovery ============

describe('getSkillsMetadataForDiscovery', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('allowedSkills 为空时返回所有已启用 skill 的 name+description', () => {
    createSkill({ name: 'a', description: 'Desc A' }, 'body A')
    createSkill({ name: 'b', description: 'Desc B' }, 'body B')
    const result = getSkillsMetadataForDiscovery('default', undefined)
    expect(result.length).toBe(2)
    expect(result.map((x) => x.name).sort()).toEqual(['a', 'b'])
    expect(result.find((x) => x.name === 'a')).toEqual({ name: 'a', description: 'Desc A' })
  })

  it('allowedSkills 非空时只返回名单内的 skill', () => {
    createSkill({ name: 'in', description: 'In' }, 'body')
    createSkill({ name: 'out', description: 'Out' }, 'body')
    const result = getSkillsMetadataForDiscovery('default', ['in'])
    expect(result.length).toBe(1)
    expect(result[0]).toEqual({ name: 'in', description: 'In' })
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
