import { PrizmClient } from '../client'
import type { FileEntry, FileReadResult } from '../../types'

declare module '../client' {
  interface PrizmClient {
    fileList(options?: {
      path?: string
      recursive?: boolean
      scope?: string
      sessionWorkspace?: string
    }): Promise<FileEntry[]>
    fileRead(filePath: string, scope?: string): Promise<FileReadResult>
    /** 流式获取文件内容为 Blob（用于图片等二进制查看，带认证） */
    fileServeBlob(filePath: string, scope?: string): Promise<Blob>
    fileWrite(filePath: string, content: string, scope?: string): Promise<void>
    fileMkdir(dirPath: string, scope?: string): Promise<void>
    fileMove(from: string, to: string, scope?: string): Promise<void>
    fileDelete(filePath: string, scope?: string): Promise<void>
    fileStat(
      filePath: string,
      scope?: string
    ): Promise<{ size: number; lastModified: number; isDir: boolean; isFile: boolean }>
  }
}

PrizmClient.prototype.fileList = async function (
  this: PrizmClient,
  options?: {
    path?: string
    recursive?: boolean
    scope?: string
    sessionWorkspace?: string
  }
) {
  const scope = options?.scope ?? this.defaultScope
  const query: Record<string, string | undefined> = {
    path: options?.path,
    recursive: options?.recursive ? 'true' : undefined,
    scope,
    sessionWorkspace: options?.sessionWorkspace
  }
  const url = this.buildUrl('/files/list', query)
  const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  const data = (await response.json()) as { files: FileEntry[] }
  return data.files
}

PrizmClient.prototype.fileRead = async function (
  this: PrizmClient,
  filePath: string,
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl('/files/read', { path: filePath, scope: s })
  const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  const data = (await response.json()) as { file: FileReadResult }
  return data.file
}

PrizmClient.prototype.fileServeBlob = async function (
  this: PrizmClient,
  filePath: string,
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl('/files/serve', { path: filePath, scope: s })
  const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  return response.blob()
}

PrizmClient.prototype.fileWrite = async function (
  this: PrizmClient,
  filePath: string,
  content: string,
  scope?: string
) {
  await this.request<{ ok: boolean }>('/files/write', {
    method: 'POST',
    scope,
    body: JSON.stringify({ path: filePath, content })
  })
}

PrizmClient.prototype.fileMkdir = async function (
  this: PrizmClient,
  dirPath: string,
  scope?: string
) {
  await this.request<{ ok: boolean }>('/files/mkdir', {
    method: 'POST',
    scope,
    body: JSON.stringify({ path: dirPath })
  })
}

PrizmClient.prototype.fileMove = async function (
  this: PrizmClient,
  from: string,
  to: string,
  scope?: string
) {
  await this.request<{ ok: boolean }>('/files/move', {
    method: 'POST',
    scope,
    body: JSON.stringify({ from, to })
  })
}

PrizmClient.prototype.fileDelete = async function (
  this: PrizmClient,
  filePath: string,
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl('/files/delete', { path: filePath, scope: s })
  const response = await fetch(url, { method: 'DELETE', headers: this.buildHeaders() })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
}

PrizmClient.prototype.fileStat = async function (
  this: PrizmClient,
  filePath: string,
  scope?: string
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl('/files/stat', { path: filePath, scope: s })
  const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  const data = (await response.json()) as {
    stat: { size: number; lastModified: number; isDir: boolean; isFile: boolean }
  }
  return data.stat
}
