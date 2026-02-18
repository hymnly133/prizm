/**
 * FileService — 统一文件操作业务逻辑
 * Agent 工具和 API 路由共用，确保一致的事件发射
 */

import * as mdStore from '../core/mdStore'
import { emit } from '../core/eventBus'
import { createLogger } from '../logger'
import { ValidationError } from './errors'
import type { OperationContext } from './types'

const log = createLogger('FileService')

/** 写入文件（创建或覆盖） */
export async function writeFile(
  ctx: OperationContext,
  scopeRoot: string,
  relativePath: string,
  content: string
): Promise<boolean> {
  if (!mdStore.validateRelativePath(relativePath)) {
    throw new ValidationError('Invalid path')
  }
  if (mdStore.isSystemPath(relativePath)) {
    throw new ValidationError('Cannot write to system directory')
  }

  const ok = mdStore.writeFileByPath(scopeRoot, relativePath, content)
  if (!ok) return false

  log.info('File written:', relativePath, 'scope:', ctx.scope, 'actor:', ctx.actor.type)
  emit('file:operation', {
    action: 'created',
    scope: ctx.scope,
    relativePath,
    actor: ctx.actor
  }).catch(() => {})

  return true
}

/** 移动/重命名文件 */
export async function moveFile(
  ctx: OperationContext,
  scopeRoot: string,
  from: string,
  to: string
): Promise<boolean> {
  if (!mdStore.validateRelativePath(from) || !mdStore.validateRelativePath(to)) {
    throw new ValidationError('Invalid path')
  }
  if (mdStore.isSystemPath(from) || mdStore.isSystemPath(to)) {
    throw new ValidationError('Cannot move system files')
  }

  const ok = mdStore.moveFile(scopeRoot, from, to)
  if (!ok) return false

  log.info('File moved:', from, '->', to, 'scope:', ctx.scope, 'actor:', ctx.actor.type)
  emit('file:operation', {
    action: 'moved',
    scope: ctx.scope,
    relativePath: to,
    fromPath: from,
    actor: ctx.actor
  }).catch(() => {})

  return true
}

/** 删除文件/目录 */
export async function deleteFile(
  ctx: OperationContext,
  scopeRoot: string,
  relativePath: string
): Promise<boolean> {
  if (!mdStore.validateRelativePath(relativePath)) {
    throw new ValidationError('Invalid path')
  }
  if (mdStore.isSystemPath(relativePath)) {
    throw new ValidationError('Cannot delete system files')
  }

  const ok = mdStore.deleteByPath(scopeRoot, relativePath)
  if (!ok) return false

  log.info('File deleted:', relativePath, 'scope:', ctx.scope, 'actor:', ctx.actor.type)
  emit('file:operation', {
    action: 'deleted',
    scope: ctx.scope,
    relativePath,
    actor: ctx.actor
  }).catch(() => {})

  return true
}

/** 创建目录 */
export async function mkdir(
  ctx: OperationContext,
  scopeRoot: string,
  relativePath: string
): Promise<boolean> {
  if (!mdStore.validateRelativePath(relativePath)) {
    throw new ValidationError('Invalid path')
  }

  return mdStore.mkdirByPath(scopeRoot, relativePath)
}
