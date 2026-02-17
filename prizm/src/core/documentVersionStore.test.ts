import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  saveVersion,
  getLatestVersion,
  getPreviousVersion,
  getVersionHistory,
  computeDiff,
  computeContentHash
} from './documentVersionStore'

describe('documentVersionStore', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docver-test-'))
    // Create .prizm dir structure
    fs.mkdirSync(path.join(tmpDir, '.prizm'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('computeContentHash', () => {
    it('should return consistent hash for same content', () => {
      const h1 = computeContentHash('hello world')
      const h2 = computeContentHash('hello world')
      expect(h1).toBe(h2)
      expect(h1).toHaveLength(16)
    })

    it('should return different hash for different content', () => {
      const h1 = computeContentHash('hello')
      const h2 = computeContentHash('world')
      expect(h1).not.toBe(h2)
    })
  })

  describe('saveVersion', () => {
    it('should save first version as v1', () => {
      const ver = saveVersion(tmpDir, 'doc1', 'Test Doc', 'Hello content')
      expect(ver.version).toBe(1)
      expect(ver.title).toBe('Test Doc')
      expect(ver.content).toBe('Hello content')
      expect(ver.contentHash).toBeTruthy()
      expect(ver.timestamp).toBeTruthy()
    })

    it('should increment version number', () => {
      saveVersion(tmpDir, 'doc1', 'Test', 'v1 content')
      const ver2 = saveVersion(tmpDir, 'doc1', 'Test', 'v2 content')
      expect(ver2.version).toBe(2)
    })

    it('should skip save when content unchanged (same hash)', () => {
      const ver1 = saveVersion(tmpDir, 'doc1', 'Test', 'same content')
      const ver2 = saveVersion(tmpDir, 'doc1', 'Test', 'same content')
      expect(ver2.version).toBe(1)
      expect(ver2.contentHash).toBe(ver1.contentHash)
    })

    it('should handle different documents independently', () => {
      saveVersion(tmpDir, 'doc1', 'Doc 1', 'content1')
      saveVersion(tmpDir, 'doc2', 'Doc 2', 'content2')
      const h1 = getVersionHistory(tmpDir, 'doc1')
      const h2 = getVersionHistory(tmpDir, 'doc2')
      expect(h1.versions).toHaveLength(1)
      expect(h2.versions).toHaveLength(1)
    })
  })

  describe('getLatestVersion', () => {
    it('should return null for non-existent document', () => {
      const ver = getLatestVersion(tmpDir, 'nonexistent')
      expect(ver).toBeNull()
    })

    it('should return latest version', () => {
      saveVersion(tmpDir, 'doc1', 'Test', 'v1')
      saveVersion(tmpDir, 'doc1', 'Test', 'v2')
      saveVersion(tmpDir, 'doc1', 'Test', 'v3')
      const latest = getLatestVersion(tmpDir, 'doc1')
      expect(latest?.version).toBe(3)
      expect(latest?.content).toBe('v3')
    })
  })

  describe('getPreviousVersion', () => {
    it('should return null with only one version', () => {
      saveVersion(tmpDir, 'doc1', 'Test', 'v1')
      const prev = getPreviousVersion(tmpDir, 'doc1')
      expect(prev).toBeNull()
    })

    it('should return previous version', () => {
      saveVersion(tmpDir, 'doc1', 'Test', 'v1 content')
      saveVersion(tmpDir, 'doc1', 'Test', 'v2 content')
      const prev = getPreviousVersion(tmpDir, 'doc1')
      expect(prev?.version).toBe(1)
      expect(prev?.content).toBe('v1 content')
    })
  })

  describe('getVersionHistory', () => {
    it('should return empty history for non-existent doc', () => {
      const h = getVersionHistory(tmpDir, 'nonexistent')
      expect(h.documentId).toBe('nonexistent')
      expect(h.versions).toHaveLength(0)
    })

    it('should return all versions in order', () => {
      saveVersion(tmpDir, 'doc1', 'Test', 'v1')
      saveVersion(tmpDir, 'doc1', 'Test', 'v2')
      saveVersion(tmpDir, 'doc1', 'Test', 'v3')
      const h = getVersionHistory(tmpDir, 'doc1')
      expect(h.versions).toHaveLength(3)
      expect(h.versions[0].version).toBe(1)
      expect(h.versions[2].version).toBe(3)
    })
  })

  describe('computeDiff', () => {
    it('should report no changes for identical content', () => {
      const diff = computeDiff('hello\nworld', 'hello\nworld')
      expect(diff).toContain('无显著变更')
    })

    it('should detect added lines', () => {
      const diff = computeDiff('line1\nline2', 'line1\nline2\nline3')
      expect(diff).toContain('新增')
      expect(diff).toContain('line3')
    })

    it('should detect removed lines', () => {
      const diff = computeDiff('line1\nline2\nline3', 'line1\nline2')
      expect(diff).toContain('删除')
      expect(diff).toContain('line3')
    })

    it('should show statistics', () => {
      const diff = computeDiff('old line', 'new line')
      expect(diff).toContain('变更统计')
    })
  })
})
