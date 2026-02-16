/**
 * Shell 检测与枚举
 * 探测当前系统中可用的 Shell，供设置界面选择
 */

import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import { createLogger } from '../logger'
import { getTerminalSettings } from '../settings/agentToolsStore'

const logger = createLogger('ShellDetector')

export interface ShellInfo {
  /** Shell 可执行路径或名称 */
  path: string
  /** 显示名称 */
  label: string
  /** 是否为当前系统的自动检测默认值 */
  isDefault: boolean
}

// ============ Windows Shell 检测 ============

interface WindowsShellCandidate {
  label: string
  paths: string[]
}

function getWindowsCandidates(): WindowsShellCandidate[] {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const localAppData = process.env.LOCALAPPDATA || ''
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'

  return [
    {
      label: 'PowerShell 7 (pwsh)',
      paths: [
        path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
        path.join(programFilesX86, 'PowerShell', '7', 'pwsh.exe'),
        path.join(localAppData, 'Microsoft', 'PowerShell', 'pwsh.exe')
      ]
    },
    {
      label: 'Windows PowerShell',
      paths: [
        path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        'powershell.exe'
      ]
    },
    {
      label: 'CMD',
      paths: [path.join(systemRoot, 'System32', 'cmd.exe'), 'cmd.exe']
    },
    {
      label: 'Git Bash',
      paths: [
        path.join(programFiles, 'Git', 'bin', 'bash.exe'),
        path.join(programFilesX86, 'Git', 'bin', 'bash.exe')
      ]
    }
  ]
}

function detectWindowsShells(): ShellInfo[] {
  const results: ShellInfo[] = []
  const candidates = getWindowsCandidates()

  for (const candidate of candidates) {
    for (const shellPath of candidate.paths) {
      try {
        if (fs.existsSync(shellPath)) {
          results.push({
            path: shellPath,
            label: candidate.label,
            isDefault: false
          })
          break // 只取同一 shell 的第一个匹配路径
        }
      } catch {
        // 权限或路径不存在
      }
    }
  }

  // 也检查 PATH 中的 pwsh（可能安装在非标准路径）
  if (!results.some((s) => s.label.includes('pwsh'))) {
    const pathDirs = (process.env.PATH || '').split(path.delimiter)
    for (const dir of pathDirs) {
      const full = path.join(dir, 'pwsh.exe')
      try {
        if (fs.existsSync(full)) {
          results.push({ path: full, label: 'PowerShell 7 (pwsh)', isDefault: false })
          break
        }
      } catch {
        // 跳过
      }
    }
  }

  return results
}

// ============ Unix Shell 检测 ============

function detectUnixShells(): ShellInfo[] {
  const results: ShellInfo[] = []
  const candidates = [
    { path: '/bin/bash', label: 'Bash' },
    { path: '/bin/zsh', label: 'Zsh' },
    { path: '/bin/sh', label: 'POSIX sh' },
    { path: '/usr/bin/fish', label: 'Fish' },
    { path: '/bin/fish', label: 'Fish' }
  ]

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate.path)) {
        results.push({ path: candidate.path, label: candidate.label, isDefault: false })
      }
    } catch {
      // 跳过
    }
  }

  return results
}

// ============ 缓存 ============

let _cachedShells: ShellInfo[] | null = null

/**
 * 获取系统可用 Shell 列表，带自动检测默认值标记
 */
export function getAvailableShells(): ShellInfo[] {
  if (_cachedShells) return _cachedShells

  const shells = os.platform() === 'win32' ? detectWindowsShells() : detectUnixShells()

  // 标记自动检测默认值
  if (shells.length > 0) {
    shells[0].isDefault = true
  }

  _cachedShells = shells
  logger.info(
    `Detected ${shells.length} available shells: ${shells.map((s) => s.label).join(', ')}`
  )
  return shells
}

/**
 * 获取最终使用的默认 Shell
 * 优先级：用户设置 > 自动检测
 */
export function resolveDefaultShell(): string {
  const settings = getTerminalSettings()
  if (settings.defaultShell) {
    return settings.defaultShell
  }
  const shells = getAvailableShells()
  const defaultShell = shells.find((s) => s.isDefault)
  if (defaultShell) return defaultShell.path

  // 最终兜底
  if (os.platform() === 'win32') {
    return process.env.COMSPEC || 'powershell.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

/** 重置缓存（用于测试） */
export function resetShellCache(): void {
  _cachedShells = null
}
