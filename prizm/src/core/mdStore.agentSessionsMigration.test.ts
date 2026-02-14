/**
 * Agent Sessions 迁移测试：旧格式（子目录+meta.md+messages/）→ 新格式（单文件）
 * 迁移后删除旧格式，不保留遗留逻辑
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import matter from 'gray-matter'
import { migrateAgentSessionsToSingleFile, readAgentSessions } from './mdStore'

function writeMd(filePath: string, frontmatter: Record<string, unknown>, body = ''): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const content = matter.stringify(body, frontmatter, { lineWidth: -1 })
  fs.writeFileSync(filePath, content, 'utf-8')
}

describe('Agent Sessions 迁移', () => {
  let tempDir: string
  let scopeDir: string

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `prizm-agent-migrate-${Date.now()}`)
    scopeDir = path.join(tempDir, 'scopes', 'online')
    fs.mkdirSync(scopeDir, { recursive: true })
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('从旧格式迁移到新格式并删除旧目录', () => {
    // 1. 创建旧格式：agent-sessions/{id}/meta.md + messages/{msgId}.md
    const sessionsDir = path.join(scopeDir, 'agent-sessions')
    const sessionId = 'old-session-1'
    const sessionDir = path.join(sessionsDir, sessionId)
    const messagesDir = path.join(sessionDir, 'messages')
    fs.mkdirSync(messagesDir, { recursive: true })

    const metaPath = path.join(sessionDir, 'meta.md')
    writeMd(metaPath, {
      id: sessionId,
      title: '测试会话',
      scope: 'online',
      createdAt: 1000,
      updatedAt: 2000
    })

    const msgPath = path.join(messagesDir, 'msg1.md')
    writeMd(
      msgPath,
      {
        id: 'msg1',
        role: 'user',
        createdAt: 1100
      },
      'hello'
    )

    const msgPath2 = path.join(messagesDir, 'msg2.md')
    writeMd(
      msgPath2,
      {
        id: 'msg2',
        role: 'assistant',
        createdAt: 1200
      },
      'hi there'
    )

    expect(fs.existsSync(sessionDir)).toBe(true)
    expect(fs.existsSync(path.join(sessionDir, 'meta.md'))).toBe(true)
    expect(fs.existsSync(msgPath)).toBe(true)

    // 2. 执行迁移
    migrateAgentSessionsToSingleFile(scopeDir)

    // 3. 验证新格式：单文件存在
    const newFilePath = path.join(sessionsDir, `${sessionId}.md`)
    expect(fs.existsSync(newFilePath)).toBe(true)

    // 4. 验证旧格式已删除
    expect(fs.existsSync(sessionDir)).toBe(false)
    expect(fs.existsSync(path.join(sessionDir, 'meta.md'))).toBe(false)

    // 5. 验证读取正确
    const sessions = readAgentSessions(scopeDir)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe(sessionId)
    expect(sessions[0].title).toBe('测试会话')
    expect(sessions[0].messages).toHaveLength(2)
    expect(sessions[0].messages[0].content).toBe('hello')
    expect(sessions[0].messages[1].content).toBe('hi there')
  })
})
