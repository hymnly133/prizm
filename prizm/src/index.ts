/**
 * Prizm Server - Main Entry Point
 */

// Export server
export { createPrizmServer } from './server'
export type { PrizmServer } from './server'

// Export config
export { getConfig, resetConfig } from './config'
export type { PrizmConfig } from './config'

// Export types
export type {
  StickyNote,
  StickyNoteFileRef,
  CreateNotePayload,
  UpdateNotePayload,
  Document,
  CreateDocumentPayload,
  UpdateDocumentPayload,
  PrizmServerOptions
} from './types'

// Export adapter interfaces
export type {
  IStickyNotesAdapter,
  INotificationAdapter,
  IDocumentsAdapter,
  PrizmAdapters
} from './adapters/interfaces'

// Export default adapters
export {
  DefaultStickyNotesAdapter,
  DefaultNotificationAdapter,
  DefaultDocumentsAdapter,
  createDefaultAdapters
} from './adapters/default'

// Export WebSocket module
export * from './websocket'

// Export scopes (descriptions for UI / config)
export { getScopeInfo, getScopeInfos, SCOPE_INFOS } from './scopes'
export type { ScopeInfo } from './scopes'
