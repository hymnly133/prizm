/**
 * Prizm Server - Main Entry Point
 */

// Export server
export { createPrizmServer } from './server'
export type { PrizmServer } from './server'

// Export types
export type {
  StickyNote,
  StickyNoteGroup,
  StickyNoteFileRef,
  CreateNotePayload,
  UpdateNotePayload,
  PrizmServerOptions
} from './types'

// Export adapter interfaces
export type {
  IStickyNotesAdapter,
  INotificationAdapter,
  PrizmAdapters
} from './adapters/interfaces'

// Export default adapters
export {
  DefaultStickyNotesAdapter,
  DefaultNotificationAdapter,
  createDefaultAdapters
} from './adapters/default'

// Export WebSocket module
export * from './websocket'
