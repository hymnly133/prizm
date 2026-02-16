import type { PrizmConfig } from '@prizm/client-core'

declare global {
  interface Window {
    prizm: {
      loadConfig(): Promise<PrizmConfig | null>
      saveConfig(config: PrizmConfig): Promise<boolean>
      testConnection(serverUrl: string): Promise<boolean>
      registerClient(
        serverUrl: string,
        clientName: string,
        scopes: string[]
      ): Promise<string | null>
      getAppVersion(): Promise<string>
      openDashboard(serverUrl: string): Promise<boolean>
      readClipboard(): Promise<string>
      writeClipboard(text: string): Promise<boolean>
      startClipboardSync(config: {
        serverUrl: string
        apiKey: string
        scope?: string
      }): Promise<boolean>
      stopClipboardSync(): Promise<boolean>
      onClipboardItemAdded(callback: () => void): () => void
      showNotification(
        payload:
          | import('@prizm/client-core').NotifyWindowPayload
          | { title: string; body?: string; source?: string }
      ): Promise<boolean>
      onLogFromMain(
        callback: (entry: {
          level: string
          message: string
          timestamp: string
          source: string
        }) => void
      ): () => void
      logFromRenderer(message: string, type: string): Promise<boolean>
      selectFolder(): Promise<string | null>
      onExecuteQuickAction(
        callback: (payload: { action: string; selectedText: string }) => void
      ): () => void
      getPlatform(): Promise<string>
      setTitleBarOverlay(options: {
        color?: string
        symbolColor?: string
        height?: number
      }): Promise<boolean>
    }
    quickPanelApi?: {
      onShow(callback: (data: { selectedText: string }) => void): () => void
      executeAction(action: string, selectedText: string): void
      hidePanel(): void
    }
  }
}

export {}
