import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { migrateToV3 } from './migrate-v3'
import { getScopeJsonPath } from './PathProviderCore'

describe('migrate-v3', () => {
  let tempDir: string
  let scopeRoot: string

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `prizm-migrate-v3-${Date.now()}`)
    scopeRoot = path.join(tempDir, 'scope')
    fs.mkdirSync(scopeRoot, { recursive: true })
    const prizmDir = path.join(scopeRoot, '.prizm')
    fs.mkdirSync(prizmDir, { recursive: true })
    fs.writeFileSync(
      path.join(prizmDir, 'scope.json'),
      JSON.stringify({ id: 'test', label: 'Test', settings: {} }),
      'utf-8'
    )
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('skips when dataVersion >= 3', () => {
    fs.writeFileSync(
      getScopeJsonPath(scopeRoot),
      JSON.stringify({ id: 'test', dataVersion: 3 }),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(scopeRoot, 'old-note.md'),
      '---\nprizm_type: note\nid: n1\n---\ncontent',
      'utf-8'
    )
    migrateToV3(scopeRoot)
    expect(fs.existsSync(path.join(scopeRoot, 'old-note.md'))).toBe(true)
    const content = fs.readFileSync(path.join(scopeRoot, 'old-note.md'), 'utf-8')
    expect(content).toContain('prizm_type: note')
  })

  it('migrates note to document with title from content', () => {
    fs.writeFileSync(
      path.join(scopeRoot, 'n1.md'),
      '---\nprizm_type: note\nid: n1\ncreatedAt: 1\nupdatedAt: 1\n---\nmigrated content here',
      'utf-8'
    )
    migrateToV3(scopeRoot)
    expect(fs.existsSync(path.join(scopeRoot, 'n1.md'))).toBe(false)
    expect(fs.existsSync(path.join(scopeRoot, 'migrated content here.md'))).toBe(true)
    const content = fs.readFileSync(path.join(scopeRoot, 'migrated content here.md'), 'utf-8')
    expect(content).toContain('prizm_type: document')
    expect(content).toContain('title: migrated content here')
    expect(content).toContain('id: n1')
    expect(content).toContain('migrated content here')
  })

  it('uses untitled for empty content', () => {
    fs.writeFileSync(
      path.join(scopeRoot, 'empty.md'),
      '---\nprizm_type: note\nid: e1\n---\n',
      'utf-8'
    )
    migrateToV3(scopeRoot)
    expect(fs.existsSync(path.join(scopeRoot, 'untitled.md'))).toBe(true)
    const content = fs.readFileSync(path.join(scopeRoot, 'untitled.md'), 'utf-8')
    expect(content).toContain('title: untitled')
  })

  it('writes dataVersion 3 to scope.json', () => {
    migrateToV3(scopeRoot)
    const json = JSON.parse(fs.readFileSync(getScopeJsonPath(scopeRoot), 'utf-8'))
    expect(json.dataVersion).toBe(3)
  })
})
