/**
 * Clipboard (.prizm/clipboard/) CRUD.
 */

import fs from 'fs'
import path from 'path'
import type { ClipboardItem } from '../../types'
import { getClipboardDir } from '../PathProviderCore'
import {
  EXT,
  safeId,
  readMd,
  writeMd,
  listMdFiles,
  readSystemFiles
} from './utils'

function parseClipboard(
  fp: string,
  d: Record<string, unknown>,
  content: string
): ClipboardItem | null {
  const id = typeof d.id === 'string' ? d.id : path.basename(fp, EXT)
  const type = (
    d.type === 'text' || d.type === 'image' || d.type === 'file' || d.type === 'other'
      ? d.type
      : 'text'
  ) as ClipboardItem['type']
  return {
    id,
    type,
    content,
    sourceApp: typeof d.sourceApp === 'string' ? d.sourceApp : undefined,
    createdAt: (d.createdAt as number) ?? 0
  }
}

export function readClipboard(scopeRoot: string): ClipboardItem[] {
  const items = readSystemFiles(scopeRoot, getClipboardDir, (fp, d, c) =>
    parseClipboard(fp, d, c)
  )
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

export function writeClipboard(scopeRoot: string, items: ClipboardItem[]): void {
  const dir = getClipboardDir(scopeRoot)
  const existing = new Map<string, string>()
  if (fs.existsSync(dir)) {
    for (const fp of listMdFiles(dir)) {
      const p = readMd(fp)
      if (p) {
        const id = p.data.id as string
        if (id) existing.set(id, fp)
      }
    }
  }
  const ids = new Set(items.map((i) => i.id))
  for (const it of items) {
    const frontmatter: Record<string, unknown> = {
      prizm_type: 'clipboard_item',
      id: it.id,
      type: it.type,
      createdAt: it.createdAt,
      ...(it.sourceApp && { sourceApp: it.sourceApp })
    }
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const fp = path.join(dir, `${safeId(it.id)}${EXT}`)
    writeMd(fp, frontmatter, it.content)
  }
  for (const [id, fp] of existing) {
    if (!ids.has(id)) {
      try {
        fs.unlinkSync(fp)
      } catch {}
    }
  }
}
