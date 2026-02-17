#!/usr/bin/env node
/**
 * Prizm 项目规模分析脚本
 * 用法: node scripts/analyze.js [--json] [--top N]
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
process.chdir(ROOT)

// ── CLI 参数 ─────────────────────────────────────────────
const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const topN = (() => {
  const idx = args.indexOf('--top')
  return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1], 10) : 20
})()

// ── 工具函数 ─────────────────────────────────────────────
function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: ROOT }).split(/\r?\n/).filter(Boolean)
}

function countLines(filePath) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return 0 // skip >2MB
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).length
  } catch {
    return 0
  }
}

function pct(n, total) {
  return total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '0%'
}

function pad(str, len, right = false) {
  const s = String(str)
  return right ? s.padStart(len) : s.padEnd(len)
}

// ── 收集所有文件 ─────────────────────────────────────────
const tracked = run('git ls-files')
const untracked = run('git ls-files --others --exclude-standard')
const allFiles = [...tracked, ...untracked].filter(
  (f) =>
    !f.startsWith('node_modules/') &&
    !f.includes('/node_modules/') &&
    !f.endsWith('.lock') &&
    !f.startsWith('yarn.lock')
)

// ── 构建文件元数据 ───────────────────────────────────────
const CODE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.vue',
  '.py',
  '.css',
  '.scss',
  '.less',
  '.html',
  '.sql'
])

const fileRecords = []
const extStats = {}
let totalLines = 0

for (const f of allFiles) {
  const fullPath = path.join(ROOT, f)
  const ext = path.extname(f).toLowerCase()
  const lines = countLines(fullPath)
  totalLines += lines

  if (!extStats[ext]) extStats[ext] = { files: 0, lines: 0 }
  extStats[ext].files++
  extStats[ext].lines += lines

  fileRecords.push({ file: f, lines, ext })
}

const codeRecords = fileRecords.filter((r) => CODE_EXTS.has(r.ext))
const totalCodeLines = codeRecords.reduce((s, r) => s + r.lines, 0)
const totalCodeFiles = codeRecords.length

// ── 包级统计 ─────────────────────────────────────────────
const PACKAGES = [
  { key: 'prizm', label: 'prizm/', desc: 'HTTP API 服务器' },
  { key: 'electron', label: 'prizm-electron-client/', desc: 'Electron 桌面客户端' },
  { key: 'clientCore', label: 'prizm-client-core/', desc: '客户端 SDK' },
  { key: 'shared', label: 'prizm-shared/', desc: '共享类型' },
  { key: 'evermemos', label: 'packages/evermemos/', desc: 'TS 记忆系统' },
  { key: 'EverMemOS', label: 'EverMemOS/', desc: 'Python 记忆系统' }
]

const pkgStats = PACKAGES.map((pkg) => {
  const files = codeRecords.filter((r) => r.file.startsWith(pkg.label))
  const lines = files.reduce((s, r) => s + r.lines, 0)
  const allPkgFiles = fileRecords.filter((r) => r.file.startsWith(pkg.label))
  return {
    ...pkg,
    codeFiles: files.length,
    codeLines: lines,
    totalFiles: allPkgFiles.length,
    totalLines: allPkgFiles.reduce((s, r) => s + r.lines, 0)
  }
})

// ── 源码 vs 测试 ────────────────────────────────────────
const testRecords = codeRecords.filter((r) => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(r.file))
const testLines = testRecords.reduce((s, r) => s + r.lines, 0)
const srcLines = totalCodeLines - testLines

// ── 文件类型排序 ─────────────────────────────────────────
const extRanking = Object.entries(extStats)
  .sort((a, b) => b[1].lines - a[1].lines)
  .slice(0, 15)

// ── 最大文件 ─────────────────────────────────────────────
const largestFiles = [...codeRecords].sort((a, b) => b.lines - a.lines).slice(0, topN)

// ── 目录统计 ─────────────────────────────────────────────
const dirs = new Set()
for (const f of allFiles) {
  const d = path.dirname(f)
  if (d !== '.') dirs.add(d)
}
const maxDepth = dirs.size > 0 ? Math.max(...[...dirs].map((d) => d.split(/[/\\]/).length)) : 0

// ── Git 历史 ─────────────────────────────────────────────
let gitHistory = {}
try {
  const commits = run('git log --oneline')
  const first = run('git log --reverse --format="%ai" -- .').at(0) || ''
  const latest = run('git log --format="%ai" -1').at(0) || ''
  const recent30 = run('git log --since="30 days ago" --oneline')
  const contributors = run('git shortlog -sn --no-merges')
    .slice(0, 10)
    .map((l) => {
      const m = l.trim().match(/^(\d+)\s+(.+)$/)
      return m ? { commits: parseInt(m[1]), name: m[2] } : null
    })
    .filter(Boolean)

  gitHistory = {
    totalCommits: commits.length,
    firstCommitDate: first.replace(/"/g, '').slice(0, 10),
    latestCommitDate: latest.replace(/"/g, '').slice(0, 10),
    commitsLast30Days: recent30.length,
    contributors
  }
} catch {
  gitHistory = { error: '无法读取 git 历史' }
}

// ── 依赖统计 ─────────────────────────────────────────────
function countDeps(pkgJsonPath) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, pkgJsonPath), 'utf8'))
    return {
      deps: Object.keys(p.dependencies || {}).length,
      devDeps: Object.keys(p.devDependencies || {}).length
    }
  } catch {
    return { deps: 0, devDeps: 0 }
  }
}

const depStats = {
  root: countDeps('package.json'),
  prizm: countDeps('prizm/package.json'),
  electron: countDeps('prizm-electron-client/package.json'),
  clientCore: countDeps('prizm-client-core/package.json'),
  shared: countDeps('prizm-shared/package.json'),
  evermemos: countDeps('packages/evermemos/package.json')
}

// ── 汇总结果对象 ────────────────────────────────────────
const result = {
  summary: {
    trackedFiles: tracked.length,
    untrackedFiles: untracked.length,
    analyzedFiles: allFiles.length,
    totalLines,
    codeFiles: totalCodeFiles,
    codeLines: totalCodeLines,
    sourceLines: srcLines,
    testLines,
    testRatio: pct(testLines, totalCodeLines),
    directories: dirs.size,
    maxDepth
  },
  packages: pkgStats,
  fileTypes: extRanking.map(([ext, s]) => ({
    ext: ext || '(none)',
    files: s.files,
    lines: s.lines,
    pct: pct(s.lines, totalLines)
  })),
  largestFiles: largestFiles.map((f) => ({ file: f.file, lines: f.lines })),
  dependencies: depStats,
  git: gitHistory
}

// ── 输出 ─────────────────────────────────────────────────
if (jsonMode) {
  console.log(JSON.stringify(result, null, 2))
  process.exit(0)
}

// 友好输出
const SEP = '─'.repeat(56)

console.log()
console.log('╔══════════════════════════════════════════════════════════╗')
console.log('║           PRIZM 项目规模分析报告                        ║')
console.log('╚══════════════════════════════════════════════════════════╝')
console.log()

// 1. 概览
console.log(`【1. 项目概览】`)
console.log(SEP)
console.log(`  已跟踪文件    ${pad(tracked.length.toLocaleString(), 8, true)}`)
console.log(`  新增未跟踪    ${pad(untracked.length.toLocaleString(), 8, true)}`)
console.log(`  分析文件总计  ${pad(allFiles.length.toLocaleString(), 8, true)}`)
console.log(`  总行数        ${pad(totalLines.toLocaleString(), 8, true)}`)
console.log(`  代码文件      ${pad(totalCodeFiles.toLocaleString(), 8, true)}`)
console.log(`  代码行数      ${pad(totalCodeLines.toLocaleString(), 8, true)}`)
console.log(`  目录数        ${pad(dirs.size.toLocaleString(), 8, true)}`)
console.log(`  最大深度      ${pad(maxDepth + ' 层', 8, true)}`)
console.log()

// 2. 包
console.log(`【2. 各包规模】`)
console.log(SEP)
for (const p of pkgStats) {
  console.log(
    `  ${pad(p.desc, 24)} ${pad(p.codeLines.toLocaleString(), 7, true)} 行  ${pad(
      p.codeFiles,
      4,
      true
    )} 代码文件  ${pad(p.totalFiles, 4, true)} 总文件`
  )
}
console.log()

// 3. 文件类型
console.log(`【3. 文件类型分布】`)
console.log(SEP)
for (const t of result.fileTypes) {
  console.log(
    `  ${pad(t.ext, 10)} ${pad(t.files, 5, true)} 文件  ${pad(
      t.lines.toLocaleString(),
      8,
      true
    )} 行  ${pad(t.pct, 6, true)}`
  )
}
console.log()

// 4. 源码 vs 测试
console.log(`【4. 源码 vs 测试】`)
console.log(SEP)
console.log(
  `  源代码   ${pad(srcLines.toLocaleString(), 8, true)} 行  (${pad(
    totalCodeFiles - testRecords.length,
    4,
    true
  )} 文件)`
)
console.log(
  `  测试代码 ${pad(testLines.toLocaleString(), 8, true)} 行  (${pad(
    testRecords.length,
    4,
    true
  )} 文件)`
)
console.log(`  测试占比 ${pad(result.summary.testRatio, 8, true)}`)
console.log()

// 5. 最大文件
console.log(`【5. 最大的 ${topN} 个代码文件】`)
console.log(SEP)
for (const f of largestFiles) {
  console.log(`  ${pad(f.lines.toLocaleString(), 6, true)} 行  ${f.file}`)
}
console.log()

// 6. 依赖
console.log(`【6. 依赖统计】`)
console.log(SEP)
for (const [name, d] of Object.entries(depStats)) {
  console.log(
    `  ${pad(name, 14)} deps: ${pad(d.deps, 3, true)}   devDeps: ${pad(
      d.devDeps,
      3,
      true
    )}   合计: ${pad(d.deps + d.devDeps, 3, true)}`
  )
}
console.log()

// 7. Git
console.log(`【7. Git 历史】`)
console.log(SEP)
if (gitHistory.error) {
  console.log(`  ${gitHistory.error}`)
} else {
  console.log(`  总提交数       ${pad(gitHistory.totalCommits, 6, true)}`)
  console.log(`  首次提交       ${gitHistory.firstCommitDate}`)
  console.log(`  最近提交       ${gitHistory.latestCommitDate}`)
  console.log(`  近 30 天提交   ${pad(gitHistory.commitsLast30Days, 6, true)}`)
  if (gitHistory.contributors.length > 0) {
    console.log(`  贡献者:`)
    for (const c of gitHistory.contributors) {
      console.log(`    ${pad(c.commits, 5, true)} 次  ${c.name}`)
    }
  }
}
console.log()
console.log(`提示: 使用 --json 输出 JSON 格式，--top N 指定最大文件数`)
