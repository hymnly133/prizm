export type { ResourceRefDef, ResourceRefItem, ResourceRefDetail } from './types'
export {
  registerResourceRef,
  unregisterResourceRef,
  getResourceRefDef,
  listRegisteredTypes,
  listResources,
  listAllResources,
  resolveResource,
  resolveResourceAcrossScopes,
  searchResources
} from './registry'
export { registerBuiltinResourceRefs } from './builtinRefs'
