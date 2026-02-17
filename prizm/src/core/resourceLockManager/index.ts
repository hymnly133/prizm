export type {
  LockableResourceType,
  ResourceLock,
  ResourceReadRecord,
  AcquireLockResult,
  ResourceStatus
} from './types'
export { DEFAULT_LOCK_TTL_MS } from './types'
export * as lockManager from './lockManager'
